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

  INSERT INTO public.orders (merchant_code, platform, order_id, total_amount)
  VALUES (tenant_a, 'trendyol', 'TENANT-A-ORDER', 10), (tenant_b, 'trendyol', 'TENANT-B-ORDER', 20);

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
BEGIN
  IF (SELECT count(*) FROM public.orders) <> 1 THEN
    RAISE EXCEPTION 'tenant owner isolation failed';
  END IF;
  IF (SELECT count(DISTINCT merchant_code) FROM public.orders) <> 1 THEN
    RAISE EXCEPTION 'tenant owner can see another tenant';
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
ROLLBACK;
