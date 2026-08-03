-- Immutable audit log regression. Every change is rolled back.
BEGIN;

DO $$
DECLARE
  v_merchant_id uuid := '00000000-0000-4000-a000-000000000091';
  v_code text := 'AUDIT-TEST-091';
  v_before bigint;
  v_after bigint;
BEGIN
  INSERT INTO public.merchants (id, merchant_code, name, email, role, signup_source)
  VALUES (v_merchant_id, v_code, 'Audit Test Merchant', 'audit-test-091@example.invalid', 'merchant', 'manual');

  SELECT count(*) INTO v_before FROM public.audit_log;
  UPDATE public.merchants SET name = 'Audit Test Merchant Updated' WHERE id = v_merchant_id;
  SELECT count(*) INTO v_after FROM public.audit_log;

  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'merchant update did not append exactly one audit event';
  END IF;

  IF security.redact_audit_values('{"api_key":"secret","name":"visible"}'::jsonb) ? 'api_key'
     OR security.redact_audit_values('{"api_key":"secret","name":"visible"}'::jsonb) ->> 'name' <> 'visible' THEN
    RAISE EXCEPTION 'audit redaction failed';
  END IF;
END
$$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.audit_log (merchant_code, action, table_name)
    VALUES ('AUDIT-TEST-091', 'forged', 'audit_log');
    RAISE EXCEPTION 'authenticated user forged an audit event';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

ROLLBACK;
