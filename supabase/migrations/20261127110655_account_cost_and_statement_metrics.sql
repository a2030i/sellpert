create function public.statement_costs_by_account(p_merchant_code text,p_account_ids uuid[],p_start timestamptz,p_end timestamptz)
returns table(cogs numeric,costed_units numeric,missing_units numeric)
language sql stable security invoker set search_path='' as $$
with selected_orders as (
 select merchant_code,marketplace_account_id,platform,order_id,sku,quantity from public.orders where merchant_code=p_merchant_code and marketplace_account_id=any(p_account_ids)
 and order_date>=p_start and order_date<p_end and status not in ('cancelled','returned')
), facts as (
 select i.quantity units,public.catalog_sale_unit_cost(i.merchant_code,public.resolve_catalog_variant(i.merchant_code,i.marketplace_account_id,i.platform,array[i.sku,i.barcode]),i.bundle_version_id) unit_cost
 from public.order_items i join selected_orders o on o.merchant_code=i.merchant_code and o.marketplace_account_id=i.marketplace_account_id and o.platform=i.platform and o.order_id=i.order_id
 union all
 select o.quantity,public.catalog_sale_unit_cost(o.merchant_code,public.resolve_catalog_variant(o.merchant_code,o.marketplace_account_id,o.platform,array[o.sku]),null)
 from selected_orders o where not exists(select 1 from public.order_items i where i.merchant_code=o.merchant_code and i.marketplace_account_id=o.marketplace_account_id and i.platform=o.platform and i.order_id=o.order_id)
)
select coalesce(sum(units*unit_cost),0),coalesce(sum(units) filter(where unit_cost is not null),0),coalesce(sum(units) filter(where unit_cost is null),0) from facts
$$;
revoke all on function public.statement_costs_by_account(text,uuid[],timestamptz,timestamptz) from public,anon;
grant execute on function public.statement_costs_by_account(text,uuid[],timestamptz,timestamptz) to authenticated,service_role;
