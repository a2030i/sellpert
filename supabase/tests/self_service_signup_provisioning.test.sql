-- A self-service Auth signup must atomically create one isolated merchant
-- workspace with a scalable identifier. The fixture is always rolled back.
BEGIN;

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a1200000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'self-service-provisioning@test.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"signup_source":"self_service","name":"  متجر اختبار آمن  ","whatsapp_phone":"  +966500000000  "}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

DO $$
DECLARE
  v_row public.merchants%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_row
  FROM public.merchants
  WHERE id = 'a1200000-0000-4000-8000-000000000001';

  IF v_row.merchant_code !~ '^M-[A-F0-9]{16}$' THEN
    RAISE EXCEPTION 'unexpected merchant code: %', v_row.merchant_code;
  END IF;
  IF v_row.name <> 'متجر اختبار آمن' THEN
    RAISE EXCEPTION 'merchant name was not normalized';
  END IF;
  IF v_row.whatsapp_phone <> '+966500000000' THEN
    RAISE EXCEPTION 'merchant phone was not normalized';
  END IF;
  IF v_row.role <> 'merchant'
     OR v_row.subscription_plan <> 'free'
     OR v_row.subscription_status <> 'active'
     OR v_row.signup_source <> 'self_service'
     OR NOT v_row.is_active THEN
    RAISE EXCEPTION 'workspace defaults are incorrect';
  END IF;
END
$$;

ROLLBACK;
