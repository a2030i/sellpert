-- Make product-cost completion a merchant self-service workflow and calculate
-- inventory velocity against the latest available marketplace data window.

create or replace function public.bulk_update_product_costs(p_updates jsonb)
returns table (
  updated_count integer,
  unmatched_identifiers text[],
  ambiguous_identifiers text[],
  invalid_rows integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_rows integer;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if not security.current_has_merchant_permission('products') then
    raise exception 'PRODUCT_PERMISSION_REQUIRED';
  end if;

  if jsonb_typeof(p_updates) <> 'array' then
    raise exception 'INVALID_COST_UPDATE_PAYLOAD';
  end if;

  v_rows := jsonb_array_length(p_updates);
  if v_rows = 0 or v_rows > 5000 then
    raise exception 'COST_UPDATE_ROW_LIMIT';
  end if;

  return query
  with raw_input as (
    select
      trim(coalesce(row_data ->> 'identifier', '')) as identifier,
      trim(coalesce(row_data ->> 'cost_price', '')) as cost_text,
      ordinality
    from jsonb_array_elements(p_updates) with ordinality as input(row_data, ordinality)
  ), parsed as (
    select
      identifier,
      lower(identifier) as normalized_identifier,
      case
        when replace(cost_text, ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
          then replace(cost_text, ',', '.')::numeric
        else null
      end as cost_price,
      ordinality
    from raw_input
  ), valid_input as (
    select distinct on (normalized_identifier)
      identifier,
      normalized_identifier,
      cost_price
    from parsed
    where normalized_identifier <> '' and cost_price > 0
    order by normalized_identifier, ordinality desc
  ), matches as (
    select
      i.identifier,
      i.normalized_identifier,
      i.cost_price,
      p.id as product_id,
      count(*) over (partition by i.normalized_identifier) as match_count
    from valid_input i
    join public.products p
      on p.merchant_code = v_merchant_code
     and i.normalized_identifier in (
       lower(trim(coalesce(p.sku, ''))),
       lower(trim(coalesce(p.barcode, ''))),
       lower(trim(coalesce(p.external_id, ''))),
       lower(trim(coalesce(p.model_code, ''))),
       lower(trim(coalesce(p.supplier_sku, ''))),
       lower(trim(coalesce(p.psku_code, ''))),
       lower(trim(coalesce(p.noon_sku_child, ''))),
       lower(trim(coalesce(p.asin, '')))
     )
  ), updated as (
    update public.products p
       set cost_price = m.cost_price,
           updated_at = now()
      from matches m
     where m.match_count = 1
       and p.id = m.product_id
       and p.merchant_code = v_merchant_code
    returning p.id
  )
  select
    (select count(*)::integer from updated),
    coalesce((
      select array_agg(i.identifier order by i.identifier)
      from valid_input i
      where not exists (
        select 1 from matches m
        where m.normalized_identifier = i.normalized_identifier
      )
    ), '{}'::text[]),
    coalesce((
      select array_agg(distinct m.identifier order by m.identifier)
      from matches m
      where m.match_count > 1
    ), '{}'::text[]),
    (select count(*)::integer from parsed where normalized_identifier = '' or cost_price is null or cost_price <= 0);
end;
$$;

revoke all on function public.bulk_update_product_costs(jsonb) from public, anon;
grant execute on function public.bulk_update_product_costs(jsonb) to authenticated;

comment on function public.bulk_update_product_costs(jsonb) is
  'Updates product costs for the authenticated merchant only, matching a merchant SKU or marketplace identifier.';

create or replace view public.inventory_health
with (security_invoker = true)
as
with platform_anchor as (
  select
    merchant_code,
    lower(trim(platform)) as platform,
    max(order_date) as data_as_of
  from public.orders
  where status not in ('cancelled', 'returned')
    and sku is not null
    and trim(sku) <> ''
  group by merchant_code, lower(trim(platform))
), velocity as (
  select
    o.merchant_code,
    lower(trim(o.platform)) as platform,
    lower(trim(o.sku)) as normalized_sku,
    sum(o.quantity)::numeric
      / greatest(
          least(30::numeric, extract(day from (a.data_as_of - min(o.order_date))) + 1),
          1::numeric
        ) as daily_velocity,
    sum(o.quantity) as sold_30d,
    max(o.order_date) as last_sold_at,
    a.data_as_of
  from public.orders o
  join platform_anchor a
    on a.merchant_code = o.merchant_code
   and a.platform = lower(trim(o.platform))
  where o.order_date > a.data_as_of - interval '30 days'
    and o.order_date <= a.data_as_of
    and o.status not in ('cancelled', 'returned')
    and o.sku is not null
    and trim(o.sku) <> ''
  group by o.merchant_code, lower(trim(o.platform)), lower(trim(o.sku)), a.data_as_of
), product_price as (
  select distinct on (merchant_code, lower(trim(sku)))
    merchant_code,
    lower(trim(sku)) as normalized_sku,
    cost_price,
    coalesce(sale_price, msrp, target_net_price, 0::numeric) as selling_price
  from public.products
  where sku is not null and trim(sku) <> ''
  order by merchant_code, lower(trim(sku)), updated_at desc nulls last, created_at desc nulls last
)
select
  i.id,
  i.merchant_code,
  i.platform,
  i.sku,
  i.product_name,
  i.quantity,
  coalesce(nullif(i.cost_price, 0), p.cost_price, 0::numeric)::numeric(12,2) as cost_price,
  i.low_stock_threshold,
  coalesce(p.selling_price, 0::numeric) as selling_price,
  i.quantity::numeric * coalesce(nullif(i.cost_price, 0), p.cost_price, 0::numeric) as stock_value_cost,
  i.quantity::numeric * coalesce(p.selling_price, 0::numeric) as stock_value_retail,
  coalesce(v.daily_velocity, 0::numeric) as daily_velocity,
  coalesce(v.sold_30d, 0::bigint) as sold_30d,
  v.last_sold_at,
  case when v.daily_velocity > 0 then round(i.quantity::numeric / v.daily_velocity, 0) end as days_of_stock,
  case
    when i.quantity = 0 then 'out_of_stock'
    when i.quantity <= coalesce(i.low_stock_threshold, 10) then 'low_stock'
    when v.daily_velocity > 0 and i.quantity::numeric / v.daily_velocity < 7 then 'reorder_soon'
    when v.last_sold_at is null then 'no_sales_data'
    when v.last_sold_at < v.data_as_of - interval '30 days' then 'slow_mover'
    else 'healthy'
  end as health_status,
  v.data_as_of,
  case when v.data_as_of is not null then greatest(0, current_date - v.data_as_of::date) end as data_age_days
from public.inventory i
left join product_price p
  on p.merchant_code = i.merchant_code
 and p.normalized_sku = lower(trim(i.sku))
left join velocity v
  on v.merchant_code = i.merchant_code
 and v.platform = lower(trim(i.platform))
 and v.normalized_sku = lower(trim(i.sku));

grant select on public.inventory_health to authenticated;
revoke all on public.inventory_health from anon;

comment on view public.inventory_health is
  'Merchant inventory health using the latest available 30-day order window per marketplace, with explicit data freshness.';
