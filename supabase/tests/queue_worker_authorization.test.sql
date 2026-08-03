-- Scheduled queue execution uses a dedicated non-public secret. The browser
-- anon key must never be sufficient to start privileged background work.
BEGIN;

DO $$
DECLARE
  worker_secret text;
  trigger_definition text;
BEGIN
  SELECT value INTO worker_secret
  FROM public.app_settings
  WHERE key = 'QUEUE_WORKER_SECRET' AND is_secret;

  IF length(coalesce(worker_secret, '')) < 64 THEN
    RAISE EXCEPTION 'dedicated queue worker secret was not provisioned';
  END IF;

  SELECT pg_get_functiondef('security.trigger_queue_worker()'::regprocedure)
    INTO trigger_definition;
  IF position('x-queue-secret' IN trigger_definition) = 0 THEN
    RAISE EXCEPTION 'cron trigger does not send the dedicated worker secret';
  END IF;
  IF position('Authorization' IN trigger_definition) > 0
     OR position('Bearer ' IN trigger_definition) > 0 THEN
    RAISE EXCEPTION 'cron trigger still treats a bearer/anon token as worker authorization';
  END IF;

  IF has_function_privilege('anon', 'security.trigger_queue_worker()', 'execute')
     OR has_function_privilege('authenticated', 'security.trigger_queue_worker()', 'execute') THEN
    RAISE EXCEPTION 'untrusted API roles can execute the private queue trigger';
  END IF;
  IF NOT has_function_privilege('service_role', 'security.trigger_queue_worker()', 'execute') THEN
    RAISE EXCEPTION 'service role lost access to the private queue trigger';
  END IF;
END
$$;

ROLLBACK;

