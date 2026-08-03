-- Explicit identity links may grant access to one additional workspace, but
-- never to an unlinked third workspace. Privilege escalation stays blocked.
BEGIN;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a1300000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'link-a@test.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

INSERT INTO public.merchants (
  id, merchant_code, name, email, role, is_active, permissions, onboarding_done,
  owner_merchant_code
) VALUES
  ('a1300000-0000-4000-8000-000000000001','LINK-QA-A','Owner A','link-a@test.invalid','merchant',true,'{}',true,null),
  ('a1300000-0000-4000-8000-000000000002','LINK-QA-B','Owner B','link-b@test.invalid','merchant',true,'{}',true,null),
  ('a1300000-0000-4000-8000-000000000003','LINK-QA-C','Owner C','link-c@test.invalid','merchant',true,'{}',true,null),
  ('a1300000-0000-4000-8000-000000000004','LINK-QA-EA','Employee A','link-ea@test.invalid','employee',true,'{}',true,'LINK-QA-A');

INSERT INTO public.merchant_account_links (user_id, email, merchant_code, is_default)
VALUES (
  'a1300000-0000-4000-8000-000000000001',
  'legacy-email-is-not-authorization@test.invalid',
  'LINK-QA-B',
  false
);

SELECT set_config('request.jwt.claim.sub', 'a1300000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1300000-0000-4000-8000-000000000001","role":"authenticated","email":"different-email@test.invalid"}',
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  linked_count integer;
  visible_count integer;
BEGIN
  IF NOT security.can_access_merchant('LINK-QA-A') THEN
    RAISE EXCEPTION 'owner workspace was denied';
  END IF;
  IF NOT security.can_access_merchant('LINK-QA-B') THEN
    RAISE EXCEPTION 'explicit linked workspace was denied';
  END IF;
  IF security.can_access_merchant('LINK-QA-C') THEN
    RAISE EXCEPTION 'unlinked workspace was exposed';
  END IF;

  SELECT count(*) INTO linked_count FROM public.my_linked_merchants();
  IF linked_count <> 2 THEN
    RAISE EXCEPTION 'linked workspace list mismatch: %', linked_count;
  END IF;

  SELECT count(*) INTO visible_count
  FROM public.merchants
  WHERE merchant_code IN ('LINK-QA-A', 'LINK-QA-B', 'LINK-QA-C');
  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'merchant RLS isolation mismatch: %', visible_count;
  END IF;

  PERFORM public.update_my_store_profile(
    p_name => 'Linked Store Updated',
    p_merchant_code => 'LINK-QA-B'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants
    WHERE merchant_code = 'LINK-QA-B' AND name = 'Linked Store Updated'
  ) THEN
    RAISE EXCEPTION 'linked workspace profile update failed';
  END IF;

  BEGIN
    PERFORM public.update_my_store_profile(
      p_name => 'Forbidden Update',
      p_merchant_code => 'LINK-QA-C'
    );
    RAISE EXCEPTION 'unlinked workspace update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.merchants
    SET role = 'super_admin'
    WHERE merchant_code = 'LINK-QA-A';
    RAISE EXCEPTION 'merchant privilege escalation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE public.merchants
  SET onboarding_done = false
  WHERE merchant_code = 'LINK-QA-A';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'safe owner profile update was blocked';
  END IF;

  PERFORM public.update_employee(
    'LINK-QA-EA',
    '{"orders":true}'::jsonb,
    true,
    'Operations',
    'Employee Updated'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.my_employees()
    WHERE merchant_code = 'LINK-QA-EA'
      AND name = 'Employee Updated'
      AND permissions = '{"orders":true}'::jsonb
  ) THEN
    RAISE EXCEPTION 'owner employee management was blocked';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
