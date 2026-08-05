BEGIN;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.list_return_facts(text,text)', 'execute') THEN
    RAISE EXCEPTION 'return facts RPC is executable without authentication';
  END IF;
END
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at,
  is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-0000-0000-00000000e450','authenticated','authenticated','fulfil-owner@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000e451','authenticated','authenticated','fulfil-dashboard@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000e452','authenticated','authenticated','fulfil-orders@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000e453','authenticated','authenticated','fulfil-other@example.test','','{}','{}',now(),now(),now(),false,false);

INSERT INTO public.merchants (
  id, merchant_code, name, email, role, owner_merchant_code, permissions, is_active
) VALUES
  ('00000000-0000-0000-0000-00000000e450','FULFIL-OWNER','Fulfil owner','fulfil-owner@example.test','merchant',NULL,'{}',true),
  ('00000000-0000-0000-0000-00000000e451','FULFIL-DASH','Dashboard employee','fulfil-dashboard@example.test','employee','FULFIL-OWNER','{"dashboard":true,"orders":false}',true),
  ('00000000-0000-0000-0000-00000000e452','FULFIL-OPS','Orders employee','fulfil-orders@example.test','employee','FULFIL-OWNER','{"dashboard":false,"orders":true}',true),
  ('00000000-0000-0000-0000-00000000e453','FULFIL-OTHER','Other merchant','fulfil-other@example.test','merchant',NULL,'{}',true);

INSERT INTO public.orders (merchant_code, platform, order_id, total_amount)
VALUES ('FULFIL-OWNER','trendyol','FULFIL-ORDER',42);
INSERT INTO public.order_packages (
  merchant_code, platform, order_id, shipment_package_id, status, raw
) VALUES (
  'FULFIL-OWNER','trendyol','FULFIL-ORDER','FULFIL-PACKAGE','Created',
  '{"customerName":"must-not-leak"}'
);
INSERT INTO public.returns (
  merchant_code, platform, order_id, sku, status, return_amount, raw
) VALUES (
  'FULFIL-OWNER','trendyol','FULFIL-ORDER','SAFE-SKU','pending',12,
  '{"customerPhone":"must-not-leak"}'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e451","role":"authenticated"}', true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_packages WHERE merchant_code = 'FULFIL-OWNER')
     OR EXISTS (SELECT 1 FROM public.returns WHERE merchant_code = 'FULFIL-OWNER') THEN
    RAISE EXCEPTION 'dashboard employee can read raw fulfillment tables';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.list_return_facts('FULFIL-OWNER', NULL)
    WHERE sku = 'SAFE-SKU' AND return_amount = 12
  ) THEN
    RAISE EXCEPTION 'dashboard employee cannot read safe return facts';
  END IF;
  IF EXISTS (SELECT 1 FROM public.list_return_facts('FULFIL-OTHER', NULL)) THEN
    RAISE EXCEPTION 'safe return facts crossed the tenant boundary';
  END IF;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e452","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.order_packages
    WHERE merchant_code = 'FULFIL-OWNER' AND raw ->> 'customerName' = 'must-not-leak'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.returns
    WHERE merchant_code = 'FULFIL-OWNER' AND raw ->> 'customerPhone' = 'must-not-leak'
  ) THEN
    RAISE EXCEPTION 'orders employee lost legitimate fulfillment access';
  END IF;
END
$$;

ROLLBACK;
