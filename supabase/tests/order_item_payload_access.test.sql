BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at,
  is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-0000-0000-00000000f450','authenticated','authenticated','line-owner@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f451','authenticated','authenticated','line-dashboard@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f452','authenticated','authenticated','line-orders@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f453','authenticated','authenticated','line-other@example.test','','{}','{}',now(),now(),now(),false,false);

INSERT INTO public.merchants (
  id, merchant_code, name, email, role, owner_merchant_code, permissions, is_active
) VALUES
  ('00000000-0000-0000-0000-00000000f450','LINE-OWNER','Line owner','line-owner@example.test','merchant',NULL,'{}',true),
  ('00000000-0000-0000-0000-00000000f451','LINE-DASH','Dashboard employee','line-dashboard@example.test','employee','LINE-OWNER','{"dashboard":true,"orders":false}',true),
  ('00000000-0000-0000-0000-00000000f452','LINE-OPS','Orders employee','line-orders@example.test','employee','LINE-OWNER','{"dashboard":false,"orders":true}',true),
  ('00000000-0000-0000-0000-00000000f453','LINE-OTHER','Other merchant','line-other@example.test','merchant',NULL,'{}',true);

INSERT INTO public.order_items (
  merchant_code, platform, order_id, line_id, sku, product_name, raw, catalog_raw
) VALUES (
  'LINE-OWNER','trendyol','LINE-ORDER','LINE-1','SAFE-SKU','Safe product',
  '{"customerNote":"must-not-leak"}', '{"providerInternal":"must-not-leak"}'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f451","role":"authenticated"}', true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_items WHERE merchant_code = 'LINE-OWNER') THEN
    RAISE EXCEPTION 'dashboard employee can read order item provider payloads';
  END IF;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f452","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.order_items
    WHERE merchant_code = 'LINE-OWNER'
      AND raw ->> 'customerNote' = 'must-not-leak'
      AND catalog_raw ->> 'providerInternal' = 'must-not-leak'
  ) THEN
    RAISE EXCEPTION 'orders employee lost legitimate order-item access';
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_items WHERE merchant_code = 'LINE-OTHER') THEN
    RAISE EXCEPTION 'order-item access crossed the tenant boundary';
  END IF;
END
$$;

ROLLBACK;
