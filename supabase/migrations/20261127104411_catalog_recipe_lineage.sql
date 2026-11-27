-- Physical stock is counted by reviewed pool, never by a listing count.
-- Preserve the existing two-day freshness threshold used for inventory decisions.
create function public.catalog_physical_variant_availability(p_merchant_code text,p_product_id uuid,p_account_ids uuid[])
returns numeric language sql stable security invoker set search_path='' as $$
  with observations as (
    select i.id,l.pool_id,greatest(i.quantity-coalesce(i.reserved_quantity,0),0) qty,
      coalesce(i.last_synced_at,i.last_updated,i.created_at) observed_at
    from public.inventory i
    left join public.inventory_pool_links l on l.inventory_id=i.id and l.merchant_code=i.merchant_code
    where i.merchant_code=p_merchant_code and i.is_active and i.marketplace_account_id=any(p_account_ids)
      and (l.product_id=p_product_id or (l.inventory_id is null and exists (
        select 1 from public.product_channel_mappings m where m.merchant_code=i.merchant_code
        and m.marketplace_account_id=i.marketplace_account_id and m.product_id=p_product_id and m.match_status='linked'
        and (m.identifier_value=i.sku or m.source_sku=i.sku or m.source_barcode=i.sku)
      )))
  ), pools as (
    select pool_id,min(qty) qty,count(distinct qty) quantities,
      bool_and(qty is not null and observed_at>=now()-interval '2 days') fresh
    from observations group by pool_id
  )
  select case when count(*)=0 or bool_or(pool_id is null or quantities<>1 or not fresh) then null else sum(qty) end from pools
$$;
revoke all on function public.catalog_physical_variant_availability(text,uuid,uuid[]) from public,anon;
grant execute on function public.catalog_physical_variant_availability(text,uuid,uuid[]) to authenticated,service_role;


create or replace function public.catalog_physical_availability(p_merchant_code text,p_product_id uuid,p_account_ids uuid[])
returns numeric language plpgsql stable security invoker set search_path='' as $$
declare v_kind text; v_recipe uuid; result numeric;
begin
  select product_kind,current_bundle_version_id into v_kind,v_recipe from public.products where merchant_code=p_merchant_code and id=p_product_id;
  if not found then return null; end if;
  if v_kind<>'virtual_bundle' then
    return public.catalog_physical_variant_availability(p_merchant_code,p_product_id,p_account_ids);
  end if;
  select case when count(*)=0 or bool_or(qty is null) then null else min(floor(qty/units)) end into result
  from (select c.units,public.catalog_physical_variant_availability(p_merchant_code,c.component_product_id,p_account_ids) qty
    from public.product_bundle_components c where c.merchant_code=p_merchant_code and c.recipe_id=v_recipe) components;
  return result;
end $$;

alter table public.product_bundle_components add column unit_cost numeric check (unit_cost>0);
create function security.capture_bundle_component_cost() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select nullif(cost_price,0) into new.unit_cost from public.products
    where id=new.component_product_id and merchant_code=new.merchant_code;
  return new;
end $$;
revoke all on function security.capture_bundle_component_cost() from public,anon,authenticated;
create trigger capture_bundle_component_cost before insert on public.product_bundle_components
for each row execute function security.capture_bundle_component_cost();

create function security.capture_order_bundle_version() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_product uuid; v_order_date timestamptz;
begin
  if tg_op='UPDATE' then
    new.bundle_version_id:=old.bundle_version_id;
    return new;
  end if;
  -- Never assign today's recipe to an earlier historical sale.
  select o.order_date into v_order_date from public.orders o
    where o.merchant_code=new.merchant_code and o.marketplace_account_id=new.marketplace_account_id and o.platform=new.platform and o.order_id=new.order_id;
  select case when count(distinct m.product_id)=1 then (array_agg(m.product_id))[1] else null end into v_product
    from public.product_channel_mappings m where m.merchant_code=new.merchant_code and m.marketplace_account_id=new.marketplace_account_id
      and m.platform=new.platform and m.match_status='linked'
      and (m.identifier_value in (new.sku,new.barcode) or m.source_sku=new.sku or m.source_barcode=new.barcode);
  new.bundle_version_id:=null;
  if v_product is not null and v_order_date is not null then
    select id into new.bundle_version_id from public.product_bundle_versions
      where merchant_code=new.merchant_code and product_id=v_product and created_at<=v_order_date order by version desc limit 1;
  end if;
  return new;
end $$;
revoke all on function security.capture_order_bundle_version() from public,anon,authenticated;
create trigger capture_order_bundle_version before insert or update on public.order_items
for each row execute function security.capture_order_bundle_version();

create function security.guard_inventory_pool_actor() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is not null then new.reviewed_by:=auth.uid(); end if;
  new.reviewed_at:=clock_timestamp();
  return new;
end $$;
revoke all on function security.guard_inventory_pool_actor() from public,anon,authenticated;
create trigger guard_inventory_pool_actor before insert or update on public.inventory_pool_links
for each row execute function security.guard_inventory_pool_actor();

