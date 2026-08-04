-- Regression coverage for the public rebuild RPC authorization boundary.
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-4000-8000-000000009981', 'authenticated', 'authenticated', 'rebuild-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Rebuild A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009982', 'authenticated', 'authenticated', 'rebuild-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Rebuild B"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009983', 'authenticated', 'authenticated', 'rebuild-orphan@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{}'::jsonb, now(), now(), now(), false, false);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009981', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009981","email":"rebuild-a@test.invalid","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  tenant_b text := (
    SELECT merchant_code FROM public.merchants
    WHERE id = '00000000-0000-4000-8000-000000009982'
  );
  blocked boolean := false;
BEGIN
  BEGIN
    PERFORM public.rebuild_all_derived_data(tenant_b);
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'merchant rebuilt another tenant data';
  END IF;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009983', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009983","email":"rebuild-orphan@test.invalid","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  tenant_a text := (
    SELECT merchant_code FROM public.merchants
    WHERE id = '00000000-0000-4000-8000-000000009981'
  );
  blocked boolean := false;
BEGIN
  BEGIN
    PERFORM public.rebuild_all_derived_data(tenant_a);
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'authenticated user without a merchant profile reached rebuild work';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
