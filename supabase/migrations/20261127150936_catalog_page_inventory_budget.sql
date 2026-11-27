-- Count and paginate identities before computing physical availability.
-- Without a reviewed pool a variant cannot have verified physical stock.
CREATE OR REPLACE FUNCTION public.unified_product_catalog_by_account(
  p_merchant_code text,
  p_account_ids uuid[],
  p_status text,
  p_platform text,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_include_unassigned boolean
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
      NULL::bigint inventory,
      coalesce(m.mappings, '[]'::jsonb) mappings,
      coalesce(m.match_status, 'unknown') match_status
    FROM public.products p
    LEFT JOIN mapping_rollup m ON m.merchant_code=p.merchant_code AND m.product_id=p.id
    WHERE p.merchant_code=p_merchant_code
      AND (m.product_id IS NOT NULL OR (
        NOT EXISTS (SELECT 1 FROM public.product_channel_mappings all_m WHERE all_m.merchant_code=p_merchant_code AND all_m.product_id=p.id)
        AND p_include_unassigned
      ))
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
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page) || jsonb_build_object('inventory',
    case when page.id is not null and (page.product_kind='virtual_bundle' or exists (
      select 1 from public.inventory_pool_links pool where pool.merchant_code=p_merchant_code and pool.product_id=page.id
    )) then public.catalog_physical_availability(p_merchant_code,page.id,p_account_ids)::bigint else null end)) FROM page),'[]'::jsonb),'stats',(SELECT to_jsonb(stats) FROM stats),'filtered_count',(SELECT count(*) FROM filtered)) INTO v_result;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.unified_product_catalog_by_account(text,uuid[],text,text,text,integer,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unified_product_catalog_by_account(text,uuid[],text,text,text,integer,integer,boolean) TO authenticated, service_role;

