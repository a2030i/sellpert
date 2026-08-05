BEGIN;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.list_marketplace_operation_facts(text,text,uuid,text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'marketplace operation feed is executable without authentication';
  END IF;
  IF has_table_privilege('authenticated', 'public.marketplace_action_logs', 'SELECT') THEN
    RAISE EXCEPTION 'browser role can still read marketplace request/response payloads';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.marketplace_action_logs', 'SELECT') THEN
    RAISE EXCEPTION 'trusted marketplace worker lost raw action-log access';
  END IF;
END
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at,
  is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-0000-0000-00000000f650','authenticated','authenticated','ops-owner@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f651','authenticated','authenticated','ops-dashboard@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f652','authenticated','authenticated','ops-products@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f653','authenticated','authenticated','ops-orders@example.test','','{}','{}',now(),now(),now(),false,false),
  ('00000000-0000-0000-0000-00000000f654','authenticated','authenticated','ops-other@example.test','','{}','{}',now(),now(),now(),false,false);

INSERT INTO public.merchants (
  id, merchant_code, name, email, role, owner_merchant_code, permissions, is_active
) VALUES
  ('00000000-0000-0000-0000-00000000f650','OPS-OWNER','Ops owner','ops-owner@example.test','merchant',NULL,'{}',true),
  ('00000000-0000-0000-0000-00000000f651','OPS-DASH','Ops dashboard','ops-dashboard@example.test','employee','OPS-OWNER','{"dashboard":true}',true),
  ('00000000-0000-0000-0000-00000000f652','OPS-PRODUCTS','Ops products','ops-products@example.test','employee','OPS-OWNER','{"products":true}',true),
  ('00000000-0000-0000-0000-00000000f653','OPS-ORDERS','Ops orders','ops-orders@example.test','employee','OPS-OWNER','{"orders":true}',true),
  ('00000000-0000-0000-0000-00000000f654','OPS-OTHER','Ops other','ops-other@example.test','merchant',NULL,'{}',true);

INSERT INTO public.products (id, merchant_code, name, barcode, external_id, raw)
VALUES (
  '00000000-0000-0000-0000-00000000f660','OPS-OWNER','Safe product','SAFE-BARCODE','CONTENT-660',
  '{"providerInternal":"must-not-leak"}'
);

INSERT INTO public.orders (merchant_code, platform, order_id, status, total_amount)
VALUES ('OPS-OWNER','trendyol','ORDER-660','processing',42);

INSERT INTO public.order_packages (
  merchant_code, platform, order_id, shipment_package_id, cargo_tracking_number, status, raw
) VALUES (
  'OPS-OWNER','trendyol','ORDER-660','PACKAGE-660','TRACK-660','Created',
  '{"customerName":"must-not-leak"}'
);

INSERT INTO public.marketplace_action_logs (
  merchant_code, platform, action, risk_level, status, request, response,
  external_batch_id, error_message
) VALUES (
  'OPS-OWNER','trendyol','products.v2_update_content','write','failed',
  '{"payload":{"items":[{"contentId":"CONTENT-660","title":"private provider payload"}]}}',
  '{"provider":"must-not-leak"}','batch-123456789','api_key=supersecret'
), (
  'OPS-OWNER','trendyol','packages.tracking','write','success',
  '{"path":{"packageId":"PACKAGE-660"},"payload":{"customer":"must-not-leak"}}',
  '{"provider":"must-not-leak"}',NULL,NULL
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f651","role":"authenticated"}', true);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.list_marketplace_operation_facts('OPS-OWNER','trendyol',NULL,NULL,NULL,100)) <> 2 THEN
    RAISE EXCEPTION 'dashboard employee cannot read the safe marketplace operation feed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.list_marketplace_operation_facts('OPS-OWNER','trendyol',NULL,NULL,NULL,100)
    WHERE target_type = 'product'
      AND target_id = '00000000-0000-0000-0000-00000000f660'
      AND reference = 'TY-23456789'
      AND error_message NOT LIKE '%supersecret%'
  ) THEN
    RAISE EXCEPTION 'product target, short reference or secret redaction is incorrect';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.list_marketplace_operation_facts('OPS-OWNER','trendyol',NULL,NULL,NULL,100)
    WHERE target_type = 'order' AND target_id = 'ORDER-660'
  ) THEN
    RAISE EXCEPTION 'order target was not resolved safely';
  END IF;
  IF EXISTS (SELECT 1 FROM public.list_marketplace_operation_facts('OPS-OTHER',NULL,NULL,NULL,NULL,100)) THEN
    RAISE EXCEPTION 'marketplace operation feed crossed the tenant boundary';
  END IF;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f652","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.list_marketplace_operation_facts(
    'OPS-OWNER','trendyol','00000000-0000-0000-0000-00000000f660',NULL,NULL,100
  )) <> 1 THEN
    RAISE EXCEPTION 'product-scoped operation history is incorrect';
  END IF;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000f653","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.list_marketplace_operation_facts(
    'OPS-OWNER','trendyol',NULL,NULL,'PACKAGE-660',100
  )) <> 1 THEN
    RAISE EXCEPTION 'package-scoped operation history is incorrect';
  END IF;
END
$$;

ROLLBACK;
