-- Sync health monitor regression. Every change is rolled back.
BEGIN;

INSERT INTO public.merchants (id, merchant_code, name, email, role, signup_source)
VALUES (
  '00000000-0000-4000-a000-000000000092',
  'SYNC-HEALTH-092',
  'Sync Health Test Merchant',
  'sync-health-092@example.invalid',
  'merchant',
  'manual'
);

INSERT INTO public.sync_queue (
  merchant_code, platform, job_type, status, scheduled_at, started_at
) VALUES (
  'SYNC-HEALTH-092', 'trendyol', 'sync_all', 'running',
  now() - interval '40 minutes', now() - interval '30 minutes'
);

SELECT security.monitor_sync_health();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_queue
     WHERE merchant_code = 'SYNC-HEALTH-092'
       AND status = 'failed'
       AND health_alerted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'stalled job was not failed and marked as alerted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
     WHERE merchant_code = 'SYNC-HEALTH-092'
       AND type = 'error'
       AND action_path = '/integrations'
  ) THEN
    RAISE EXCEPTION 'merchant did not receive a sync health notification';
  END IF;
END
$$;

ROLLBACK;
