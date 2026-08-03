-- Repeatable integration regression for `supabase test db` or a disposable
-- database. The transaction is rolled back and leaves no fixture data.
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-4000-8000-000000009901', 'authenticated', 'authenticated', 'tenant-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Tenant A"}', now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009902', 'authenticated', 'authenticated', 'tenant-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Tenant B"}', now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009903', 'authenticated', 'authenticated', 'employee-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{}'::jsonb, now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009904', 'authenticated', 'authenticated', 'staff-read@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{}'::jsonb, now(), now(), false, false);

DO $$
DECLARE
  tenant_a text;
  tenant_b text;
BEGIN
  SELECT merchant_code INTO tenant_a FROM public.merchants WHERE id = '00000000-0000-4000-8000-000000009901';
  SELECT merchant_code INTO tenant_b FROM public.merchants WHERE id = '00000000-0000-4000-8000-000000009902';

  INSERT INTO public.merchants (id, merchant_code, name, email, role, owner_merchant_code, permissions, currency, subscription_plan, subscription_status, signup_source)
  VALUES ('00000000-0000-4000-8000-000000009903', 'E-ISO-A', 'Employee A', 'employee-a@test.invalid', 'employee', tenant_a, '{"orders":true,"statement":false}'::jsonb, 'SAR', 'free', 'active', 'test');

  INSERT INTO public.merchants (id, merchant_code, name, email, role, permissions, currency, subscription_plan, subscription_status, signup_source)
  VALUES ('00000000-0000-4000-8000-000000009904', 'S-ISO-READ', 'Platform Read Staff', 'staff-read@test.invalid', 'staff', '["view_merchants"]'::jsonb, 'SAR', 'free', 'active', 'test');

  INSERT INTO public.orders (merchant_code, platform, order_id, total_amount)
  VALUES (tenant_a, 'trendyol', 'TENANT-A-ORDER', 10), (tenant_b, 'trendyol', 'TENANT-B-ORDER', 20);

  -- One marketplace order may be split into multiple shipment packages. Keep
  -- all packages while preserving the same tenant boundary as the parent order.
  INSERT INTO public.order_packages (merchant_code, platform, order_id, shipment_package_id, status)
  VALUES
    (tenant_a, 'trendyol', 'TENANT-A-ORDER', 'TENANT-A-PACKAGE-1', 'Picking'),
    (tenant_a, 'trendyol', 'TENANT-A-ORDER', 'TENANT-A-PACKAGE-2', 'Invoiced'),
    (tenant_b, 'trendyol', 'TENANT-B-ORDER', 'TENANT-B-PACKAGE-1', 'Delivered');

  INSERT INTO public.platform_file_uploads (id, merchant_code, platform, file_name, file_type, status)
  VALUES
    ('00000000-0000-4000-a000-000000009911', tenant_a, 'amazon', 'tenant-a.xlsx', 'orders', 'completed'),
    ('00000000-0000-4000-a000-000000009912', tenant_b, 'amazon', 'tenant-b.xlsx', 'orders', 'completed');

  INSERT INTO public.products (merchant_code, name, sku, platform_source)
  VALUES
    (tenant_a, 'Tenant A Product', 'TENANT-A-SKU', 'trendyol'),
    (tenant_b, 'Tenant B Product', 'TENANT-B-SKU', 'trendyol');

  INSERT INTO public.inventory (merchant_code, sku, product_name, platform, quantity)
  VALUES
    (tenant_a, 'TENANT-A-SKU', 'Tenant A Product', 'trendyol', 5),
    (tenant_b, 'TENANT-B-SKU', 'Tenant B Product', 'trendyol', 7);

  INSERT INTO public.account_transactions (merchant_code, platform)
  VALUES (tenant_a, 'trendyol');

  INSERT INTO public.ad_metrics (merchant_code, platform, report_date, spend)
  VALUES (tenant_a, 'trendyol', current_date, 999);
END
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009901', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009901","email":"tenant-a@test.invalid","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  blocked_platform_kpis boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.orders) <> 1 THEN
    RAISE EXCEPTION 'tenant owner isolation failed';
  END IF;
  IF (SELECT count(DISTINCT merchant_code) FROM public.orders) <> 1 THEN
    RAISE EXCEPTION 'tenant owner can see another tenant';
  END IF;
  IF (SELECT count(*) FROM public.order_packages WHERE shipment_package_id LIKE 'TENANT-%-PACKAGE-%') <> 2 THEN
    RAISE EXCEPTION 'tenant owner package isolation or split-package preservation failed';
  END IF;
  IF (SELECT count(*) FROM public.products WHERE sku IN ('TENANT-A-SKU','TENANT-B-SKU')) <> 1 THEN
    RAISE EXCEPTION 'tenant owner product isolation failed';
  END IF;
  IF (SELECT count(*) FROM public.inventory WHERE sku IN ('TENANT-A-SKU','TENANT-B-SKU')) <> 1 THEN
    RAISE EXCEPTION 'tenant owner inventory isolation failed';
  END IF;
  IF (SELECT count(*) FROM public.platform_file_uploads WHERE file_name IN ('tenant-a.xlsx','tenant-b.xlsx')) <> 1 THEN
    RAISE EXCEPTION 'tenant owner upload isolation failed';
  END IF;

  BEGIN
    PERFORM public.team_dashboard_kpis();
  EXCEPTION WHEN insufficient_privilege THEN
    blocked_platform_kpis := true;
  END;
  IF NOT blocked_platform_kpis THEN
    RAISE EXCEPTION 'merchant accessed platform-wide team KPIs';
  END IF;