CREATE OR REPLACE FUNCTION public.unified_product_catalog_by_account(
  p_merchant_code text,
  p_account_ids uuid[],
  p_status text DEFAULT 'all',
  p_platform text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT security.mfa_access_allowed() OR NOT security.can_access_merchant(p_merchant_code)
     OR NOT security.has_merchant_permission(p_merchant_code, 'products') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_status NOT IN ('all','linked','review','unknown') THEN
    RAISE EXCEPTION 'invalid catalog status' USING errcode = '22023';
  END IF;

  WITH mapping_rollup AS (
    SELECT m.merchant_code, m.product_id,
      jsonb_agg(jsonb_build_object('id',m.id,'marketplace_account_id',m.marketplace_account_id,'account_label',a.label,'platform',m.platform,'identifier_type',m.identifier_type,'identifier_value',m.identifier_value,'status',m.match_status) ORDER BY m.platform) mappings,
      CASE WHEN bool_or(m.match_status = 'review') THEN 'review' ELSE 'linked' END match_status
    FROM public.product_channel_mappings m JOIN public.marketplace_accounts a ON a.id=m.marketplace_account_id AND a.merchant_code=m.merchant_code
    WHERE m.merchant_code=p_merchant_code AND m.marketplace_account_id=ANY(p_account_ids) AND m.product_id IS NOT NULL
      AND (p_platform IS NULL OR m.platform=p_platform)
    GROUP BY m.merchant_code, m.product_id
  ), linked AS (
    SELECT p.id, p.name, p.name_en, p.sku, p.barcode, p.brand, p.category, p.image_url,
      case when p.product_kind='virtual_bundle' then (select case when count(*)=0 or bool_or(c.unit_cost is null) then null else sum(c.units*c.unit_cost) end from public.product_bundle_components c where c.merchant_code=p.merchant_code and c.recipe_id=p.current_bundle_version_id) else p.cost_price end cost_price, p.sale_price, p.target_net_price, p.catalog_status, p.family_id, p.variant_attributes, p.product_kind, p.current_bundle_version_id,
      public.catalog_physical_availability(p.merchant_code,p.id,p_account_ids)::bigint inventory,
      coalesce(m.mappings, '[]'::jsonb) mappings,
      coalesce(m.match_status, 'unknown') match_status
    FROM public.products p
    LEFT JOIN mapping_rollup m ON m.merchant_code=p.merchant_code AND m.product_id=p.id
    WHERE p.merchant_code=p_merchant_code
      AND (p_platform IS NULL OR m.product_id IS NOT NULL)
      AND (nullif(btrim(p_search),'') IS NULL OR p.name ILIKE '%'||btrim(p_search)||'%' OR coalesce(p.name_en,'') ILIKE '%'||btrim(p_search)||'%' OR coalesce(p.sku,'') ILIKE '%'||btrim(p_search)||'%' OR coalesce(p.barcode,'') ILIKE '%'||btrim(p_search)||'%')
  ), unknown AS (
    SELECT NULL::uuid id, coalesce(m.source_name, m.identifier_value) name, NULL::text name_en,
      m.source_sku sku, m.source_barcode barcode, NULL::text brand, NULL::text category, NULL::text image_url,
      0::numeric cost_price, NULL::numeric sale_price, 0::numeric target_net_price, 'active'::text catalog_status, NULL::uuid family_id, '{}'::jsonb variant_attributes, 'variant'::text product_kind, NULL::uuid current_bundle_version_id,
      NULL::bigint inventory,
      jsonb_build_array(jsonb_build_object('id',m.id,'marketplace_account_id',m.marketplace_account_id,'account_label',a.label,'platform',m.platform,'identifier_type',m.identifier_type,'identifier_value',m.identifier_value,'status',m.match_status)) mappings,
      m.match_status
    FROM public.product_channel_mappings m JOIN public.marketplace_accounts a ON a.id=m.marketplace_account_id AND a.merchant_code=m.merchant_code
    WHERE m.merchant_code=p_merchant_code AND m.marketplace_account_id=ANY(p_account_ids) AND m.product_id IS NULL
      AND (p_platform IS NULL OR m.platform=p_platform)
      AND (nullif(btrim(p_search),'') IS NULL OR coalesce(m.source_name,'') ILIKE '%'||btrim(p_search)||'%' OR coalesce(m.source_sku,'') ILIKE '%'||btrim(p_search)||'%' OR m.identifier_value ILIKE '%'||btrim(p_search)||'%')
  ), entries AS (SELECT * FROM linked UNION ALL SELECT * FROM unknown), filtered AS (
    SELECT * FROM entries WHERE p_status='all' OR match_status=p_status
  ), page AS (
    SELECT * FROM filtered ORDER BY CASE match_status WHEN 'unknown' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, name, coalesce(id::text,mappings->0->>'id') LIMIT least(greatest(p_limit,1),100) OFFSET greatest(p_offset,0)
  ), stats AS (
    SELECT count(*) total, count(*) FILTER (WHERE match_status='linked') linked,
      count(*) FILTER (WHERE match_status='review') review, count(*) FILTER (WHERE match_status='unknown') unknown FROM entries
  )
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'stats',(SELECT to_jsonb(stats) FROM stats),'filtered_count',(SELECT count(*) FROM filtered)) INTO v_result;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.unified_product_catalog_by_account(text,uuid[],text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unified_product_catalog_by_account(text,uuid[],text,text,text,integer,integer) TO authenticated, service_role;
