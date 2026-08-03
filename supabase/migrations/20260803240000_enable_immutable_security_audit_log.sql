-- Immutable security/audit trail for sensitive SaaS mutations. The trigger
-- redacts credential fields before persistence and is the only writer.

ALTER TABLE public.audit_log
  ALTER COLUMN record_id TYPE text USING record_id::text;

CREATE INDEX IF NOT EXISTS audit_log_performed_at_idx
  ON public.audit_log (performed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_merchant_time_idx
  ON public.audit_log (merchant_code, performed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_time_idx
  ON public.audit_log (action, performed_at DESC);

CREATE OR REPLACE FUNCTION security.redact_audit_values(p_values jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_values IS NULL THEN NULL ELSE
    p_values
      - 'api_key' - 'api_secret' - 'secret'
      - 'access_token' - 'refresh_token' - 'authorization'
      - 'password' - 'encrypted_payload' - 'credential_payload'
      - 'client_secret' - 'webhook_secret'
  END
$$;

CREATE OR REPLACE FUNCTION security.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_row jsonb := COALESCE(v_new, v_old, '{}'::jsonb);
  v_actor text;
  v_record_id text;
  v_merchant_code text;
BEGIN
  v_actor := COALESCE(
    (SELECT auth.email()),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    current_user
  );
  v_record_id := COALESCE(v_row ->> 'id', v_row ->> 'merchant_code', v_row ->> 'key');
  v_merchant_code := COALESCE(v_row ->> 'merchant_code', v_row ->> 'owner_merchant_code');

  INSERT INTO public.audit_log (
    merchant_code, action, table_name, record_id,
    old_values, new_values, performed_by, performed_at
  ) VALUES (
    v_merchant_code, lower(TG_OP), TG_TABLE_NAME, v_record_id,
    security.redact_audit_values(v_old),
    security.redact_audit_values(v_new),
    v_actor, now()
  );

  RETURN COALESCE(NEW, OLD);
END
$$;

REVOKE ALL ON FUNCTION security.redact_audit_values(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security.write_audit_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.redact_audit_values(jsonb) TO service_role;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'merchants',
    'platform_credentials',
    'platform_connections',
    'merchant_account_links',
    'platform_file_uploads',
    'merchant_requests',
    'payment_requests'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS security_audit_mutation ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER security_audit_mutation AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION security.write_audit_log()',
      table_name
    );
  END LOOP;
END
$$;

-- Authenticated users cannot forge or mutate audit events. Trigger execution
-- continues through the SECURITY DEFINER owner context.
DROP POLICY IF EXISTS staff_insert_audit ON public.audit_log;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

-- Retain a little over one year of operational history and remove older rows
-- during a low-traffic window. Re-running the migration remains idempotent.
DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'audit-log-retention';
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
  PERFORM cron.schedule(
    'audit-log-retention',
    '17 3 * * *',
    $cron$DELETE FROM public.audit_log WHERE performed_at < now() - interval '400 days'$cron$
  );
END
$$;
