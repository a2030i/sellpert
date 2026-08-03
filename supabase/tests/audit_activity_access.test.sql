-- Raw before/after payloads remain internal. Authenticated users consume only
-- the sanitized, authorization-checked activity-feed Edge Function.
BEGIN;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.audit_log', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated still has direct SELECT on raw audit_log';
  END IF;
  IF has_table_privilege('anon', 'public.audit_log', 'SELECT') THEN
    RAISE EXCEPTION 'anon can read raw audit_log';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.audit_log', 'SELECT') THEN
    RAISE EXCEPTION 'activity-feed service path cannot read audit_log';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.audit_log'::regclass) THEN
    RAISE EXCEPTION 'audit_log RLS is disabled';
  END IF;
END
$$;

ROLLBACK;
