-- A suspended workspace must be inaccessible to its owner and all employees.
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-4000-8000-000000009971', 'authenticated', 'authenticated', 'suspended-owner@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Suspended Workspace"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009972', 'authenticated', 'authenticated', 'suspended-employee@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{}'::jsonb, now(), now(), now(), false, false);

DO $$
DECLARE
  owner_code text := (
    SELECT merchant_code FROM public.merchants
    WHERE id = '00000000-0000-4000-8000-000000009971'
  );
BEGIN
  INSERT INTO public.merchants (
    id, merchant_code, name, email, role, owner_merchant_code,
    permissions, currency, workspace_status, is_active
  ) VALUES (
    '00000000-0000-4000-8000-000000009972', 'E-SUSPENDED', 'Suspended Employee',
    'suspended-employee@test.invalid', 'employee', owner_code,
    '{"orders":true}'::jsonb, 'SAR', 'active', true
  );

  INSERT INTO public.orders (merchant_code, platform, order_id, total_amount)
  VALUES (owner_code, 'trendyol', 'SUSPENDED-WORKSPACE-ORDER', 10);

  UPDATE public.merchants SET is_active = false WHERE merchant_code = owner_code;
END
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009972', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009972","email":"suspended-employee@test.invalid","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF public.current_merchant_code() IS NOT NULL THEN
    RAISE EXCEPTION 'employee retained a suspended workspace identity';
  END IF;
  IF security.can_access_merchant((
    SELECT owner_merchant_code FROM public.merchants
    WHERE id = '00000000-0000-4000-8000-000000009972'
  )) THEN
    RAISE EXCEPTION 'employee retained access to a suspended workspace';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE order_id = 'SUSPENDED-WORKSPACE-ORDER') THEN
    RAISE EXCEPTION 'employee read data from a suspended workspace';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
