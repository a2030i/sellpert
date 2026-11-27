-- Cost completeness is explicit. A historical bundle sale uses its immutable
-- recipe snapshot, never today's recipe or the first product's cost.
create function public.catalog_sale_unit_cost(p_merchant_code text,p_product_id uuid,p_bundle_version_id uuid default null)
returns numeric language sql stable security invoker set search_path='' as $$
select case when p.product_kind='variant' then nullif(p.cost_price,0) else
  (select case when count(*)=0 or bool_or(c.unit_cost is null) then null else sum(c.unit_cost*c.units) end
   from public.product_bundle_components c join public.product_bundle_versions v on v.id=c.recipe_id and v.merchant_code=c.merchant_code
   where v.id=p_bundle_version_id and v.product_id=p.id and v.merchant_code=p_merchant_code)
end from public.products p where p.id=p_product_id and p.merchant_code=p_merchant_code
$$;
revoke all on function public.catalog_sale_unit_cost(text,uuid,uuid) from public,anon;
grant execute on function public.catalog_sale_unit_cost(text,uuid,uuid) to authenticated,service_role;

-- One result per canonical sellable variant, aggregated only over the explicitly
-- selected seller accounts. Multi-line order fees are not guessed or charged to
-- the first product. Unknown costs/allocations leave profitability unknown.
create function public.product_profitability_for_accounts(p_merchant_code text,p_account_ids uuid[])
returns setof public.product_profitability
language sql stable security invoker set search_path='' as $$
with line_counts as (
  select merchant_code,marketplace_account_id,platform,order_id,count(*) lines
  from public.order_items where merchant_code=p_merchant_code and marketplace_account_id=any(p_account_ids)
  group by merchant_code,marketplace_account_id,platform,order_id
), facts as (
  select public.resolve_catalog_variant(i.merchant_code,i.marketplace_account_id,i.platform,array[i.sku,i.barcode]) product_id,
    i.quantity::numeric units,i.line_total revenue,
    case when i.commission_amount>0 then i.commission_amount when c.lines=1 or coalesce(o.platform_fee,0)=0 then coalesce(o.platform_fee,0) else null end fee,
    public.catalog_sale_unit_cost(i.merchant_code,public.resolve_catalog_variant(i.merchant_code,i.marketplace_account_id,i.platform,array[i.sku,i.barcode]),i.bundle_version_id)*i.quantity line_cost
  from public.order_items i join public.orders o on o.merchant_code=i.merchant_code and o.marketplace_account_id=i.marketplace_account_id and o.platform=i.platform and o.order_id=i.order_id
  join line_counts c on c.merchant_code=i.merchant_code and c.marketplace_account_id=i.marketplace_account_id and c.platform=i.platform and c.order_id=i.order_id
  where i.merchant_code=p_merchant_code and i.marketplace_account_id=any(p_account_ids) and o.status<>'cancelled'
  union all
  select public.resolve_catalog_variant(o.merchant_code,o.marketplace_account_id,o.platform,array[o.sku]),o.quantity::numeric,o.total_amount,o.platform_fee,
    public.catalog_sale_unit_cost(o.merchant_code,public.resolve_catalog_variant(o.merchant_code,o.marketplace_account_id,o.platform,array[o.sku]),null)*o.quantity
  from public.orders o where o.merchant_code=p_merchant_code and o.marketplace_account_id=any(p_account_ids) and o.status<>'cancelled'
  and not exists(select 1 from line_counts c where c.merchant_code=o.merchant_code and c.marketplace_account_id=o.marketplace_account_id and c.platform=o.platform and c.order_id=o.order_id)
), sales as (
  select product_id,sum(units)::bigint units_sold,sum(revenue) revenue,
    case when bool_or(fee is null) then null else sum(fee) end fees,
    case when bool_or(line_cost is null) then null else sum(line_cost) end sale_cost
  from facts where product_id is not null group by product_id
), ads as (
  select public.resolve_catalog_variant(a.merchant_code,a.marketplace_account_id,a.platform,array[a.sku,a.asin]) product_id,
    sum(a.spend) spend,sum(a.revenue) revenue from public.ad_metrics a
  where a.merchant_code=p_merchant_code and a.marketplace_account_id=any(p_account_ids)
  group by public.resolve_catalog_variant(a.merchant_code,a.marketplace_account_id,a.platform,array[a.sku,a.asin])
), refunds as (
  select public.resolve_catalog_variant(r.merchant_code,r.marketplace_account_id,r.platform,array[r.sku]) product_id,
    count(*)::integer count,sum(r.return_amount) amount from public.returns r
  where r.merchant_code=p_merchant_code and r.marketplace_account_id=any(p_account_ids)
  group by public.resolve_catalog_variant(r.merchant_code,r.marketplace_account_id,r.platform,array[r.sku])
), priced as (
  select p.id,p.merchant_code,p.sku,p.name,p.brand,p.category,p.cost_price,p.sale_price,p.msrp,p.target_net_price,p.product_kind,coalesce(s.units_sold,0) units_sold,coalesce(s.revenue,0) revenue,
    case when s.product_id is null then 0 else s.fees end fees,
    coalesce(a.spend,0) ad_spend,coalesce(a.revenue,0) ad_revenue,
    coalesce(r.count,0) return_count,coalesce(r.amount,0) return_amount,
    case when s.product_id is null then 0 else s.sale_cost end sale_cost
  from public.products p left join sales s on s.product_id=p.id left join ads a on a.product_id=p.id left join refunds r on r.product_id=p.id
  where p.merchant_code=p_merchant_code
), calculated as (
 select p.*,sale_cost total_cost,
   case when sale_cost is null or fees is null then null else revenue-sale_cost-fees-ad_spend-return_amount end net_profit
 from priced p
)
select id,merchant_code,sku,name,brand,category,cost_price,
  coalesce(sale_price,msrp,target_net_price,0),units_sold,revenue,round(fees,2),ad_spend,return_count,return_amount,
  total_cost,round(net_profit,2),case when revenue>0 then round(net_profit/revenue*100,1) else null end,
  case when ad_spend>0 then round(revenue/ad_spend,2) else null end,ad_revenue,
  case when ad_spend>0 then round(ad_revenue/ad_spend,2) else null end
from calculated;
$$;
revoke all on function public.product_profitability_for_accounts(text,uuid[]) from public,anon;
grant execute on function public.product_profitability_for_accounts(text,uuid[]) to authenticated,service_role;
