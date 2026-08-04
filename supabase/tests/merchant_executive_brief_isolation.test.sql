-- Regression: the executive brief is tenant-scoped, uses distinct orders,
-- reports only confirmed deductions, and withholds unsupported profit.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000009987', 'authenticated', 'authenticated', 'brief-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Brief A"}', now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009988', 'authenticated', 'authenticated', 'brief-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Brief B"}', now(), now(), false, false);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009987';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009987","email":"brief-a@test.invalid","role":"authenticated"}';

do $$
declare
  own_code text := public.current_merchant_code();
  foreign_code text;
  brief jsonb;
begin
  select merchant_code into foreign_code from public.merchants
  where id = '00000000-0000-4000-8000-000000009988';

  brief := public.merchant_executive_brief(own_code);
  if (brief->>'available')::boolean then
    raise exception 'empty merchant received an available executive brief';
  end if;
  if (brief->>'evidence_coverage_pct')::numeric <> 0 then
    raise exception 'empty merchant received evidence coverage';
  end if;

  begin
    perform public.merchant_executive_brief(foreign_code);
    raise exception 'CROSS_TENANT_EXECUTIVE_BRIEF_ALLOWED';
  exception when others then
    if sqlerrm = 'CROSS_TENANT_EXECUTIVE_BRIEF_ALLOWED' then raise; end if;
  end;
end
$$;

reset role;

with merchant as (
  select merchant_code from public.merchants
  where id = '00000000-0000-4000-8000-000000009987'
)
insert into public.orders (
  merchant_code, platform, order_id, status, product_name, sku,
  quantity, unit_price, total_amount, platform_fee, shipping_cost,
  discount_amount, currency, order_date, created_at
)
select merchant_code, 'trendyol', 'BRIEF-CURRENT-' || day_offset,
       'delivered', 'Executive fixture', 'BRIEF-SKU', 1,
       100, 100, 10, 5, 2, 'SAR', current_date - day_offset, now()
from merchant cross join generate_series(0, 6) day_offset
union all
select merchant_code, 'trendyol', 'BRIEF-PREVIOUS-' || day_offset,
       'delivered', 'Executive fixture', 'BRIEF-SKU', 1,
       80, 80, 8, 4, 1, 'SAR', current_date - day_offset, now()
from merchant cross join generate_series(7, 13) day_offset
union all
select merchant_code, 'trendyol', 'BRIEF-CANCELLED',
       'cancelled', 'Executive fixture', 'BRIEF-SKU', 1,
       100, 100, 0, 0, 0, 'SAR', current_date, now()
from merchant;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009987';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009987","email":"brief-a@test.invalid","role":"authenticated"}';

do $$
declare
  brief jsonb := public.merchant_executive_brief(public.current_merchant_code());
begin
  if not (brief->>'available')::boolean then
    raise exception 'brief did not become available';
  end if;
  if (brief->'week'->>'sales')::numeric <> 700 then
    raise exception 'current weekly sales are incorrect';
  end if;
  if (brief->'week'->>'previous_sales')::numeric <> 560 then
    raise exception 'previous weekly sales are incorrect';
  end if;
  if (brief->'week'->>'orders')::integer <> 7 then
    raise exception 'weekly order count is incorrect';
  end if;
  if (brief->'confirmed_deductions'->>'total_excluding_returns')::numeric <> 119 then
    raise exception 'confirmed deductions are incorrect';
  end if;
  -- total_amount is already net of marketplace discounts, so contribution
  -- subtracts only platform fees and shipping (700 - 70 - 35).
  if (brief->'week'->>'contribution_before_product_cost')::numeric <> 595 then
    raise exception 'pre-cost contribution is incorrect';
  end if;
  if (brief->'week'->>'exception_rate_pct')::numeric <> 12.5 then
    raise exception 'order exception rate is incorrect';
  end if;
  if (brief->'profitability'->>'available')::boolean then
    raise exception 'profit became available without cost evidence';
  end if;
  if brief->'top_priority'->>'source_key' <> 'executive_order_exceptions' then
    raise exception 'priority ranking did not detect order exceptions';
  end if;
  if (brief->>'evidence_coverage_pct')::numeric <> 35 then
    raise exception 'orders-only evidence coverage should be 35 percent';
  end if;
end
$$;

reset role;
rollback;
