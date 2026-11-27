begin;
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ca310000-0000-4000-8000-000000000001','authenticated','authenticated','health-resolution@test.invalid','','{}','{}',now(),now());
insert into public.merchants(id,merchant_code,name,email,role,is_active,workspace_status)
values('ca310000-0000-4000-8000-000000000001','HR-A','Health fixture','health-resolution@test.invalid','merchant',true,'active');
insert into public.marketplace_accounts(id,merchant_code,platform,label,status,is_legacy) values
('ca310000-0000-4000-8000-000000000011','HR-A','noon','First','active',false),
('ca310000-0000-4000-8000-000000000012','HR-A','noon','Second','active',false);
insert into public.products(id,merchant_code,sku,name,cost_price,sale_price) values
('ca310000-0000-4000-8000-000000000021','HR-A','CANONICAL-ONE','One',7,20),
('ca310000-0000-4000-8000-000000000022','HR-A','CANONICAL-TWO','Two',99,120);
insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,source_sku,source_barcode,match_status) values
('HR-A','ca310000-0000-4000-8000-000000000011','noon','ca310000-0000-4000-8000-000000000021','sku','SHARED','SHARED','SHARED','linked'),
('HR-A','ca310000-0000-4000-8000-000000000012','noon','ca310000-0000-4000-8000-000000000022','sku','SHARED','SHARED',null,'linked'),
('HR-A','ca310000-0000-4000-8000-000000000011','noon','ca310000-0000-4000-8000-000000000021','sku','ALIAS-ONE','AMBIG',null,'linked'),
('HR-A','ca310000-0000-4000-8000-000000000011','noon','ca310000-0000-4000-8000-000000000022','sku','ALIAS-TWO',null,'AMBIG','linked');
insert into public.inventory(merchant_code,marketplace_account_id,platform,sku,quantity,reserved_quantity,cost_price) values
('HR-A','ca310000-0000-4000-8000-000000000011','noon','SHARED',10,2,0),
('HR-A','ca310000-0000-4000-8000-000000000012','noon','SHARED',4,0,0),
('HR-A','ca310000-0000-4000-8000-000000000011','noon','LOCAL',3,0,3),
('HR-A','ca310000-0000-4000-8000-000000000011','noon','UNMAPPED',3,0,0),
('HR-A','ca310000-0000-4000-8000-000000000011','noon','AMBIG',3,0,0);
select set_config('request.jwt.claims','{"sub":"ca310000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ declare r record; begin
  if (select count(*) from public.inventory_health_by_account)<>5 then raise exception 'Alias multiplicity changed inventory count'; end if;
  select * into strict r from public.inventory_health_by_account where sku='SHARED' and marketplace_account_id='ca310000-0000-4000-8000-000000000011';
  if r.quantity<>8 or r.cost_price<>7 or r.stock_value_cost<>56 or r.selling_price<>20 or r.stock_value_retail<>160 then raise exception 'Own mapping, reservations or price precedence changed'; end if;
  if (select cost_price from public.inventory_health_by_account where sku='SHARED' and marketplace_account_id='ca310000-0000-4000-8000-000000000012')<>99 then raise exception 'Source identity crossed account'; end if;
  if (select cost_price from public.inventory_health_by_account where sku='LOCAL')<>3 then raise exception 'Local inventory cost lost'; end if;
  if exists(select 1 from public.inventory_health_by_account where sku in ('UNMAPPED','AMBIG') and (cost_price<>0 or selling_price<>0)) then raise exception 'Unresolved identity assigned a cost or price'; end if;
  if exists(select 1 from public.inventory_health_by_account h join public.inventory i on i.id=h.id
    left join public.products p on p.merchant_code=i.merchant_code and p.id=public.resolve_catalog_variant(i.merchant_code,i.marketplace_account_id,i.platform,array[i.sku,i.partner_sku])
    where h.cost_price is distinct from coalesce(nullif(i.cost_price,0),p.cost_price,0)) then raise exception 'Batched resolution differs from canonical resolver'; end if;
end $$;
reset role;
rollback;
