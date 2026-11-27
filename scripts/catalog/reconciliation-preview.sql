-- Read-only preview. Substitute the owner email safely in the private runner.
-- No row changes, no financial/stock aggregation across legacy and active sources.
with owner as (
  select coalesce(owner_merchant_code,merchant_code) code from public.merchants where lower(email)=lower('$MERCHANT_EMAIL$')
), pairs as (
  select o,n from public.products o join public.products n on n.merchant_code=o.merchant_code and n.barcode=o.barcode
  where o.merchant_code in(select code from owner) and o.platform_source='trendyol_api_v2' and n.platform_source='trendyol'
), expanded as (
  select (o).id proposed_canonical_id,(n).id retained_source_product_id,(o).name product_name,
    (o).sku canonical_sku,(n).sku connected_canonical_sku,(o).barcode barcode,
    (o).external_id old_provider_product_id,(n).external_id new_provider_product_id,
    (o).platform_source old_source,(n).platform_source new_source,
    (o).upload_id old_upload_id,(n).upload_id new_upload_id,
    (o).created_at old_created_at,(n).created_at new_created_at,(o).updated_at old_updated_at,(n).updated_at new_updated_at,
    (o).cost_price old_cost,(n).cost_price new_cost,(o).sale_price old_sale_price,(n).sale_price new_sale_price,
    (o).target_net_price old_target_price,(n).target_net_price new_target_price,
    jsonb_build_object('color',(o).color,'size',(o).size) old_variant,
    jsonb_build_object('color',(n).color,'size',(n).size) new_variant,
    ((n).sku=(o).sku||'@'||(n).id::text and (o).external_id is not distinct from (n).external_id
      and nullif(btrim((o).color),'') is not distinct from nullif(btrim((n).color),'')
      and nullif(btrim((o).size),'') is not distinct from nullif(btrim((n).size),'')) identity_matches,
    (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'account_id',m.marketplace_account_id,'platform',m.platform,'product_id',m.product_id,'identifier_type',m.identifier_type,'identifier_value',m.identifier_value,'source_sku',m.source_sku,'source_barcode',m.source_barcode,'status',m.match_status,'method',m.match_method,'updated_at',m.updated_at,'legacy',a.is_legacy) order by m.id),'[]'::jsonb)
      from public.product_channel_mappings m join public.marketplace_accounts a on a.id=m.marketplace_account_id and a.merchant_code=m.merchant_code
      where m.merchant_code=(o).merchant_code and m.product_id in((o).id,(n).id)) mappings_before,
    (select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'product_id',pr.product_id,'account_id',pr.marketplace_account_id,'platform',pr.platform,'selling_price',pr.selling_price,'override_price',pr.override_price,'active',pr.is_active,'updated_at',pr.updated_at) order by pr.id),'[]'::jsonb)
      from public.product_platform_prices pr where pr.merchant_code=(o).merchant_code and pr.product_id in((o).id,(n).id)) prices_before,
    (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'account_id',l.marketplace_account_id,'platform',l.platform,'provider_barcode',l.provider_barcode,'provider_product_id',l.provider_product_id,'updated_at',l.updated_at) order by l.id),'[]'::jsonb)
      from public.product_platform_listings l where l.merchant_code=(o).merchant_code and l.product_id in((o).id,(n).id)) listings_before,
    (select coalesce(jsonb_agg(x order by x.is_legacy,x.platform),'[]'::jsonb) from (
      select a.id account_id,a.platform,a.is_legacy,count(*) observation_rows,sum(i.quantity) observed_quantity,
        sum(i.reserved_quantity) reserved_quantity,min(coalesce(i.last_synced_at,i.last_updated)) oldest_observation,
        max(coalesce(i.last_synced_at,i.last_updated)) latest_observation,count(pool.inventory_id) reviewed_pool_links,
        count(*) filter(where not i.is_active) inactive_rows
      from public.inventory i join public.marketplace_accounts a on a.id=i.marketplace_account_id and a.merchant_code=i.merchant_code
      left join public.inventory_pool_links pool on pool.inventory_id=i.id and pool.merchant_code=i.merchant_code
      where i.merchant_code=(o).merchant_code and i.platform='trendyol'
        and (i.sku in((o).sku,(o).barcode) or i.partner_sku in((o).sku,(o).barcode))
      group by a.id,a.platform,a.is_legacy
    )x) stock_observations_by_account,
    (select coalesce(jsonb_agg(x order by x.is_legacy,x.platform),'[]'::jsonb) from (
      select a.id account_id,a.platform,a.is_legacy,count(*) matching_source_rows,sum(ord.quantity) units,
        sum(ord.total_amount) source_amount,sum(ord.platform_fee) source_fees
      from public.orders ord join public.marketplace_accounts a on a.id=ord.marketplace_account_id and a.merchant_code=ord.merchant_code
      where ord.merchant_code=(o).merchant_code and ord.platform='trendyol'
        and (ord.sku in((o).sku,(o).barcode) or ord.partner_sku in((o).sku,(o).barcode))
      group by a.id,a.platform,a.is_legacy
    )x) source_orders_by_account,
    (select count(*) from public.order_items it where it.merchant_code=(o).merchant_code and it.platform='trendyol' and (it.sku in((o).sku,(o).barcode) or it.barcode=(o).barcode)) matching_order_lines,
    (select count(*) from public.product_bundle_components bc where bc.merchant_code=(o).merchant_code and bc.component_product_id in((o).id,(n).id)) historical_recipe_references,
    (select count(*) from public.product_bundle_versions bv where bv.merchant_code=(o).merchant_code and bv.product_id in((o).id,(n).id)) bundle_versions,
    (select count(*) from public.inventory_pool_links pl where pl.merchant_code=(o).merchant_code and pl.product_id in((o).id,(n).id)) pool_references
  from pairs
)
select coalesce(jsonb_agg(to_jsonb(expanded) order by proposed_canonical_id),'[]'::jsonb) as pairs from expanded;