END
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009903', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009903","email":"employee-a@test.invalid","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  blocked_finance_write boolean := false;
BEGIN
  IF public.current_merchant_code() IS DISTINCT FROM (
    SELECT owner_merchant_code FROM public.merchants WHERE id = '00000000-0000-4000-8000-000000009903'
  ) THEN
    RAISE EXCEPTION 'employee effective tenant resolution failed';
  END IF;
  IF (SELECT count(*) FROM public.orders) <> 1 THEN
    RAISE EXCEPTION 'employee owner-tenant read failed';
  END IF;
  IF (SELECT count(DISTINCT merchant_code) FROM public.orders) <> 1 THEN
    RAISE EXCEPTION 'employee can see another tenant';
  END IF;
  IF (SELECT count(*) FROM public.order_packages WHERE shipment_package_id LIKE 'TENANT-%-PACKAGE-%') <> 2 THEN
    RAISE EXCEPTION 'employee package read permission or tenant isolation failed';
  END IF;
  IF (SELECT count(*) FROM public.products WHERE sku IN ('TENANT-A-SKU','TENANT-B-SKU')) <> 0 THEN
    RAISE EXCEPTION 'employee bypassed a disabled products permission';
  END IF;
  IF (SELECT count(*) FROM public.inventory WHERE sku IN ('TENANT-A-SKU','TENANT-B-SKU')) <> 0 THEN
    RAISE EXCEPTION 'employee bypassed a disabled inventory permission';
  END IF;
  IF (SELECT count(*) FROM public.platform_file_uploads WHERE file_name IN ('tenant-a.xlsx','tenant-b.xlsx')) <> 0 THEN
    RAISE EXCEPTION 'employee bypassed a disabled integrations permission';
  END IF;
  IF (SELECT count(*) FROM public.account_transactions) <> 0 THEN
    RAISE EXCEPTION 'employee bypassed a disabled finance permission';
  END IF;
  IF (SELECT count(*) FROM public.ad_metrics) <> 0 THEN
    RAISE EXCEPTION 'employee bypassed a disabled marketing permission';
  END IF;

  BEGIN
    INSERT INTO public.account_transactions (merchant_code, platform)
    VALUES (public.current_merchant_code(), 'trendyol');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked_finance_write := true;
  END;
  IF NOT blocked_finance_write THEN
    RAISE EXCEPTION 'employee wrote finance data without permission';
  END IF;

  UPDATE public.orders SET status = 'processing' WHERE order_id = 'TENANT-A-ORDER';
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE order_id = 'TENANT-A-ORDER' AND status = 'processing') THEN
    RAISE EXCEPTION 'employee with orders permission cannot update an own order';
  END IF;
END
$$;

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009904', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009904","email":"staff-read@test.invalid","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  blocked_finance_write boolean := false;
BEGIN
  IF public.is_staff() THEN
    RAISE EXCEPTION 'limited platform staff was promoted to unrestricted staff';
  END IF;
  IF (SELECT count(*) FROM public.orders WHERE order_id IN ('TENANT-A-ORDER','TENANT-B-ORDER')) <> 2 THEN
    RAISE EXCEPTION 'platform staff with view_merchants cannot read merchant orders';
  END IF;
  IF (SELECT count(*) FROM public.order_packages WHERE shipment_package_id LIKE 'TENANT-%-PACKAGE-%') <> 3 THEN
    RAISE EXCEPTION 'platform staff with view_merchants cannot read shipment packages';
  END IF;
  IF (SELECT count(*) FROM public.account_transactions) <> 0 THEN
    RAISE EXCEPTION 'platform staff bypassed view_finance permission';
  END IF;
  IF (SELECT count(*) FROM public.ad_metrics) <> 0 THEN
    RAISE EXCEPTION 'platform staff bypassed manage_ads permission';
  END IF;

  BEGIN
    INSERT INTO public.account_transactions (merchant_code, platform)
    VALUES ((SELECT merchant_code FROM public.merchants WHERE role = 'merchant' ORDER BY merchant_code LIMIT 1), 'trendyol');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked_finance_write := true;
  END;
  IF NOT blocked_finance_write THEN
    RAISE EXCEPTION 'read-only platform staff wrote finance data';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
