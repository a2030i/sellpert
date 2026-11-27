-- Synthetic fixtures, isolated DB only. No provider calls or committed data.
begin;
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ca270000-0000-4000-8000-000000000001','authenticated','authenticated','catalog-guard@test.invalid','','{"provider":"email"}','{}',now(),now());
insert into public.merchants(id,merchant_code,name,email,role,is_active,workspace_status)
values('ca270000-0000-4000-8000-000000000001','CAT-GUARD','Catalog fixture','catalog-guard@test.invalid','merchant',true,'active');
insert into public.marketplace_accounts(id,merchant_code,platform,label,status,is_legacy) values
('ca270000-0000-4000-8000-000000000011','CAT-GUARD','trendyol','Old','disconnected',true),
('ca270000-0000-4000-8000-000000000012','CAT-GUARD','trendyol','Connected','active',false),
('ca270000-0000-4000-8000-000000000013','CAT-GUARD','amazon','Other','active',false);
insert into public.products(id,merchant_code,name,sku,barcode,cost_price,target_net_price,color,size) values
('ca270000-0000-4000-8000-000000000021','CAT-GUARD','Original variant','OLD-SKU','BAR-1',12,30,'red','M'),
('ca270000-0000-4000-8000-000000000022','CAT-GUARD','Unassigned manual','MANUAL','BAR-M',0,0,null,null);
insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,source_sku,match_status) values
('CAT-GUARD','ca270000-0000-4000-8000-000000000011','trendyol','ca270000-0000-4000-8000-000000000021','sku','OLD-SKU','OLD-SKU','linked');
insert into public.orders(merchant_code,marketplace_account_id,platform,order_id,status,sku,quantity,total_amount,platform_fee,order_date) values
('CAT-GUARD','ca270000-0000-4000-8000-000000000011','trendyol','OLD-ORDER','delivered','OLD-SKU',2,60,5,now()),
('CAT-GUARD','ca270000-0000-4000-8000-000000000012','trendyol','NEW-ORDER','delivered','NEW-SKU',1,30,3,now());
insert into public.inventory(merchant_code,marketplace_account_id,platform,sku,quantity,is_active) values
('CAT-GUARD','ca270000-0000-4000-8000-000000000011','trendyol','OLD-SKU',7,true),
('CAT-GUARD','ca270000-0000-4000-8000-000000000012','trendyol','NEW-SKU',7,true);
insert into public.product_platform_prices(merchant_code,marketplace_account_id,platform,product_id,selling_price) values
('CAT-GUARD','ca270000-0000-4000-8000-000000000011','trendyol','ca270000-0000-4000-8000-000000000021',30);
do $$
declare r jsonb; n integer; other uuid;
begin
  for n in 1..3 loop
    r:=security.upsert_marketplace_products('ca270000-0000-4000-8000-000000000012','CAT-GUARD',
      '[{"sku":"NEW-SKU","barcode":"BAR-1","external_id":"PROVIDER-1","name":"Original variant","color":"red","size":"M","cost_price":0}]');
    if r->0->>'product_id' is not null then raise exception 'Unreviewed barcode was automatically merged'; end if;
  end loop;
  if (select count(*) from public.products where merchant_code='CAT-GUARD')<>2 then raise exception 'Resync created duplicate canonicals'; end if;
  if (select count(*) from public.product_channel_mappings where merchant_code='CAT-GUARD' and match_status='review')<>1 then raise exception 'Review observations duplicated'; end if;
  if not exists(select 1 from public.product_channel_mappings where merchant_code='CAT-GUARD' and identifier_value='NEW-SKU'
    and source_observation->>'cost_price'='0' and source_product_id='PROVIDER-1' and source_identifiers->>'barcode'='BAR-1' and source_variant_attributes->>'size'='M') then raise exception 'Source identity lost'; end if;
  -- Even a contradictory variant cannot be merged just because its barcode matches.
  perform security.upsert_marketplace_products('ca270000-0000-4000-8000-000000000013','CAT-GUARD',
    '[{"sku":"CONFLICT","barcode":"BAR-1","name":"Different","color":"blue","size":"L"}]');
  if (select count(*) from public.products where merchant_code='CAT-GUARD')<>2 then raise exception 'Conflicting barcode bypassed review'; end if;
  perform security.upsert_marketplace_products('ca270000-0000-4000-8000-000000000013','CAT-GUARD',
    '[{"sku":"OLD-SKU","name":"Unknown variant without barcode"}]');
  if (select count(*) from public.products where merchant_code='CAT-GUARD')<>2 then raise exception 'Ambiguous SKU created a duplicate'; end if;
  -- Genuinely new source products remain importable and stable on repeated sync.
  r:=security.upsert_marketplace_products('ca270000-0000-4000-8000-000000000012','CAT-GUARD','[{"sku":"NEW-UNIQUE","barcode":"BAR-2","name":"Second variant"}]');
  other:=(r->0->>'product_id')::uuid;
  r:=security.upsert_marketplace_products('ca270000-0000-4000-8000-000000000012','CAT-GUARD','[{"sku":"NEW-UNIQUE","barcode":"BAR-2","name":"Second variant"}]');
  if other is null or (r->0->>'product_id')::uuid<>other then raise exception 'Repeated source changed identity'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"ca270000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
