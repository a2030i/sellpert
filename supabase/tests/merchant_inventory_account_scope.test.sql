-- Synthetic isolated fixtures. Identical SKU/ASN references across sellers must not join.
begin;
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ca300000-0000-4000-8000-000000000001','authenticated','authenticated','merchant-review@test.invalid','','{}','{}',now(),now());
insert into public.merchants(id,merchant_code,name,email,role,is_active,workspace_status) values
('ca300000-0000-4000-8000-000000000001','MR-A','Review A','merchant-review@test.invalid','merchant',true,'active'),
('ca300000-0000-4000-8000-000000000002','MR-B','Other','review-other@test.invalid','merchant',true,'active');
insert into public.marketplace_accounts(id,merchant_code,platform,label,status,is_legacy) values
('ca300000-0000-4000-8000-000000000011','MR-A','noon','Old','disconnected',true),
('ca300000-0000-4000-8000-000000000012','MR-A','noon','New','active',false),
('ca300000-0000-4000-8000-000000000013','MR-B','noon','Foreign','active',false);
insert into public.inventory(merchant_code,marketplace_account_id,platform,sku,quantity,cost_price) values
('MR-A','ca300000-0000-4000-8000-000000000011','noon','SAME',4,5),
('MR-A','ca300000-0000-4000-8000-000000000012','noon','SAME',8,0),
('MR-B','ca300000-0000-4000-8000-000000000013','noon','SAME',100,5);
insert into public.orders(merchant_code,marketplace_account_id,platform,order_id,sku,status,quantity,total_amount,order_date) values
('MR-A','ca300000-0000-4000-8000-000000000011','noon','OLD-ORDER','SAME','delivered',2,40,now());
insert into public.inbound_shipments(merchant_code,marketplace_account_id,platform,asn_number,expected_qty,delivered_qty,delivery_date) values
('MR-A','ca300000-0000-4000-8000-000000000011','noon','SAME-ASN',4,4,current_date-1),
('MR-A','ca300000-0000-4000-8000-000000000012','noon','SAME-ASN',8,8,current_date-1),
('MR-B','ca300000-0000-4000-8000-000000000013','noon','SAME-ASN',100,100,current_date-1);
insert into public.goods_received(merchant_code,marketplace_account_id,platform,asn_number,grn_quantity,qc_status) values
('MR-A','ca300000-0000-4000-8000-000000000011','noon','SAME-ASN',4,'passed'),
('MR-A','ca300000-0000-4000-8000-000000000012','noon','SAME-ASN',8,'failed');
insert into public.ad_metrics(merchant_code,marketplace_account_id,platform,campaign_name,spend,report_date) values
('MR-A','ca300000-0000-4000-8000-000000000011','noon','Old ad',12,current_date),
('MR-B','ca300000-0000-4000-8000-000000000013','noon','Foreign ad',99,current_date);
select set_config('request.jwt.claims','{"sub":"ca300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
declare old_account uuid:='ca300000-0000-4000-8000-000000000011'; new_account uuid:='ca300000-0000-4000-8000-000000000012'; r record;
begin
  if (select count(*) from public.inventory_ageing_by_account)<>2 then raise exception 'Ageing leaked foreign workspace'; end if;
  select * into strict r from public.inventory_ageing_by_account where marketplace_account_id=new_account;
  if r.last_sold is not null or r.tied_capital is not null or r.cost_price is not null then raise exception 'Old sales or zero costs contaminated new account'; end if;
  if (select tied_capital from public.inventory_ageing_by_account where marketplace_account_id=old_account)<>20 then raise exception 'Known stock cost lost'; end if;
  if (select count(*) from public.inventory_pipeline_by_account)<>2 then raise exception 'Pipeline leaked or multiplied source shipments'; end if;
  select * into strict r from public.inventory_pipeline_by_account where marketplace_account_id=new_account;
  if r.grn_total<>8 or r.qc_failed_qty<>8 or r.units_sold_after_receive<>0 or r.revenue_after_receive<>0 then raise exception 'Same ASN crossed seller boundary'; end if;
  select * into strict r from public.inventory_pipeline_by_account where marketplace_account_id=old_account;
  if r.grn_total<>4 or r.qc_failed_qty<>0 or r.revenue_after_receive<>40 then raise exception 'Own shipment facts changed'; end if;
  if (select sum(spend) from public.ad_metrics)<>12 then raise exception 'Ad RLS leaked another merchant'; end if;
end $$;
reset role;
rollback;
