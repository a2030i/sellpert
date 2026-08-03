-- Regression: the same marketplace sale can exist as an order, finance row,
-- and reporting snapshot. The performance layer must select one source only.
BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) VALUES (
  '00000000-0000-4000-8000-000000009981', 'authenticated', 'authenticated',
  'performance-source@test.invalid', '',
  '{"provider":"email","providers":["email"]}',
  '{"signup_source":"test","name":"Performance Source Test"}',
  now(), now(), false, false
);

INSERT INTO public.merchants
  (id, merchant_code, name, email, role, currency, subscription_plan, subscription_status, signup_source)
VALUES
  ('00000000-0000-4000-8000-000000009981', 'M-SOURCE-TEST', 'Performance Source Test',
   'performance-source@test.invalid', 'merchant', 'SAR', 'free', 'active', 'test');

DO $$
DECLARE tenant_code text;
BEGIN
  SELECT merchant_code INTO tenant_code
  FROM public.merchants
  WHERE id = '00000000-0000-4000-8000-000000009981';

  INSERT INTO public.orders
    (merchant_code, platform, order_id, status, total_amount, platform_fee, order_date)
  VALUES
    (tenant_code, 'amazon', 'SOURCE-AMAZON-ORDER', 'delivered', 100, 15, '2026-01-01'),
    (tenant_code, 'trendyol', 'SOURCE-TRENDYOL-ORDER', 'delivered', 50, 5, '2026-01-01');

  -- Same Amazon sale posted on another day in the finance report.
  INSERT INTO public.account_transactions
    (merchant_code, platform, transaction_no, transaction_type, transaction_date, credit, debit)
  VALUES
    (tenant_code, 'amazon', 'SOURCE-AMAZON-TX', 'Order', '2026-01-02', 100, 15);

  -- Lower-priority fallback sources must be ignored when canonical orders exist.
  INSERT INTO public.amazon_daily_sales
    (merchant_code, data_date, total_sales, units)
  VALUES (tenant_code, '2026-01-03', 100, 1);

  INSERT INTO public.product_performance_snapshots
    (merchant_code, platform, snapshot_date, sku, gross_sales, net_sold, discount)
  VALUES (tenant_code, 'trendyol', '2026-01-03', 'SOURCE-SKU', 50, 1, 2);

  -- Advertising remains an independent cost source and must survive rebuilding.
  INSERT INTO public.ad_metrics
    (merchant_code, platform, report_date, campaign_name, spend, revenue)
  VALUES (tenant_code, 'amazon', '2026-01-04', 'Source Test', 10, 40);

  PERFORM public.rebuild_performance_data(tenant_code);

  IF (SELECT sum(total_sales) FROM public.performance_data WHERE merchant_code=tenant_code AND platform='amazon') <> 100 THEN
    RAISE EXCEPTION 'Amazon sale was counted from more than one source';
  END IF;
  IF (SELECT sum(order_count) FROM public.performance_data WHERE merchant_code=tenant_code AND platform='amazon') <> 1 THEN
    RAISE EXCEPTION 'Amazon order count was duplicated across sources';
  END IF;
  IF (SELECT sum(platform_fees) FROM public.performance_data WHERE merchant_code=tenant_code AND platform='amazon') <> 15 THEN
    RAISE EXCEPTION 'Amazon platform fees were not preserved from canonical orders';
  END IF;
  IF (SELECT sum(total_sales) FROM public.performance_data WHERE merchant_code=tenant_code AND platform='trendyol') <> 50 THEN
    RAISE EXCEPTION 'Trendyol snapshot duplicated canonical orders';
  END IF;
  IF (SELECT sum(platform_fees) FROM public.performance_data WHERE merchant_code=tenant_code AND platform='trendyol') <> 5 THEN
    RAISE EXCEPTION 'Trendyol platform fees were not preserved from canonical orders';
  END IF;
  IF (SELECT sum(ad_spend) FROM public.performance_data WHERE merchant_code=tenant_code AND platform='amazon') <> 10 THEN
    RAISE EXCEPTION 'Advertising spend was lost while rebuilding performance';
  END IF;
END
$$;

ROLLBACK;
