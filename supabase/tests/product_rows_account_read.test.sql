-- Isolated fixtures only. Exercise paging and real authenticated RLS.
begin;
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('ca290000-0000-4000-8000-000000000001','authenticated','authenticated','product-read@test.invalid','','{"provider":"email"}','{}',now(),now());
insert into public.merchants(id,merchant_code,name,email,role,is_active,workspace_status,owner_merchant_code,permissions) values
('ca290000-0000-4000-8000-000000000001','READ-A','Read A','product-read@test.invalid','merchant',true,'active',null,'{}'),
('ca290000-0000-4000-8000-000000000002','READ-B','Read B','other-read@test.invalid','merchant',true,'active',null,'{}'),
('ca290000-0000-4000-8000-000000000003','READ-E','Read employee','employee-read@test.invalid','employee',true,'active','READ-A','{"products":false}');
insert into public.marketplace_accounts(id,merchant_code,platform,label,status,is_legacy) values
('ca290000-0000-4000-8000-000000000011','READ-A','trendyol','First','active',false),
('ca290000-0000-4000-8000-000000000012','READ-A','amazon','Second','active',false),
('ca290000-0000-4000-8000-000000000013','READ-A','other','Legacy','disconnected',true),
('ca290000-0000-4000-8000-000000000014','READ-B','amazon','Foreign','active',false);
insert into public.products(merchant_code,name,sku,created_at)
select 'READ-A','Product '||n,'P-'||n,'2026-01-01'::timestamptz + n*interval '1 second' from generate_series(1,1002)n;
insert into public.products(merchant_code,name,sku) values ('READ-A','Manual','MANUAL'),('READ-A','Old','OLD'),('READ-B','Foreign','FOREIGN');
insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,match_status)
select 'READ-A','ca290000-0000-4000-8000-000000000011','trendyol',id,'sku',sku,'linked' from public.products where merchant_code='READ-A' and sku like 'P-%';
insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,match_status)
select 'READ-A','ca290000-0000-4000-8000-000000000012','amazon',id,'sku',sku,'linked' from public.products where merchant_code='READ-A' and sku='P-1';
insert into public.product_channel_mappings(merchant_code,marketplace_account_id,platform,product_id,identifier_type,identifier_value,match_status)
select 'READ-A','ca290000-0000-4000-8000-000000000013','other',id,'sku',sku,'linked' from public.products where merchant_code='READ-A' and sku='OLD';
select set_config('request.jwt.claims','{"sub":"ca290000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare a uuid:='ca290000-0000-4000-8000-000000000011'; b uuid:='ca290000-0000-4000-8000-000000000012'; legacy uuid:='ca290000-0000-4000-8000-000000000013';
  first_ids uuid[]; next_ids uuid[];
begin
  select array_agg(id) into first_ids from public.product_rows_by_account('READ-A',array[a,b],false,1000,0);
  select array_agg(id) into next_ids from public.product_rows_by_account('READ-A',array[a,b],false,1000,1000);
  if cardinality(first_ids)<>1000 or cardinality(next_ids)<>2 or first_ids && next_ids then raise exception 'Pagination duplicated or truncated scoped products'; end if;
  if (select count(*) from public.product_rows_by_account('READ-A',array[legacy],true,1000,0))<>2 then raise exception 'Legacy scope must include only old and unmapped manual products'; end if;
  if (select count(*) from public.product_rows_by_account('READ-A',array[b],false,1000,0))<>1 then raise exception 'Second scope leaked other account rows'; end if;
  if (select count(*) from public.product_rows_by_account('READ-A',array[]::uuid[],false,1000,0))<>0 then raise exception 'Empty scope leaked products'; end if;
  if (select count(*) from public.product_rows_by_account('READ-A',array[]::uuid[],true,1000,0))<>1 then raise exception 'Manual-only scope incorrect'; end if;
  if (select count(*) from public.product_rows_by_account('READ-B',array[]::uuid[],true,1000,0))<>0 then raise exception 'Foreign merchant visible through RPC'; end if;
  if (select count(*) from public.products where merchant_code='READ-B')<>0 then raise exception 'Foreign merchant visible through table'; end if;
  if exists(select 1 from public.product_rows_by_account('READ-A',array[a],false,1,0) p where to_jsonb(p) ? 'raw') then raise exception 'RPC exposed provider payload'; end if;
  update public.products set cost_price=13 where merchant_code='READ-A' and sku='P-1';
  if not found then raise exception 'Existing allowed product update was lost'; end if;
  update public.products set cost_price=99 where merchant_code='READ-B';
  if found then raise exception 'Cross-tenant write succeeded'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"ca290000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.product_rows_by_account('READ-A',array[]::uuid[],true,1000,0))<>0 then raise exception 'Employee without products permission accessed RPC'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
update public.merchants set permissions='{"products":true}' where merchant_code='READ-E';
select set_config('request.jwt.claims','{"sub":"ca290000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.product_rows_by_account('READ-A',array[]::uuid[],true,1000,0))<>1 then raise exception 'Employee product permission not honored'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
update public.merchants set is_active=false where merchant_code='READ-E';
select set_config('request.jwt.claims','{"sub":"ca290000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.product_rows_by_account('READ-A',array[]::uuid[],true,1000,0))<>0 then raise exception 'Inactive employee accessed products'; end if;
end $$;
reset role;
rollback;
