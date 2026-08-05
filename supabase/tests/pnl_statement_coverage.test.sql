-- Regression: the public financial statement is tenant-scoped and never
-- presents partial product costs as a complete profit.
BEGIN;

DO $$
BEGIN
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.pnl_statement(text,integer,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'pnl_statement must remain SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.pnl_statement(text,integer,integer)', 'execute') THEN
    RAISE EXCEPTION 'anon must not execute pnl_statement';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.pnl_statement(text,integer,integer)', 'execute') THEN
    RAISE EXCEPTION 'authenticated merchants cannot execute pnl_statement';
  END IF;
END
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) VALUES
  ('00000000-0000-4000-8000-000000009973', 'authenticated', 'authenticated', 'pnl-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"PnL A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009974', 'authenticated', 'authenticated', 'pnl-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"PnL B"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009975', 'authenticated', 'authenticated', 'pnl-employee@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"PnL Employee"}', now(), now(), now(), false, false);

DO $$
DECLARE
  merchant_a text;
  merchant_b text;
BEGIN
  SELECT merchant_code INTO merchant_a FROM public.merchants WHERE id = '00000000-0000-4000-8000-000000009973';
  SELECT merchant_code INTO merchant_b FROM public.merchants WHERE id = '00000000-0000-4000-8000-000000009974';

  UPDATE public.merchants
  SET role = 'employee', owner_merchant_code = merchant_a,
      permissions = '{"dashboard":true,"statement":false}'::jsonb
  WHERE id = '00000000-0000-4000-8000-000000009975';

  INSERT INTO public.products (merchant_code, name, sku, cost_price)
  VALUES
    (merchant_a, 'Partial cost product', 'PNL-A', 50),
    (merchant_b, 'Complete cost product', 'PNL-B', 30);

  INSERT INTO public.performance_data
    (merchant_code, platform, data_date, total_sales, order_count, platform_fees, ad_spend)
  VALUES
    (merchant_a, 'trendyol', '2026-08-01', 1000, 10, 100, 50),
    (merchant_b, 'trendyol', '2026-08-01', 200, 2, 20, 0);

  INSERT INTO public.orders
    (merchant_code, platform, order_id, status, product_name, sku, quantity, unit_price, total_amount, order_date)
  VALUES
    (merchant_a, 'trendyol', 'PNL-A-1', 'delivered', 'Partial cost product', 'PNL-A', 1, 100, 100, '2026-08-01T08:00:00Z'),
    (merchant_b, 'trendyol', 'PNL-B-1', 'delivered', 'Complete cost product', 'PNL-B', 1, 100, 100, '2026-08-01T08:00:00Z'),
    (merchant_b, 'trendyol', 'PNL-B-2', 'delivered', 'Complete cost product', 'PNL-B', 1, 100, 100, '2026-08-01T09:00:00Z');

  INSERT INTO public.returns
    (merchant_code, platform, order_id, product_name, sku, quantity, return_amount, return_date, status)
  VALUES (merchant_a, 'trendyol', 'PNL-A-RETURN', 'Partial return', 'PNL-A', 1, 25, '2026-08-02', 'refunded');
END
$$;

SELECT set_config(
  'test.pnl_foreign_code',
  (SELECT merchant_code FROM public.merchants WHERE id = '00000000-0000-4000-8000-000000009974'),
  true
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000009973';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009973","email":"pnl-a@test.invalid","role":"authenticated"}';

DO $$
DECLARE
  own_code text := public.current_merchant_code();
  foreign_code text := current_setting('test.pnl_foreign_code', true);
  statement jsonb;
  denied boolean := false;
BEGIN
  statement := public.pnl_statement(own_code, 2026, 8);

  IF statement->>'source' <> 'mixed'
     OR (statement->>'revenue')::numeric <> 1000
     OR (statement->'data_quality'->>'detail_coverage_pct')::numeric <> 10
     OR (statement->'data_quality'->>'profit_complete')::boolean
     OR statement->'net_income' <> 'null'::jsonb
     OR (statement->>'provisional_net_after_known_costs')::numeric <> 775 THEN
    RAISE EXCEPTION 'partial statement contract failed: %', statement;
  END IF;

  BEGIN
    PERFORM public.pnl_statement(foreign_code, 2026, 8);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'cross-tenant pnl_statement access was not denied';
  END IF;
END
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000009974';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009974","email":"pnl-b@test.invalid","role":"authenticated"}';

DO $$
DECLARE
  statement jsonb := public.pnl_statement(public.current_merchant_code(), 2026, 8);
BEGIN
  IF statement->>'source' <> 'detailed_orders'
     OR NOT (statement->'data_quality'->>'profit_complete')::boolean
     OR (statement->>'cogs')::numeric <> 60
     OR (statement->>'net_income')::numeric <> 120
     OR (statement->>'orders')::integer <> 2 THEN
    RAISE EXCEPTION 'complete statement contract failed: %', statement;
  END IF;
END
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000009975';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009975","email":"pnl-employee@test.invalid","role":"authenticated"}';

DO $$
DECLARE
  denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.pnl_statement(public.current_merchant_code(), 2026, 8);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'employee without statement permission accessed pnl_statement';
  END IF;
END
$$;

RESET ROLE;
ROLLBACK;
