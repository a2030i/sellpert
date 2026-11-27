-- Provider identifiers belong to an account; canonical SKU belongs to Sellpert.
-- Synchronization never merges variants by name or overwrites a manually chosen
-- canonical name/cost when a second provider reports different metadata.
create function security.upsert_marketplace_products(p_account_id uuid,p_merchant_code text,p_rows jsonb)
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
      update public.product_channel_mappings set source_name=row_value->>'name',source_barcode=row_value->>'barcode'
        where id=mapped.id;
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
      insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,source_sku,source_name,source_barcode,match_status,match_method,confidence)
      values(p_merchant_code,p_account_id,a.platform,v_product_id,'sku',v_source_sku,v_source_sku,row_value->>'name',row_value->>'barcode','linked','platform_id',1);
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('source_sku',v_source_sku,'product_id',v_product_id));
  end loop;
  return result;
end $$;
revoke all on function security.upsert_marketplace_products(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function security.upsert_marketplace_products(uuid,text,jsonb) to service_role;
create function public.upsert_marketplace_products(p_account_id uuid,p_merchant_code text,p_rows jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select security.upsert_marketplace_products(p_account_id,p_merchant_code,p_rows)
$$;
revoke all on function public.upsert_marketplace_products(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_marketplace_products(uuid,text,jsonb) to service_role;
