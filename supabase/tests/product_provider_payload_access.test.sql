BEGIN;

DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.products', 'raw', 'SELECT')
     OR has_column_privilege('authenticated', 'public.products', 'raw', 'INSERT')
     OR has_column_privilege('authenticated', 'public.products', 'raw', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated browser role can access the product provider payload';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.products', 'name', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.products', 'cost_price', 'UPDATE')
     OR NOT has_column_privilege('service_role', 'public.products', 'raw', 'SELECT') THEN
    RAISE EXCEPTION 'normalized catalog access or backend sync access was removed';
  END IF;
END
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at,
  is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-0000-0000-00000000f550','authenticated','authenticated','catalog-owner@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f551','authenticated','authenticated','catalog-products@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f552','authenticated','authenticated','catalog-other@example.test','','{}','{}',now(),now(),now(),false,false);

INSERT INTO public.merchants (
  id, merchant_code, name, email, role, owner_merchant_code, permissions, is_active
) VALUES
  ('00000000-0000-0000-0000-00000000f550','CATALOG-OWNER','Catalog owner','catalog-owner@example.test','merchant',NULL,'{}',true),
  ('00000000-0000-0000-0000-00000000f551','CATALOG-PRODUCTS','Catalog employee','catalog-products@example.test','employee','CATALOG-OWNER','{"products":true}',true),
  ('00000000-0000-0000-0000-00000000f552','CATALOG-OTHER','Other catalog','catalog-other@example.test','merchant',NULL,'{}',true);

INSERT INTO public.products (merchant_code, name, sku, cost_price, raw)
VALUES ('CATALOG-OWNER','Normalized product','CATALOG-SKU',12,'{"providerSecret":"must-not-leak"}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f551","role":"authenticated"}', true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT id, name, cost_price FROM public.products
    WHERE merchant_code = 'CATALOG-OWNER' AND sku = 'CATALOG-SKU'
  ) THEN
    RAISE EXCEPTION 'product employee lost normalized catalog access';
  END IF;

  IF EXISTS (SELECT id FROM public.products WHERE merchant_code = 'CATALOG-OTHER') THEN
    RAISE EXCEPTION 'product access crossed the tenant boundary';
  END IF;
END
$$;

ROLLBACK;
