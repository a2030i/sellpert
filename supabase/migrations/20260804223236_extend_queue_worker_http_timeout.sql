-- queue-worker can legitimately spend up to 55 seconds processing a batch.
-- pg_net defaults to five seconds, which records a timeout even though the
-- Edge Function continues and completes the queued sync successfully.
CREATE OR REPLACE FUNCTION security.trigger_queue_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_anon_key text;
  v_worker_secret text;
BEGIN
  SELECT max(value) FILTER (WHERE key = 'SUPABASE_ANON_KEY'),
         max(value) FILTER (WHERE key = 'QUEUE_WORKER_SECRET')
    INTO v_anon_key, v_worker_secret
  FROM public.app_settings
  WHERE key IN ('SUPABASE_ANON_KEY', 'QUEUE_WORKER_SECRET');

  IF nullif(btrim(v_anon_key), '') IS NULL
     OR length(coalesce(v_worker_secret, '')) < 32 THEN
    RAISE WARNING 'trigger_queue_worker: required cron credentials are not configured';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://urdyzbsukcuibadlaath.supabase.co/functions/v1/queue-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'x-queue-secret', v_worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trigger_queue_worker HTTP error: %', SQLERRM;
END
$$;

REVOKE ALL ON FUNCTION security.trigger_queue_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.trigger_queue_worker() TO service_role;
