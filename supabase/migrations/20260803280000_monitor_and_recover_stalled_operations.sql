-- Production operations must never remain in an indeterminate processing
-- state forever. Close abandoned imports and surface actionable health data.
CREATE OR REPLACE FUNCTION security.close_stale_imports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.platform_file_uploads
  SET status = 'failed',
      finished_at = now(),
      error_message = COALESCE(
        NULLIF(error_message, ''),
        'توقفت المعالجة لأكثر من 30 دقيقة — أغلقها النظام تلقائياً ويمكن إعادة رفع الملف'
      )
  WHERE status = 'processing'
    AND uploaded_at < now() - interval '30 minutes';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$$;

REVOKE ALL ON FUNCTION security.close_stale_imports() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.close_stale_imports() TO service_role;

DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'close-stale-imports';
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'close-stale-imports',
    '*/10 * * * *',
    $cron$SELECT security.close_stale_imports()$cron$
  );
END
$$;

-- Repair any already-abandoned imports during rollout.
SELECT security.close_stale_imports();

CREATE OR REPLACE FUNCTION public.get_db_health_internal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  tomorrow_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Riyadh') + interval '1 day') at time zone 'Asia/Riyadh';
  is_service_role boolean := COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role';
BEGIN
  IF NOT is_service_role AND NOT security.has_platform_permission('view_db_health') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'db_size_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'table_stats', (
      SELECT jsonb_agg(jsonb_build_object(
        'table', stats.relname,
        'rows', stats.n_live_tup,
        'size_bytes', pg_catalog.pg_total_relation_size(stats.relid)
      ) ORDER BY stats.n_live_tup DESC)
      FROM pg_catalog.pg_stat_user_tables stats
      WHERE stats.schemaname = 'public'
    ),
    'active_connections', (
      SELECT count(*) FROM pg_catalog.pg_stat_activity
      WHERE state = 'active' AND datname = pg_catalog.current_database()
    ),
    'total_connections', (
      SELECT count(*) FROM pg_catalog.pg_stat_activity
      WHERE datname = pg_catalog.current_database()
    ),
    'max_connections', (
      SELECT setting::int FROM pg_catalog.pg_settings WHERE name = 'max_connections'
    ),
    'queue_stats', (
      SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE status = 'pending'),
        'running', count(*) FILTER (WHERE status IN ('processing','running')),
        'failed', count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours'),
        'done_today', count(*) FILTER (WHERE status IN ('done','success') AND created_at > now() - interval '24 hours'),
        'stalled', count(*) FILTER (
          WHERE status IN ('pending','processing','running')
            AND COALESCE(started_at, created_at) < now() - interval '30 minutes'
        )
      ) FROM public.sync_queue
    ),
    'upload_stats', (
      SELECT jsonb_build_object(
        'processing', count(*) FILTER (WHERE status = 'processing'),
        'stalled', count(*) FILTER (WHERE status = 'processing' AND uploaded_at < now() - interval '30 minutes'),
        'failed_24h', count(*) FILTER (WHERE status = 'failed' AND uploaded_at > now() - interval '24 hours'),
        'success_24h', count(*) FILTER (WHERE status = 'success' AND uploaded_at > now() - interval '24 hours'),
        'last_success_at', max(finished_at) FILTER (WHERE status = 'success')
      ) FROM public.platform_file_uploads
    ),
    'sync_stats', (
      SELECT jsonb_build_object(
        'errors_24h', count(*) FILTER (WHERE status = 'error' AND started_at > now() - interval '24 hours'),
        'success_24h', count(*) FILTER (WHERE status = 'success' AND started_at > now() - interval '24 hours'),
        'last_success_at', max(finished_at) FILTER (WHERE status = 'success'),
        'last_error_at', max(finished_at) FILTER (WHERE status = 'error')
      ) FROM public.sync_logs
    ),
    'stale_active_connections', (
      SELECT count(*) FROM public.platform_credentials
      WHERE is_active = true
        AND (last_sync_at IS NULL OR last_sync_at < now() - interval '24 hours')
    ),
    'recent_incidents', (
      SELECT COALESCE(jsonb_agg(incident ORDER BY incident_time DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'source', 'sync', 'merchant_code', merchant_code, 'platform', platform,
          'occurred_at', COALESCE(finished_at, started_at),
          'message', left(COALESCE(error_message, 'فشلت المزامنة'), 240)
        ) AS incident,
        COALESCE(finished_at, started_at) AS incident_time
        FROM public.sync_logs WHERE status = 'error'
        UNION ALL
        SELECT jsonb_build_object(
          'source', 'upload', 'merchant_code', merchant_code, 'platform', platform,
          'occurred_at', COALESCE(finished_at, uploaded_at),
          'message', left(COALESCE(error_message, 'فشل استيراد الملف'), 240)
        ) AS incident,
        COALESCE(finished_at, uploaded_at) AS incident_time
        FROM public.platform_file_uploads WHERE status = 'failed'
        ORDER BY incident_time DESC LIMIT 10
      ) incidents
    ),
    'webhook_errors_24h', (
      SELECT count(*) FROM public.webhook_events
      WHERE status = 'failed' AND received_at > now() - interval '24 hours'
    ),
    'merchant_count', (SELECT count(*) FROM public.merchants WHERE role = 'merchant'),
    'active_subscriptions', (SELECT count(*) FROM public.subscriptions WHERE status = 'active'),
    'suspended_merchants', (SELECT count(*) FROM public.merchants WHERE subscription_status = 'suspended'),
    'orders_total', (SELECT count(*) FROM public.orders),
    'orders_today', (
      SELECT count(*) FROM public.orders
      WHERE order_date >= today_start AND order_date < tomorrow_start
    ),
    'cache_hit_ratio', (
      SELECT round(100.0 * sum(heap_blks_hit) /
        nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 1)
      FROM pg_catalog.pg_statio_user_tables
    ),
    'oldest_pending_minutes', (
      SELECT round(extract(epoch FROM (now() - min(created_at))) / 60)
      FROM public.sync_queue WHERE status = 'pending'
    )
  ) INTO result;

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.get_db_health_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_db_health_internal() TO service_role;
