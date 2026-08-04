-- Regression: purchase funding uses tenant-owned evidence, does not double-count
-- payout sources, and excludes unconfirmed gross sales from available cash.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000009980', 'authenticated', 'authenticated', 'cash-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Cash A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009981', 'authenticated', 'authenticated', 'cash-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Cash B"}', now(), now(), now(), false, false);

create temporary table cash_fixture(merchant_a text, merchant_b text) on commit drop;
insert into cash_fixture
select
  (select merchant_code from public.merchants where id='00000000-0000-4000-8000-000000009980'),
  (select merchant_code from public.merchants where id='00000000-0000-4000-8000-000000009981');

insert into public.platform_file_uploads (
  id, merchant_code, platform, file_name, file_type, status, fingerprint
)
select '00000000-0000-4000-8000-000000008980', merchant_a, 'other', 'bank.xlsx', 'bank_statement', 'completed', repeat('a', 64)
from cash_fixture;

insert into public.bank_transactions (
  merchant_code, upload_id, transaction_key, transaction_date, description,
  credit, balance, currency, account_hint
)
select merchant_a, '00000000-0000-4000-8000-000000008980', repeat('b', 32), current_date,
  'Balance fixture', 1, 100, 'SAR', '1234'
from cash_fixture;

insert into public.inventory (
  merchant_code, platform, sku, product_name, quantity, cost_price, low_stock_threshold
)
select merchant_a, 'trendyol', 'CASH-SKU', 'Cash fixture product', 0, 10, 5
from cash_fixture;

insert into public.orders (
  merchant_code, platform, order_id, status, product_name, sku, quantity,
  unit_price, total_amount, currency, order_date
)
select merchant_a, 'trendyol', 'CASH-' || day_offset, 'delivered',
  'Cash fixture product', 'CASH-SKU', 1, 50, 50, 'SAR', current_date - day_offset
from cash_fixture cross join generate_series(0, 9) day_offset;

-- Trendyol records payout orders on the debit side. It is still an incoming payout.
insert into public.account_transactions (
  merchant_code, platform, transaction_no, posted_date, transaction_type,
  debit, credit, net_amount, currency
)
select merchant_a, 'trendyol', 'PAYOUT-1', current_date + 5, 'PaymentOrder', 50, 0, -50, 'SAR'
from cash_fixture;

-- Same-platform manual schedule must not be added on top of authoritative API rows.
insert into public.merchant_payout_schedule (
  merchant_code, platform, payout_date, amount, status
)
select merchant_a, 'trendyol', current_date + 5, 50, 'expected'
from cash_fixture;

insert into public.performance_data (
  merchant_code, platform, total_sales, order_count, margin, ad_spend,
  platform_fees, data_date
)
select merchant_a, 'trendyol', 1000, 10, 200, 0, 100, current_date
from cash_fixture;

set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000009980';
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000009980","email":"cash-a@test.invalid","role":"authenticated"}';

do $$
declare
  result jsonb := public.my_purchase_cash_readiness(30);
begin
  if result->>'status' <> 'shortfall' then
    raise exception 'expected shortfall, got %', result->>'status';
  end if;
  if (result#>>'{bank,balance}')::numeric <> 100 then raise exception 'bank balance incorrect'; end if;
  if (result#>>'{payouts,confirmed_total}')::numeric <> 50 then raise exception 'payout was doubled or missed'; end if;
  if (result#>>'{payouts,api_count}')::integer <> 1 then raise exception 'API payout not classified'; end if;
  if (result#>>'{payouts,manual_count}')::integer <> 0 then raise exception 'manual payout was double counted'; end if;
  if (result#>>'{purchase_plan,estimated_cost}')::numeric <> 300 then raise exception 'purchase cost incorrect'; end if;
  if (result#>>'{readiness,available_before_purchase}')::numeric <> 150 then raise exception 'available cash incorrect'; end if;
  if (result#>>'{readiness,funding_gap}')::numeric <> 150 then raise exception 'funding gap incorrect'; end if;
  if (result#>>'{unconfirmed_sales,gross_total}')::numeric <> 1000 then raise exception 'gross sales disclosure missing'; end if;
  if (result#>>'{unconfirmed_sales,included_in_available_cash}')::boolean then raise exception 'unconfirmed sales entered available cash'; end if;
end
$$;

set local request.jwt.claim.sub='00000000-0000-4000-8000-000000009981';
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000009981","email":"cash-b@test.invalid","role":"authenticated"}';

do $$
declare result jsonb := public.my_purchase_cash_readiness(30);
begin
  if result->>'status' <> 'no_purchase_needed' then raise exception 'empty tenant received foreign decision'; end if;
  if result#>>'{bank,balance}' is not null then raise exception 'foreign bank balance leaked'; end if;
  if (result#>>'{payouts,confirmed_total}')::numeric <> 0 then raise exception 'foreign payout leaked'; end if;
  if (result#>>'{purchase_plan,estimated_cost}')::numeric <> 0 then raise exception 'foreign purchase plan leaked'; end if;
  if (result#>>'{unconfirmed_sales,gross_total}')::numeric <> 0 then raise exception 'foreign sales leaked'; end if;
end
$$;

reset role;

do $$
begin
  if has_function_privilege('anon', 'public.my_purchase_cash_readiness(integer)', 'execute') then
    raise exception 'anon can execute purchase cash readiness';
  end if;
  if not has_function_privilege('authenticated', 'public.my_purchase_cash_readiness(integer)', 'execute') then
    raise exception 'authenticated merchant cannot execute purchase cash readiness';
  end if;
end
$$;

rollback;
