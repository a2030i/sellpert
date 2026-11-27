-- Physical stock is counted by reviewed pool, never by a listing count.
-- Preserve the existing two-day freshness threshold used for inventory decisions.
create function public.catalog_physical_availability(p_merchant_code text,p_product_id uuid,p_account_ids uuid[])
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
revoke all on function public.catalog_physical_availability(text,uuid,uuid[]) from public,anon;
grant execute on function public.catalog_physical_availability(text,uuid,uuid[]) to authenticated,service_role;

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
      p.cost_price, p.sale_price, p.target_net_price, p.catalog_status, p.family_id, p.variant_attributes, p.product_kind, p.current_bundle_version_id,
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