declare r jsonb; snapshot jsonb;
begin
  r:=public.unified_product_catalog_by_account('CAT-GUARD',array['ca270000-0000-4000-8000-000000000011'::uuid]);
  if (r->'stats'->>'total')::integer<>2 then raise exception 'Legacy scope leaked connected products'; end if;
  r:=public.unified_product_catalog_by_account('CAT-GUARD',array['ca270000-0000-4000-8000-000000000012'::uuid]);
  if (r->'stats'->>'linked')::integer<>1 or (r->'stats'->>'review')::integer<>1 then raise exception 'Connected scope includes old or unassigned products'; end if;
  r:=public.unified_product_catalog_by_account('CAT-GUARD',array[]::uuid[]);
  if (r->'stats'->>'total')::integer<>0 then raise exception 'Empty account scope leaked products'; end if;
  r:=public.unified_product_catalog_by_account('CAT-GUARD',array[]::uuid[],'all',null,null,50,0,true);
  if (r->'stats'->>'total')::integer<>1 then raise exception 'Explicit unassigned scope hid manual product'; end if;
  -- Rehearse the proposed reviewed mapping and inverse; never alter source facts.
  select jsonb_build_object('product_id',product_id,'match_status',match_status) into snapshot
    from public.product_channel_mappings where merchant_code='CAT-GUARD' and identifier_value='NEW-SKU';
  update public.product_channel_mappings set product_id='ca270000-0000-4000-8000-000000000021',match_status='linked',match_method='manual'
    where merchant_code='CAT-GUARD' and identifier_value='NEW-SKU';
  if public.catalog_physical_availability('CAT-GUARD','ca270000-0000-4000-8000-000000000021',array['ca270000-0000-4000-8000-000000000011'::uuid,'ca270000-0000-4000-8000-000000000012'::uuid]) is not null then raise exception 'Unreviewed mirrored stock was added'; end if;
  if (select sum(total_amount) from public.orders where merchant_code='CAT-GUARD')<>90 or (select sum(platform_fee) from public.orders where merchant_code='CAT-GUARD')<>8 then raise exception 'Mapping changed sales or fees'; end if;
  if (select count(*) from public.inventory where merchant_code='CAT-GUARD')<>2 then raise exception 'Mapping changed inventory facts'; end if;
  if (select cost_price from public.products where id='ca270000-0000-4000-8000-000000000021')<>12 then raise exception 'Canonical cost changed'; end if;
  if (select selling_price from public.product_platform_prices where merchant_code='CAT-GUARD')<>30 then raise exception 'Price changed'; end if;
  update public.product_channel_mappings set product_id=(snapshot->>'product_id')::uuid,match_status=snapshot->>'match_status',match_method='barcode'
    where merchant_code='CAT-GUARD' and identifier_value='NEW-SKU';
  if not exists(select 1 from public.product_channel_mappings where merchant_code='CAT-GUARD' and identifier_value='NEW-SKU' and product_id is null and match_status='review') then raise exception 'Mapping inverse failed'; end if;
end $$;
reset role;
rollback;
