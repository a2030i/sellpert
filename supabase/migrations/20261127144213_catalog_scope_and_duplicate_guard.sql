-- Preserve canonical rows and seller lineage. Potential cross-source duplicates
-- are observations awaiting review, never automatic merges or extra products.
alter table public.product_channel_mappings
  add column source_product_id text,
  add column source_observation jsonb not null default '{}'::jsonb,
  add column source_identifiers jsonb not null default '{}'::jsonb,
  add column source_variant_attributes jsonb not null default '{}'::jsonb;
grant select (source_product_id,source_identifiers,source_variant_attributes,source_observation) on public.product_channel_mappings to authenticated;

create index products_merchant_barcode_trim_idx on public.products(merchant_code,btrim(barcode));

create or replace function security.upsert_marketplace_products(p_account_id uuid,p_merchant_code text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.marketplace_accounts; row_value jsonb; mapped public.product_channel_mappings;
  source_product public.products; v_product_id uuid; canonical_sku text; v_source_sku text; result jsonb:='[]'::jsonb;
begin
  select * into a from public.marketplace_accounts where id=p_account_id and merchant_code=p_merchant_code;
  if not found then raise exception 'Selling account not found'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>5000 then raise exception 'Invalid product batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:'||p_merchant_code,0));
  for row_value in select value from jsonb_array_elements(p_rows) loop
    source_product:=jsonb_populate_record(null::public.products,row_value);
    if source_product.upload_id is not null and not exists(select 1 from public.platform_file_uploads where id=source_product.upload_id and merchant_code=p_merchant_code and marketplace_account_id=p_account_id) then raise exception 'Product import lineage mismatch'; end if;
    v_source_sku:=nullif(btrim(row_value->>'sku'),'');
    if v_source_sku is null then raise exception 'Source SKU is required'; end if;
    select * into mapped from public.product_channel_mappings where merchant_code=p_merchant_code
      and marketplace_account_id=p_account_id and platform=a.platform and identifier_type='sku' and identifier_value=v_source_sku;
    if found then
      v_product_id:=case when mapped.match_status='linked' then mapped.product_id else null end;
      update public.product_channel_mappings set source_name=row_value->>'name',source_barcode=coalesce(nullif(row_value->>'barcode',''),source_barcode),
        source_product_id=coalesce(nullif(source_product.external_id,''),source_product_id),
        source_identifiers=source_identifiers||jsonb_strip_nulls(jsonb_build_object('sku',v_source_sku,'barcode',nullif(source_product.barcode,''),'external_id',nullif(source_product.external_id,''),'asin',nullif(source_product.asin,''),'noon_sku_child',nullif(source_product.noon_sku_child,''),'psku_code',nullif(source_product.psku_code,''),'supplier_sku',nullif(source_product.supplier_sku,''),'model_code',nullif(source_product.model_code,''))),
        source_variant_attributes=source_variant_attributes||jsonb_strip_nulls(jsonb_build_object('color',source_product.color,'size',source_product.size))
        where id=mapped.id;
    elsif exists (
      select 1 from public.products p where p.merchant_code=p_merchant_code and (
        (nullif(btrim(source_product.barcode),'') is not null and btrim(p.barcode)=btrim(source_product.barcode))
        or (p.sku=v_source_sku and not (
          (nullif(btrim(p.barcode),'') is not null and nullif(btrim(source_product.barcode),'') is not null and btrim(p.barcode)<>btrim(source_product.barcode))
          or (nullif(btrim(p.color),'') is not null and nullif(btrim(source_product.color),'') is not null and btrim(p.color)<>btrim(source_product.color))
          or (nullif(btrim(p.size),'') is not null and nullif(btrim(source_product.size),'') is not null and btrim(p.size)<>btrim(source_product.size))
        ))
        or (nullif(source_product.external_id,'') is not null and exists (
          select 1 from public.product_channel_mappings known
          where known.merchant_code=p_merchant_code and known.marketplace_account_id=p_account_id
            and known.product_id=p.id and known.source_product_id=source_product.external_id
        ))
      )
    ) then
      -- Do not choose a winner by barcode or name: variants, seller ownership,
      -- cost and physical stock still require an explicit reviewed mapping.
      v_product_id:=null;
      insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,
        identifier_type,identifier_value,source_sku,source_name,source_barcode,source_product_id,
        source_variant_attributes,match_status,match_method)
      values(p_merchant_code,p_account_id,a.platform,'sku',v_source_sku,v_source_sku,
        row_value->>'name',row_value->>'barcode',row_value->>'external_id',
        jsonb_strip_nulls(jsonb_build_object('color',source_product.color,'size',source_product.size)),
        'review',case when nullif(btrim(source_product.barcode),'') is not null then 'barcode' else 'internal_sku' end);
    else
      v_product_id:=gen_random_uuid();
      canonical_sku:=v_source_sku;
      if exists(select 1 from public.products where merchant_code=p_merchant_code and sku=canonical_sku) then
        canonical_sku:=v_source_sku||'@'||v_product_id::text;
      end if;
      insert into public.products(id,merchant_code,sku,name,barcode,category,description,image_url,cost_price,target_net_price,status,platform_source,last_synced_at,upload_id,name_en,brand,color,size,model_code,supplier_sku,psku_code,noon_sku_child,asin,external_id,msrp,sale_price,external_url,images,gender,warranty,commission_rate,vat_rate,variant_attributes)
      values(v_product_id,p_merchant_code,canonical_sku,coalesce(nullif(row_value->>'name',''),v_source_sku),row_value->>'barcode',row_value->>'category',
        row_value->>'description',row_value->>'image_url',greatest(coalesce((row_value->>'cost_price')::numeric,0),0),
        greatest(coalesce((row_value->>'target_net_price')::numeric,0),0),coalesce(row_value->>'status','active'),a.platform,now(),source_product.upload_id,source_product.name_en,source_product.brand,source_product.color,source_product.size,source_product.model_code,source_product.supplier_sku,source_product.psku_code,source_product.noon_sku_child,source_product.asin,source_product.external_id,source_product.msrp,source_product.sale_price,source_product.external_url,source_product.images,source_product.gender,source_product.warranty,source_product.commission_rate,source_product.vat_rate,jsonb_strip_nulls(jsonb_build_object('color',source_product.color,'size',source_product.size)));
      insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,source_sku,source_name,source_barcode,source_product_id,source_variant_attributes,match_status,match_method,confidence)
      values(p_merchant_code,p_account_id,a.platform,v_product_id,'sku',v_source_sku,v_source_sku,row_value->>'name',row_value->>'barcode',row_value->>'external_id',jsonb_strip_nulls(jsonb_build_object('color',source_product.color,'size',source_product.size)),'linked','platform_id',1);
    end if;
    update public.product_channel_mappings set
      source_observation=jsonb_strip_nulls(jsonb_build_object('upload_id',source_product.upload_id,
        'platform_source',source_product.platform_source,'cost_price',source_product.cost_price,
        'sale_price',source_product.sale_price,'target_net_price',source_product.target_net_price,
        'status',source_product.status,'observed_at',now())),
      source_identifiers=source_identifiers||jsonb_strip_nulls(jsonb_build_object('sku',v_source_sku,'barcode',nullif(source_product.barcode,''),'external_id',nullif(source_product.external_id,''),'asin',nullif(source_product.asin,''),'noon_sku_child',nullif(source_product.noon_sku_child,''),'psku_code',nullif(source_product.psku_code,''),'supplier_sku',nullif(source_product.supplier_sku,''),'model_code',nullif(source_product.model_code,'')))
    where merchant_code=p_merchant_code and marketplace_account_id=p_account_id
      and platform=a.platform and identifier_type='sku' and identifier_value=v_source_sku;
    result:=result||jsonb_build_array(jsonb_build_object('source_sku',v_source_sku,'product_id',v_product_id));
  end loop;
  return result;
