-- Immutable audit log regression. Every change is rolled back.
BEGIN;

DO $$
DECLARE
  v_merchant_id uuid := '00000000-0000-4000-a000-000000000091';
  v_code text := 'AUDIT-TEST-091';
  v_before bigint;
  v_after bigint;
  v_redacted jsonb;
  v_logged jsonb;
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

  v_redacted := security.redact_audit_values(
    '{
      "name":"visible",
      "extra":{"apiKey":"nested-secret","region":"sa"},
      "connections":[
        {"client_secret":"array-secret","label":"primary"},
        {"secret_blob":{"ciphertext":"encrypted-secret"},"label":"backup"}
      ]
    }'::jsonb
  );

  IF v_redacted #> '{extra,apiKey}' IS NOT NULL
     OR v_redacted #> '{connections,0,client_secret}' IS NOT NULL
     OR v_redacted #> '{connections,1,secret_blob}' IS NOT NULL THEN
    RAISE EXCEPTION 'nested audit credentials were retained: %', v_redacted;
  END IF;

  IF v_redacted #>> '{extra,region}' <> 'sa'
     OR v_redacted #>> '{connections,0,label}' <> 'primary'
     OR v_redacted #>> '{connections,1,label}' <> 'backup' THEN
    RAISE EXCEPTION 'non-sensitive nested audit evidence was removed: %', v_redacted;
  END IF;

  UPDATE public.merchants
  SET permissions = '{"dashboard":true,"provider":{"apiSecret":"must-not-reach-audit","label":"safe"}}'::jsonb
  WHERE id = v_merchant_id;

  SELECT new_values
  INTO v_logged
  FROM public.audit_log
  WHERE table_name = 'merchants'
    AND record_id = v_merchant_id::text
    AND action = 'update'
  ORDER BY performed_at DESC
  LIMIT 1;

  IF v_logged #> '{permissions,provider,apiSecret}' IS NOT NULL THEN
    RAISE EXCEPTION 'audit trigger persisted a nested credential: %', v_logged;
  END IF;

  IF v_logged #>> '{permissions,provider,label}' <> 'safe' THEN
    RAISE EXCEPTION 'audit trigger removed legitimate nested evidence: %', v_logged;
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
