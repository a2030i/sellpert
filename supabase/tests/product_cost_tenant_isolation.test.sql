-- Regression: a merchant may bulk-update its own product costs only.
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-4000-8000-000000009971', 'authenticated', 'authenticated', 'cost-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Cost A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009972', 'authenticated', 'authenticated', 'cost-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Cost B"}', now(), now(), now(), false, false);

INSERT INTO public.products (merchant_code, name, sku, cost_price, target_net_price)
SELECT merchant_code, 'Cost fixture', 'COST-' || merchant_code, 0, 100
FROM public.merchants
WHERE id IN ('00000000-0000-4000-8000-000000009971', '00000000-0000-4000-8000-000000009972');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000009971';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009971","email":"cost-a@test.invalid","role":"authenticated"}';

DO $$
DECLARE
  own_code text := public.current_merchant_code();
  foreign_code text;
  outcome record;
BEGIN
  SELECT merchant_code INTO foreign_code FROM public.merchants WHERE id = '00000000-0000-4000-8000-000000009972';
  SELECT * INTO outcome FROM public.bulk_update_product_costs(jsonb_build_array(
    jsonb_build_object('identifier', 'COST-' || own_code, 'cost_price', '31.25'),
    jsonb_build_object('identifier', 'COST-' || foreign_code, 'cost_price', '99')
  ));

  IF outcome.updated_count <> 1 THEN
    RAISE EXCEPTION 'own product cost was not updated exactly once';
  END IF;
  IF (SELECT cost_price FROM public.products WHERE sku = 'COST-' || own_code) <> 31.25 THEN
    RAISE EXCEPTION 'own product cost update failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE sku = 'COST-' || foreign_code) THEN
    RAISE EXCEPTION 'foreign product became visible during bulk cost update';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
