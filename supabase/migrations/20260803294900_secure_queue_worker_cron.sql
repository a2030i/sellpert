-- The Supabase anon key is intentionally public and must never authorize an
-- internal queue worker. Provision a dedicated random secret and send it only
-- from the privileged cron trigger.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

INSERT INTO public.app_settings (key, value, is_secret, description, updated_at)
VALUES (
  'QUEUE_WORKER_SECRET',
  encode(extensions.gen_random_bytes(32), 'hex'),
  true,
  'Dedicated secret for the database cron to invoke queue-worker.',
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = CASE
      WHEN nullif(btrim(public.app_settings.value), '') IS NULL THEN EXCLUDED.value
      ELSE public.app_settings.value
    END,
    is_secret = true,
    description = EXCLUDED.description,
    updated_at = now();

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
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trigger_queue_worker HTTP error: %', SQLERRM;
END
$$;

REVOKE ALL ON FUNCTION security.trigger_queue_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.trigger_queue_worker() TO service_role;

