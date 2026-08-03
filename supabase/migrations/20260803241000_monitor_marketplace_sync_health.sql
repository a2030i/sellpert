-- Detect stalled marketplace jobs and notify the owning merchant once.
-- The monitor is intentionally database-owned so it continues to run even
-- when no merchant has the application open.

ALTER TABLE public.sync_queue
  ADD COLUMN IF NOT EXISTS health_alerted_at timestamptz;

CREATE INDEX IF NOT EXISTS sync_queue_health_monitor_idx
  ON public.sync_queue (status, scheduled_at)
  WHERE health_alerted_at IS NULL AND status IN ('pending', 'running', 'failed');

CREATE OR REPLACE FUNCTION security.monitor_sync_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stalled_running integer := 0;
  v_delayed_pending integer := 0;
  v_failed_alerts integer := 0;
  v_job record;
  v_platform_name text;
BEGIN
  WITH stalled AS (
    UPDATE public.sync_queue
       SET status = 'failed',
           finished_at = now(),
           error_message = COALESCE(error_message, 'Synchronization exceeded the maximum processing time')
     WHERE status = 'running'
       AND started_at < now() - interval '20 minutes'
     RETURNING id
  )
  SELECT count(*) INTO v_stalled_running FROM stalled;

  FOR v_job IN
    SELECT id, merchant_code, platform, status
      FROM public.sync_queue
     WHERE health_alerted_at IS NULL
       AND (
         (status = 'pending' AND scheduled_at < now() - interval '30 minutes')
         OR
         (status = 'failed' AND COALESCE(finished_at, created_at) >= now() - interval '24 hours')
       )
     ORDER BY created_at
     LIMIT 200
     FOR UPDATE SKIP LOCKED
  LOOP
    v_platform_name := CASE lower(v_job.platform)
      WHEN 'trendyol' THEN 'ترنديول'
      WHEN 'amazon' THEN 'أمازون'
      WHEN 'noon' THEN 'نون'
      WHEN 'salla' THEN 'سلة'
      WHEN 'zid' THEN 'زد'
      ELSE 'المنصة المرتبطة'
    END;

    INSERT INTO public.notifications (merchant_code, type, title, body, action_path)
    VALUES (
      v_job.merchant_code,
      CASE WHEN v_job.status = 'failed' THEN 'error' ELSE 'warning' END,
      CASE WHEN v_job.status = 'failed' THEN 'تحتاج المزامنة إلى إعادة المحاولة' ELSE 'تأخر بدء المزامنة' END,
      CASE
        WHEN v_job.status = 'failed' THEN 'لم تكتمل مزامنة ' || v_platform_name || '. افتح الربط ورفع الملفات ثم أعد المحاولة.'
        ELSE 'لم تبدأ مزامنة ' || v_platform_name || ' في الوقت المتوقع. لا تضغط الزر مرة أخرى؛ سنواصل المحاولة تلقائيًا.'
      END,
      '/integrations'
    );

    UPDATE public.sync_queue SET health_alerted_at = now() WHERE id = v_job.id;
    IF v_job.status = 'failed' THEN
      v_failed_alerts := v_failed_alerts + 1;
    ELSE
      v_delayed_pending := v_delayed_pending + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'stalled_running', v_stalled_running,
    'delayed_pending_alerts', v_delayed_pending,
    'failed_alerts', v_failed_alerts,
    'checked_at', now()
  );
END
$$;

REVOKE ALL ON FUNCTION security.monitor_sync_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.monitor_sync_health() TO service_role;

-- Do not alert on legacy failures during rollout.
UPDATE public.sync_queue
   SET health_alerted_at = now()
 WHERE status = 'failed'
   AND health_alerted_at IS NULL
   AND COALESCE(finished_at, created_at) < now() - interval '24 hours';

DO $$
DECLARE
  v_existing_job bigint;
BEGIN
  SELECT jobid INTO v_existing_job FROM cron.job WHERE jobname = 'sync-health-monitor';
  IF v_existing_job IS NOT NULL THEN PERFORM cron.unschedule(v_existing_job); END IF;
  PERFORM cron.schedule(
    'sync-health-monitor',
    '*/5 * * * *',
    $cron$SELECT security.monitor_sync_health()$cron$
  );
END
$$;

