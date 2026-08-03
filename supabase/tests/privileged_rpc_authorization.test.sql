-- Regression coverage for tenant-owner, platform-staff, and active-account
-- authorization on privileged RPCs. All fixtures are rolled back.
BEGIN;

INSERT INTO public.merchants (
  id, merchant_code, name, email, role, is_active, permissions, onboarding_done
) VALUES
  ('a1100000-0000-4000-8000-000000000001','SEC-QA-A','Owner A','sec-a@test.invalid','merchant',true,'{}',true),
  ('a1100000-0000-4000-8000-000000000002','SEC-QA-B','Owner B','sec-b@test.invalid','merchant',true,'{}',true),
  ('a1100000-0000-4000-8000-000000000003','SEC-QA-EA','Employee A','sec-ea@test.invalid','employee',true,'{}',true),
  ('a1100000-0000-4000-8000-000000000004','SEC-QA-EB','Employee B','sec-eb@test.invalid','employee',true,'{}',true),
  ('a1100000-0000-4000-8000-000000000005','SEC-QA-INACTIVE','Inactive Owner','sec-i@test.invalid','merchant',false,'{}',true),
  ('a1100000-0000-4000-8000-000000000006','SEC-QA-STAFF-NO','Staff No','sec-sn@test.invalid','staff',true,'[]',true),
  ('a1100000-0000-4000-8000-000000000007','SEC-QA-STAFF-YES','Staff Yes','sec-sy@test.invalid','staff',true,'["delete_merchants","view_db_health"]',true),
  ('a1100000-0000-4000-8000-000000000008','SEC-QA-ADMIN','Admin','sec-admin@test.invalid','admin',true,'[]',true),
  ('a1100000-0000-4000-8000-000000000009','SEC-QA-ADMIN-OFF','Admin Off','sec-admin-off@test.invalid','admin',false,'[]',true);

UPDATE public.merchants SET owner_merchant_code='SEC-QA-A' WHERE merchant_code='SEC-QA-EA';
UPDATE public.merchants SET owner_merchant_code='SEC-QA-B' WHERE merchant_code='SEC-QA-EB';

SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated","email":"sec-a@test.invalid"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE employee_count bigint;
BEGIN
  SELECT count(*) INTO employee_count FROM public.my_employees();
  IF employee_count <> 1 THEN RAISE EXCEPTION 'owner employee isolation failed'; END IF;

  PERFORM public.update_employee(
    'SEC-QA-EA', '{"orders":true,"products":false}'::jsonb, NULL, 'Operations', NULL
  );

  BEGIN
    PERFORM public.update_employee('SEC-QA-EB', '{"orders":true}'::jsonb, NULL, NULL, NULL);
    RAISE EXCEPTION 'cross-tenant employee update unexpectedly succeeded';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  BEGIN
    PERFORM public.update_employee('SEC-QA-EA', '{"team":true}'::jsonb, NULL, NULL, NULL);
    RAISE EXCEPTION 'team permission injection unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000003","role":"authenticated","email":"sec-ea@test.invalid"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    PERFORM public.update_employee('SEC-QA-EA', '{"orders":false}'::jsonb, NULL, NULL, NULL);
    RAISE EXCEPTION 'employee self-management unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000005","role":"authenticated","email":"sec-i@test.invalid"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    PERFORM public.update_employee('SEC-QA-EA', '{"orders":false}'::jsonb, NULL, NULL, NULL);
    RAISE EXCEPTION 'inactive owner unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000006', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000006","role":"authenticated","email":"sec-sn@test.invalid"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    PERFORM public.wipe_merchant_data('SEC-QA-B');
    RAISE EXCEPTION 'staff without delete permission unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_db_health();
    RAISE EXCEPTION 'staff without health permission unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000007', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000007","role":"authenticated","email":"sec-sy@test.invalid"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM public.get_db_health();
  PERFORM public.wipe_merchant_data('SEC-QA-B');
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000008', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000008","role":"authenticated","email":"sec-admin@test.invalid"}', true);
SET LOCAL ROLE authenticated;

DO $$ BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'active admin not recognized'; END IF;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000009', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000009","role":"authenticated","email":"sec-admin-off@test.invalid"}', true);
SET LOCAL ROLE authenticated;

DO $$ BEGIN
  IF public.is_admin() THEN RAISE EXCEPTION 'inactive admin recognized'; END IF;
END $$;

RESET ROLE;
ROLLBACK;
