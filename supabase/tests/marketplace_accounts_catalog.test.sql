-- Isolated fixtures only. Always rolled back; never run against Production.
begin;
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('b5200000-0000-4000-8000-000000000001','authenticated','authenticated','account-a@test.invalid','','{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.merchants(id,merchant_code,name,email,role,is_active,workspace_status)
values('b5200000-0000-4000-8000-000000000001','ACCT-QA-A','Account QA A','account-a@test.invalid','merchant',true,'active'),
('b5200000-0000-4000-8000-000000000002','ACCT-QA-B','Account QA B','account-b@test.invalid','merchant',true,'active');
insert into public.marketplace_accounts(id,merchant_code,platform,label,status,external_seller_id) values
('b5200000-0000-4000-8000-000000000011','ACCT-QA-A','amazon','First','active','QA-SELLER-1'),
('b5200000-0000-4000-8000-000000000012','ACCT-QA-A','amazon','Second','active','QA-SELLER-2'),
('b5200000-0000-4000-8000-000000000013','ACCT-QA-B','amazon','Other tenant','active','QA-SELLER-3');
insert into public.orders(merchant_code,marketplace_account_id,platform,order_id,status,total_amount,platform_fee,order_date)
values('ACCT-QA-A','b5200000-0000-4000-8000-000000000011','amazon','same-order','delivered',100,7,now()),
('ACCT-QA-A','b5200000-0000-4000-8000-000000000012','amazon','same-order','delivered',200,13,now());
do $$
declare a uuid:='b5200000-0000-4000-8000-000000000011'; b uuid:='b5200000-0000-4000-8000-000000000012'; first_product uuid; second_product uuid; result jsonb;
begin
  if (select count(*) from public.orders where merchant_code='ACCT-QA-A') is distinct from 2 then raise exception 'accounts collided on order reference'; end if;
  begin
    insert into public.orders(merchant_code,marketplace_account_id,platform,order_id) values('ACCT-QA-B',a,'amazon','cross-tenant');
    raise exception 'cross-tenant fact was accepted';
  exception when foreign_key_violation then null; end;
  begin
    update public.orders set marketplace_account_id=b where merchant_code='ACCT-QA-A' and marketplace_account_id=a;
    raise exception 'source account was silently reassigned';
  exception when raise_exception then if sqlerrm='source account was silently reassigned' then raise; end if; end;
  result:=security.upsert_marketplace_products(a,'ACCT-QA-A','[{"sku":"SAME","name":"Red size M","cost_price":10}]');
  first_product:=(result->0->>'product_id')::uuid;
  result:=security.upsert_marketplace_products(b,'ACCT-QA-A','[{"sku":"SAME","name":"Blue size L","cost_price":20}]');
  second_product:=(result->0->>'product_id')::uuid;
  if first_product=second_product then raise exception 'same external SKU merged different variants'; end if;
  result:=security.upsert_marketplace_products(a,'ACCT-QA-A','[{"sku":"SAME","name":"Provider changed name","cost_price":0}]');
  if (result->0->>'product_id')::uuid is distinct from first_product then raise exception 'resync duplicated the product'; end if;
  if (select cost_price from public.products where id=first_product) is distinct from 10 then raise exception 'missing provider cost overwrote canonical cost'; end if;
  perform security.rebuild_performance_data('ACCT-QA-A');
  if (select sum(total_sales) from public.performance_data where merchant_code='ACCT-QA-A') is distinct from 300 then raise exception 'account sales aggregate is incorrect'; end if;
  if (select platform_fees from public.performance_data where marketplace_account_id=a) is distinct from 7 then raise exception 'first account fees changed'; end if;
  if (select platform_fees from public.performance_data where marketplace_account_id=b) is distinct from 13 then raise exception 'second account fees changed'; end if;
  perform security.derive_orders_from_account_tx('ACCT-QA-A');
  if (select count(*) from public.orders where merchant_code='ACCT-QA-A') is distinct from 2 then raise exception 'file derivation deleted API orders'; end if;
end $$;
insert into public.products(id,merchant_code,sku,name,cost_price) values('b5200000-0000-4000-8000-000000000021','ACCT-QA-A','BUNDLE','Test bundle',0);
insert into public.inventory(id,merchant_code,marketplace_account_id,platform,sku,product_name,quantity,reserved_quantity,is_active,last_updated)
values('b5200000-0000-4000-8000-000000000031','ACCT-QA-A','b5200000-0000-4000-8000-000000000011','amazon','SAME','Shared units',8,2,true,now()),
('b5200000-0000-4000-8000-000000000032','ACCT-QA-A','b5200000-0000-4000-8000-000000000012','amazon','SAME','Shared units',8,2,true,now());
select set_config('request.jwt.claim.sub','b5200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b5200000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.marketplace_accounts where merchant_code='ACCT-QA-B') is distinct from 0 then raise exception 'other tenant account is visible'; end if;
  if (select count(*) from public.list_order_operating_facts_by_account('ACCT-QA-A',null)) is distinct from 2 then raise exception 'safe account facts missing'; end if;
  if (select count(*) from public.list_order_operating_facts_by_account('ACCT-QA-B',null)) is distinct from 0 then raise exception 'safe facts crossed tenant boundary'; end if;
  begin
    insert into public.marketplace_accounts(merchant_code,platform,label) values('ACCT-QA-A','amazon','browser bypass');
    raise exception 'browser created verified-account metadata directly';
  exception when insufficient_privilege then null; end;
end $$;
do $$
declare a uuid:='b5200000-0000-4000-8000-000000000011'; b uuid:='b5200000-0000-4000-8000-000000000012';
  bundle uuid:='b5200000-0000-4000-8000-000000000021'; p1 uuid; p2 uuid; recipe1 uuid; recipe2 uuid; pool uuid; inv1 uuid; inv2 uuid;
begin
  select product_id into strict p1 from public.product_channel_mappings where marketplace_account_id=a and identifier_value='SAME';
  select product_id into strict p2 from public.product_channel_mappings where marketplace_account_id=b and identifier_value='SAME';
  recipe1:=public.save_product_bundle('ACCT-QA-A',bundle,jsonb_build_array(jsonb_build_object('product_id',p1,'units',2),jsonb_build_object('product_id',p2,'units',1)),null);
  if (select sum(units*unit_cost) from public.product_bundle_components where recipe_id=recipe1) is distinct from 40 then raise exception 'recipe did not snapshot component cost'; end if;
  begin
    perform public.save_product_bundle('ACCT-QA-A',bundle,jsonb_build_array(jsonb_build_object('product_id',bundle,'units',1)),recipe1);
    raise exception 'cyclic recipe accepted';
  exception when raise_exception then if sqlerrm='cyclic recipe accepted' then raise; end if; end;
  begin
    perform public.save_product_bundle('ACCT-QA-A',bundle,jsonb_build_array(jsonb_build_object('product_id',p1,'units',3)),null);
    raise exception 'stale recipe update accepted';
  exception when raise_exception then if sqlerrm='stale recipe update accepted' then raise; end if; end;
  recipe2:=public.save_product_bundle('ACCT-QA-A',bundle,jsonb_build_array(jsonb_build_object('product_id',p1,'units',3)),recipe1);
  if (select count(*) from public.product_bundle_versions where product_id=bundle) is distinct from 2 then raise exception 'old recipe version was overwritten'; end if;
  begin
    update public.product_bundle_components set units=99 where recipe_id=recipe1;
    raise exception 'historical recipe was editable';
  exception when insufficient_privilege then null; end;
  -- Explicit manual mapping can unite the same physical variant across sellers.
  update public.product_channel_mappings set product_id=p1,match_method='manual' where marketplace_account_id=b and identifier_value='SAME';
  inv1:='b5200000-0000-4000-8000-000000000031'; inv2:='b5200000-0000-4000-8000-000000000032';
  if public.catalog_physical_availability('ACCT-QA-A',p1,array[a,b]) is not null then raise exception 'unreviewed pools were summed'; end if;
  insert into public.inventory_pools(merchant_code,name,location_type) values('ACCT-QA-A','Shared warehouse','warehouse') returning id into pool;
  insert into public.inventory_pool_links(merchant_code,inventory_id,pool_id,product_id) values('ACCT-QA-A',inv1,pool,p1),('ACCT-QA-A',inv2,pool,p1);
  if public.catalog_physical_availability('ACCT-QA-A',p1,array[a,b]) is distinct from 6 then raise exception 'mirrored stock counted twice'; end if;
  if public.catalog_physical_availability('ACCT-QA-A',bundle,array[a,b]) is distinct from 2 then raise exception 'bundle capacity is incorrect'; end if;
  update public.inventory set quantity=9 where id=inv2;
  if public.catalog_physical_availability('ACCT-QA-A',p1,array[a,b]) is not null then raise exception 'conflicting pool observations were accepted'; end if;
end $$;
reset role;
do $$
declare a uuid:='b5200000-0000-4000-8000-000000000011'; bundle uuid:='b5200000-0000-4000-8000-000000000021'; recipe2 uuid; p1 uuid;
begin
  select id into recipe2 from public.product_bundle_versions where product_id=bundle and version=2;
  select product_id into p1 from public.product_channel_mappings where marketplace_account_id=a and identifier_value='SAME';
  -- A source sale keeps the recipe captured when it was first written.
  insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,match_status,match_method)
    values('ACCT-QA-A',a,'amazon',bundle,'sku','BUNDLE','linked','manual');
  insert into public.order_items(merchant_code,marketplace_account_id,platform,order_id,line_id,sku,quantity,line_total)
    values('ACCT-QA-A',a,'amazon','same-order','bundle-line','BUNDLE',1,100);
  if (select bundle_version_id from public.order_items where marketplace_account_id=a and line_id='bundle-line') is distinct from recipe2 then raise exception 'recipe not captured on sale'; end if;
  perform public.save_product_bundle('ACCT-QA-A',bundle,jsonb_build_array(jsonb_build_object('product_id',p1,'units',4)),recipe2);
  update public.order_items set quantity=2 where marketplace_account_id=a and line_id='bundle-line';
  if (select bundle_version_id from public.order_items where marketplace_account_id=a and line_id='bundle-line') is distinct from recipe2 then raise exception 'old sale repriced with new recipe'; end if;
end $$;
-- Read models must also execute as the merchant browser role, not only as
-- a privileged fixture writer. Historical recipe cost remains 3 * 10 per kit.
set local role authenticated;
do $$
declare a uuid:='b5200000-0000-4000-8000-000000000011'; b uuid:='b5200000-0000-4000-8000-000000000012'; bundle uuid:='b5200000-0000-4000-8000-000000000021'; result record; p1 uuid;
begin
  select * into strict result from public.product_profitability_for_accounts('ACCT-QA-A',array[a,b]) where product_id=bundle;
  if result.total_cost is distinct from 60 or result.net_profit is distinct from 33 then raise exception 'bundle snapshot profitability incorrect: cost %, profit %',result.total_cost,result.net_profit; end if;
  select * into strict result from public.statement_costs_by_account('ACCT-QA-A',array[a],now()-interval '1 day',now()+interval '1 day');
  if result.cogs is distinct from 60 or result.costed_units is distinct from 2 or result.missing_units is distinct from 0 then raise exception 'statement bundle cost is incorrect'; end if;
  perform * from public.inventory_health_by_account where merchant_code='ACCT-QA-A';
  perform * from public.list_marketplace_operation_facts_by_account('ACCT-QA-A',p_account_ids=>array[a]);
  perform public.unified_product_catalog_by_account('ACCT-QA-A',array[a,b]);
  if exists(select 1 from public.product_profitability_for_accounts('ACCT-QA-B',array['b5200000-0000-4000-8000-000000000013'::uuid])) then raise exception 'other tenant profitability exposed'; end if;
end $$;
reset role;
do $$
declare p uuid;
begin
 select product_id into p from public.product_channel_mappings where marketplace_account_id='b5200000-0000-4000-8000-000000000011' and identifier_value='SAME';
 insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,match_status,match_method) values
 ('ACCT-QA-A','b5200000-0000-4000-8000-000000000011','amazon',p,'sku','ALT-A','linked','manual'),
 ('ACCT-QA-A','b5200000-0000-4000-8000-000000000012','amazon',p,'sku','ALT-B','linked','manual');
 insert into public.orders(merchant_code,marketplace_account_id,platform,order_id,status,sku,quantity,total_amount,platform_fee,order_date) values
 ('ACCT-QA-A','b5200000-0000-4000-8000-000000000011','amazon','variant-order','delivered','ALT-A',2,100,5,now()),
 ('ACCT-QA-A','b5200000-0000-4000-8000-000000000012','amazon','variant-order','delivered','ALT-B',3,150,7,now());
