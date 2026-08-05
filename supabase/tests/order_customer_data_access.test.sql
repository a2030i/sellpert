BEGIN;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.list_order_operating_facts(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'safe order facts RPC is executable without authentication';
  END IF;
END
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at,
  is_sso_user, is_anonymous
) VALUES (
  '00000000-0000-0000-0000-00000000d450', 'authenticated', 'authenticated',
  'pii-owner@example.test', '', '{}'::jsonb, '{}'::jsonb,
  now(), now(), now(), false, false
), (
  '00000000-0000-0000-0000-00000000d451', 'authenticated', 'authenticated',
  'dashboard-only@example.test', '', '{}'::jsonb, '{}'::jsonb,
  now(), now(), now(), false, false
), (
  '00000000-0000-0000-0000-00000000d452', 'authenticated', 'authenticated',
  'orders-operator@example.test', '', '{}'::jsonb, '{}'::jsonb,
  now(), now(), now(), false, false
);

INSERT INTO public.merchants (
  id, merchant_code, name, email, role, owner_merchant_code, permissions, is_active
) VALUES (
  '00000000-0000-0000-0000-00000000d450', 'PII-OWNER', 'PII owner',
  'pii-owner@example.test', 'merchant', NULL, '{}'::jsonb, true
), (
  '00000000-0000-0000-0000-00000000d451', 'PII-EMPLOYEE', 'Dashboard employee',
  'dashboard-only@example.test', 'employee', 'PII-OWNER',
  '{"dashboard":true,"orders":false}'::jsonb, true
), (
  '00000000-0000-0000-0000-00000000d452', 'PII-OPERATOR', 'Orders operator',
  'orders-operator@example.test', 'employee', 'PII-OWNER',
  '{"dashboard":false,"orders":true}'::jsonb, true
);

INSERT INTO public.orders (
  merchant_code, platform, order_id, status, product_name, sku, quantity,
  total_amount, customer_city, shipment_address, invoice_address, raw
) VALUES (
  'PII-OWNER', 'trendyol', 'secret-order-reference', 'shipped', 'Safe product',
  'SAFE-SKU', 2, 42, 'Riyadh', '{"name":"Private customer"}',
  '{"phone":"0500000000"}', '{"providerSecret":"must-not-leak"}'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000d451',
  'role', 'authenticated'
)::text, true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE merchant_code = 'PII-OWNER') THEN
    RAISE EXCEPTION 'dashboard-only employee can still read the base orders table';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.list_order_operating_facts('PII-OWNER', NULL)
    WHERE sku = 'SAFE-SKU' AND total_amount = 42
  ) THEN
    RAISE EXCEPTION 'dashboard-only employee cannot read safe operating facts';
  END IF;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-00000000d452',
  'role', 'authenticated'
)::text, true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE merchant_code = 'PII-OWNER'
      AND shipment_address ->> 'name' = 'Private customer'
  ) THEN
    RAISE EXCEPTION 'orders employee lost legitimate operational access';
  END IF;
END
$$;

ROLLBACK;
