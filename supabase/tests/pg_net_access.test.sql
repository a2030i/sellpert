BEGIN;

DO $$
DECLARE
  extension_schema text;
BEGIN
  SELECT n.nspname INTO extension_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
  WHERE e.extname='pg_net';

  IF extension_schema <> 'extensions' THEN
    RAISE EXCEPTION 'pg_net extension remains in exposed schema: %', extension_schema;
  END IF;
  IF to_regprocedure('public.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'pg_net HTTP entry point leaked into public schema';
  END IF;
  IF has_function_privilege('anon','security.trigger_queue_worker()','EXECUTE')
     OR has_function_privilege('authenticated','security.trigger_queue_worker()','EXECUTE') THEN
    RAISE EXCEPTION 'browser roles can invoke the queue worker network wrapper';
  END IF;
  IF to_regprocedure('security.notify_order_whatsapp()') IS NOT NULL
     OR to_regprocedure('public.notify_order_whatsapp()') IS NOT NULL THEN
    RAISE EXCEPTION 'retired WhatsApp network trigger still exists';
  END IF;
  IF NOT has_function_privilege('service_role','security.trigger_queue_worker()','EXECUTE') THEN
    RAISE EXCEPTION 'trusted backend lost queue worker wrapper access';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname='zz_sellpert_restrict_pg_net_access') THEN
    RAISE EXCEPTION 'ineffective pg_net ACL guard still exists';
  END IF;
END
$$;

INSERT INTO public.app_settings (key,value,is_secret)
VALUES
  ('SUPABASE_ANON_KEY','test-publishable-key',true),
  ('QUEUE_WORKER_SECRET',repeat('a',64),true)
ON CONFLICT (key) DO UPDATE SET value=excluded.value, is_secret=true;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  before_count bigint;
  after_count bigint;
BEGIN
  SELECT count(*) INTO before_count FROM net.http_request_queue;
  PERFORM security.trigger_queue_worker();
  SELECT count(*) INTO after_count FROM net.http_request_queue;
  IF after_count <> before_count + 1 THEN
    RAISE EXCEPTION 'protected queue-worker trigger no longer enqueues pg_net requests';
  END IF;
END
$$;

ROLLBACK;