end $$;
set local role authenticated;
do $$
declare p uuid; r record; family uuid;
begin
 select product_id into p from public.product_channel_mappings where marketplace_account_id='b5200000-0000-4000-8000-000000000011' and identifier_value='SAME';
 select * into strict r from public.product_profitability_for_accounts('ACCT-QA-A',array['b5200000-0000-4000-8000-000000000011'::uuid,'b5200000-0000-4000-8000-000000000012'::uuid]) where product_id=p;
 if r.revenue is distinct from 250 or r.units_sold is distinct from 5 or r.total_cost is distinct from 50 or r.net_profit is distinct from 188 then raise exception 'different source SKUs did not aggregate to the same variant'; end if;
 select * into strict r from public.product_profitability_for_accounts('ACCT-QA-A',array['b5200000-0000-4000-8000-000000000011'::uuid]) where product_id=p;
 if r.revenue is distinct from 100 then raise exception 'single account leaked second-account revenue'; end if;
 insert into public.product_families(merchant_code,name) values('ACCT-QA-A','Test family') returning id into family;
 update public.products set family_id=family,variant_attributes='{"color":"red","size":"M"}' where id=p;
 if not exists(select 1 from public.products where id=p and family_id=family and variant_attributes->>'size'='M') then raise exception 'variant edit failed'; end if;
 begin
  update public.products set product_kind='virtual_bundle' where id=p;
  raise exception 'browser bypassed versioned recipe RPC';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Identical settlement references may belong to different selling accounts.
