-- The public wrapper and the internal implementation must enforce the same
-- platform permission. Direct execution remains service-role only.
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
    'db_size_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'table_stats', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'table', t.relname,
          'rows', t.n_live_tup,
          'size_bytes', pg_catalog.pg_total_relation_size(t.relid)
        ) ORDER BY t.n_live_tup DESC
      )
      FROM pg_catalog.pg_stat_user_tables t
      WHERE t.schemaname = 'public'
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
        'running', count(*) FILTER (WHERE status = 'running'),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'done_today', count(*) FILTER (WHERE status = 'done' AND created_at > now() - interval '24 hours')
      )
      FROM public.sync_queue
    ),
    'webhook_errors_24h', (
      SELECT count(*) FROM public.webhook_events
      WHERE status = 'failed' AND received_at > now() - interval '24 hours'
    ),
    'merchant_count', (
      SELECT count(*) FROM public.merchants WHERE role = 'merchant'
    ),
    'active_subscriptions', (
      SELECT count(*) FROM public.subscriptions WHERE status = 'active'
    ),
    'suspended_merchants', (
      SELECT count(*) FROM public.merchants WHERE subscription_status = 'suspended'
    ),
    'orders_total', (SELECT count(*) FROM public.orders),
    'orders_today', (
      SELECT count(*) FROM public.orders
      WHERE order_date >= today_start AND order_date < tomorrow_start
    ),
    'cache_hit_ratio', (
      SELECT round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 1)
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