end $$;
revoke all on function security.upsert_marketplace_products(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function security.upsert_marketplace_products(uuid,text,jsonb) to service_role;

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
      public.catalog_physical_availability(p.merchant_code,p.id,p_account_ids)::bigint inventory,
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
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'stats',(SELECT to_jsonb(stats) FROM stats),'filtered_count',(SELECT count(*) FROM filtered)) INTO v_result;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.unified_product_catalog_by_account(text,uuid[],text,text,text,integer,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unified_product_catalog_by_account(text,uuid[],text,text,text,integer,integer,boolean) TO authenticated, service_role;

-- Keep the original signature for already-open clients and server callers.
CREATE OR REPLACE FUNCTION public.unified_product_catalog_by_account(
  p_merchant_code text,p_account_ids uuid[],p_status text DEFAULT 'all',
  p_platform text DEFAULT NULL,p_search text DEFAULT NULL,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  select public.unified_product_catalog_by_account(p_merchant_code,p_account_ids,p_status,p_platform,p_search,p_limit,p_offset,
    exists(select 1 from public.marketplace_accounts a where a.merchant_code=p_merchant_code and a.id=any(p_account_ids) and a.is_legacy))
$$;
REVOKE ALL ON FUNCTION public.unified_product_catalog_by_account(text,uuid[],text,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.unified_product_catalog_by_account(text,uuid[],text,text,text,integer,integer) TO authenticated,service_role;
