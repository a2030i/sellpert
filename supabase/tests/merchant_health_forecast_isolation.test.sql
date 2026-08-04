-- Regression: health and forecasts are tenant-scoped, do not award missing-data
-- points, and return bounded forecasts with explicit confidence.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000009984', 'authenticated', 'authenticated', 'health-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Health A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009985', 'authenticated', 'authenticated', 'health-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Health B"}', now(), now(), now(), false, false);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009984';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009984","email":"health-a@test.invalid","role":"authenticated"}';

do $$
declare
  own_code text := public.current_merchant_code();
  foreign_code text;
  health jsonb;
  forecast jsonb;
begin
  select merchant_code into foreign_code from public.merchants where id = '00000000-0000-4000-8000-000000009985';

  health := public.merchant_health_score(own_code);
  if health->>'score' is not null then
    raise exception 'empty merchant received a health score';
  end if;
  if (health->>'coverage_pct')::numeric <> 0 then
    raise exception 'empty merchant received evidence coverage';
  end if;

  forecast := public.revenue_forecast(own_code);
  if (forecast->>'is_actionable')::boolean then
    raise exception 'empty merchant received actionable forecast';
  end if;
  if (forecast->>'forecast_30')::numeric <> 0 then
    raise exception 'empty merchant received non-zero forecast';
  end if;

  begin
    perform public.merchant_health_score(foreign_code);
    raise exception 'CROSS_TENANT_HEALTH_ALLOWED';
  exception when others then
    if sqlerrm = 'CROSS_TENANT_HEALTH_ALLOWED' then raise; end if;
  end;

  begin
    perform public.revenue_forecast(foreign_code);
    raise exception 'CROSS_TENANT_FORECAST_ALLOWED';
  exception when others then
    if sqlerrm = 'CROSS_TENANT_FORECAST_ALLOWED' then raise; end if;
  end;
end
$$;

reset role;

with merchant as (
  select merchant_code from public.merchants where id = '00000000-0000-4000-8000-000000009984'
)
insert into public.orders (
  merchant_code, platform, order_id, status, product_name, sku,
  quantity, unit_price, total_amount, platform_fee, shipping_cost,
  currency, order_date, created_at
)
select merchant_code, 'trendyol', 'HEALTH-FORECAST-' || day_offset,
       'delivered', 'Forecast fixture', 'FORECAST-SKU', 1,
       100 + day_offset, 100 + day_offset, 10, 5, 'SAR',
       current_date - day_offset, now()
from merchant cross join generate_series(0, 29) day_offset;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009984';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009984","email":"health-a@test.invalid","role":"authenticated"}';

do $$
declare
  own_code text := public.current_merchant_code();
  health jsonb;
  forecast jsonb;
begin
  health := public.merchant_health_score(own_code);
  if (health->>'coverage_pct')::numeric <> 40 then
    raise exception 'orders-only coverage should be 40 percent';
  end if;
  if health->>'score' is not null then
    raise exception 'partial evidence produced a misleading overall score';
  end if;

  forecast := public.revenue_forecast(own_code);
  if not (forecast->>'is_actionable')::boolean then
    raise exception '30 active days did not produce an actionable forecast';
  end if;
  if not (
    (forecast->>'lower_30')::numeric <= (forecast->>'forecast_30')::numeric
    and (forecast->>'forecast_30')::numeric <= (forecast->>'upper_30')::numeric
  ) then
    raise exception 'forecast is not bounded';
  end if;
end
$$;

reset role;
rollback;