insert into public.platform_file_uploads(id,merchant_code,platform,file_name,file_type,status)
values('b5200000-0000-4000-8000-000000000081','ACCT-QA-A','bank','synthetic.csv','bank_statement','success');
insert into public.bank_transactions(id,merchant_code,upload_id,transaction_key,transaction_date,credit)
select ('b5200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ACCT-QA-A','b5200000-0000-4000-8000-000000000081','bank-synthetic-key-'||n,current_date,90 from generate_series(82,84) n;
set local role authenticated;
do $$
begin
 insert into public.settlement_bank_matches(merchant_code,marketplace_account_id,bank_transaction_id,platform,settlement_id,expected_amount,confirmed_by) values
 ('ACCT-QA-A','b5200000-0000-4000-8000-000000000011','b5200000-0000-4000-8000-000000000082','amazon','shared-settlement',90,auth.uid()),
 ('ACCT-QA-A','b5200000-0000-4000-8000-000000000012','b5200000-0000-4000-8000-000000000083','amazon','shared-settlement',90,auth.uid());
 if (select count(*) from public.settlement_bank_matches where settlement_id='shared-settlement') is distinct from 2 then raise exception 'bank settlement accounts collided'; end if;
 begin
  insert into public.settlement_bank_matches(merchant_code,marketplace_account_id,bank_transaction_id,platform,settlement_id,expected_amount,confirmed_by)
  values('ACCT-QA-A','b5200000-0000-4000-8000-000000000011','b5200000-0000-4000-8000-000000000082','amazon','reuse-bank',90,auth.uid());
  raise exception 'bank credit reused';
 exception when unique_violation then null; end;
 begin
  insert into public.settlement_bank_matches(merchant_code,marketplace_account_id,bank_transaction_id,platform,settlement_id,expected_amount,confirmed_by)
  values('ACCT-QA-A','b5200000-0000-4000-8000-000000000013','b5200000-0000-4000-8000-000000000084','amazon','cross-tenant',90,auth.uid());
  raise exception 'cross-tenant bank match accepted';
 exception when foreign_key_violation then null; end;
end $$;
reset role;
rollback;
