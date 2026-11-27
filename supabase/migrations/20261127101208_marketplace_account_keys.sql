-- All account-specific facts retain their original external identifiers.
-- NULL means unassigned historical/legacy data, never "the first account".
alter table public.order_packages drop constraint order_packages_order_fkey;

-- Historical rows stay in an explicit unassigned source, never the first seller.
alter table public.marketplace_accounts add column is_legacy boolean not null default false;
alter table public.marketplace_accounts drop constraint marketplace_accounts_platform_check;
alter table public.marketplace_accounts add check (platform ~ '^[a-z0-9_-]{1,40}$');
create unique index marketplace_accounts_legacy_scope_key on public.marketplace_accounts(merchant_code,platform) where is_legacy;
create function security.ensure_legacy_marketplace_account(p_merchant text,p_platform text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  select id into result from public.marketplace_accounts where merchant_code=p_merchant and platform=p_platform and is_legacy;
  if found then return result; end if;
  insert into public.marketplace_accounts(merchant_code,platform,label,status,is_legacy)
    values(p_merchant,p_platform,'بيانات قديمة غير منسوبة لحساب','disconnected',true)
    on conflict (merchant_code,platform) where is_legacy do nothing returning id into result;
  if result is null then
    select id into result from public.marketplace_accounts where merchant_code=p_merchant and platform=p_platform and is_legacy;
  end if;
  return result;
end $$;
revoke all on function security.ensure_legacy_marketplace_account(text,text) from public,anon,authenticated;
grant execute on function security.ensure_legacy_marketplace_account(text,text) to service_role;
create function security.set_legacy_marketplace_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.marketplace_account_id is null then
    new.marketplace_account_id:=security.ensure_legacy_marketplace_account(new.merchant_code,
      coalesce(to_jsonb(new)->>'platform',case when tg_table_name='amazon_daily_sales' then 'amazon' when tg_table_name like 'trendyol_%' then 'trendyol' else 'other' end));
  end if;
  return new;
end $$;
revoke all on function security.set_legacy_marketplace_account() from public,anon,authenticated;
do $legacy$
declare t text; source_platform text;
begin
  foreach t in array array['orders','order_items','order_packages','returns','account_transactions',
    'inventory','platform_file_uploads','sync_queue','sync_logs','product_channel_mappings','product_platform_prices',
    'product_platform_listings','ad_metrics','performance_data','product_performance_snapshots','amazon_daily_sales','marketplace_action_logs','inbound_shipments','inbound_shipment_items','goods_received','platform_deals','trendyol_customer_questions','trendyol_question_reply_attempts'] loop
    source_platform:=case when t='amazon_daily_sales' then quote_literal('amazon') when t like 'trendyol_%' then quote_literal('trendyol') else 'coalesce(platform,''other'')' end;
    execute format('update public.%I set marketplace_account_id=security.ensure_legacy_marketplace_account(merchant_code,%s) where marketplace_account_id is null',t,source_platform);
    execute format('create trigger assign_legacy_marketplace_account before insert on public.%I for each row execute function security.set_legacy_marketplace_account()',t);
    execute format('alter table public.%I alter column marketplace_account_id set not null',t);
  end loop;
end $legacy$;

do $keys$
declare t text; key_columns text[]; constraint_row record; idx record; columns_sql text;
begin
  for t,key_columns in select * from (values
    ('platform_credentials',array['merchant_code','platform']),
    ('orders',array['merchant_code','platform','order_id']),
    ('order_items',array['merchant_code','platform','order_id','line_id']),
    ('order_packages',array['merchant_code','platform','shipment_package_id']),
    ('inventory',array['merchant_code','sku','platform']),
    ('product_channel_mappings',array['merchant_code','platform','identifier_type','identifier_value']),
    ('product_platform_listings',array['product_id','platform']),
    ('product_platform_prices',array['product_id','platform']),
    ('account_transactions',array['merchant_code','platform','transaction_no']),
    ('returns',array['merchant_code','platform','claim_id','claim_line_id']),
    ('ad_metrics',array['merchant_code','platform','report_date','campaign_name','ad_group_name','sku','search_query']),
    ('product_performance_snapshots',array['merchant_code','platform','snapshot_date','sku']),
    ('amazon_daily_sales',array['merchant_code','data_date']),
    ('inbound_shipments',array['merchant_code','platform','asn_number']),
    ('goods_received',array['merchant_code','platform','asn_number','sku','qc_status','reject_reason']),
    ('platform_deals',array['merchant_code','platform','barcode','content_id']),
    ('trendyol_customer_questions',array['merchant_code','question_id'])
  ) as specs(table_name,keys) loop
    for constraint_row in select con.conname from pg_constraint con
      where con.conrelid=to_regclass('public.'||t) and con.contype='u'
      and (select array_agg(a.attname::text order by u.ordinality) from unnest(con.conkey) with ordinality u(attnum,ordinality)
        join pg_attribute a on a.attrelid=con.conrelid and a.attnum=u.attnum)=key_columns
    loop execute format('alter table public.%I drop constraint %I',t,constraint_row.conname); end loop;
    for idx in select i.indexrelid::regclass as name from pg_index i where i.indrelid=to_regclass('public.'||t)
      and i.indisunique and not i.indisprimary
      and (select array_agg(a.attname::text order by u.ordinality) from unnest(i.indkey) with ordinality u(attnum,ordinality)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=u.attnum)=key_columns
    loop execute format('drop index %s',idx.name); end loop;
    select string_agg(quote_ident(c),',') into columns_sql from unnest(key_columns || array['marketplace_account_id']) c;
    -- Ordinary NULL semantics preserve distinct manual records without provider IDs.
    execute format('create unique index %I on public.%I(%s)',t||'_account_natural_key',t,columns_sql);
  end loop;
end $keys$;

alter table public.order_packages add constraint order_packages_order_fkey
  foreign key (merchant_code,platform,order_id,marketplace_account_id)
  references public.orders(merchant_code,platform,order_id,marketplace_account_id) on delete cascade;

create function security.validate_marketplace_account_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_platform text; v_row jsonb:=to_jsonb(new);
begin
  if tg_op='UPDATE' and new.marketplace_account_id is distinct from old.marketplace_account_id then
    raise exception 'Account lineage is immutable; use the reviewed reconciliation workflow';
  end if;
  if new.marketplace_account_id is null then return new; end if;
  select platform into v_platform from public.marketplace_accounts
    where id=new.marketplace_account_id and merchant_code=new.merchant_code;
  if not found or (v_row ? 'platform' and v_row->>'platform' is distinct from v_platform)
    or (tg_table_name='salla_connections' and v_platform<>'salla')
    or (tg_table_name like 'trendyol_%' and v_platform<>'trendyol')
    or (tg_table_name in ('amazon_oauth_states','amazon_daily_sales') and v_platform<>'amazon') then
    raise exception 'Selling account scope mismatch' using errcode='23503';
  end if;
  return new;
end $$;
revoke all on function security.validate_marketplace_account_scope() from public,anon,authenticated;
do $scope$
declare t text;
begin
  foreach t in array array['platform_credentials','salla_connections','amazon_oauth_states','orders','order_items','order_packages','returns','account_transactions',
    'inventory','platform_file_uploads','sync_queue','sync_logs','product_channel_mappings','product_platform_prices','product_platform_listings',
    'ad_metrics','performance_data','product_performance_snapshots','amazon_daily_sales','marketplace_action_logs','inbound_shipments','inbound_shipment_items','goods_received','platform_deals','trendyol_customer_questions','trendyol_question_reply_attempts'] loop
    execute format('create trigger validate_marketplace_account_scope before insert or update on public.%I for each row execute function security.validate_marketplace_account_scope()',t);
  end loop;
end $scope$;

-- Keep one source file atomic while processing large report tables in bounded
-- statements. Noon Brand Queries exports commonly contain 30,000 rows, which
-- is within the file-level 100,000-row limit but exceeded the old 25,000-row
-- per-table statement limit.

create or replace function security.upsert_merchant_import_rows(
  p_table text,
  p_rows jsonb,
  p_upload_id uuid,
  p_merchant_code text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_conflict_columns text;
  v_conflict_array text[];
  v_chunk jsonb;
  v_rows jsonb;
  v_insert_columns text;
  v_select_columns text;
  v_update_columns text;
  v_sql text;
  v_chunk_affected integer := 0;
  v_affected integer := 0;
begin
  v_conflict_columns := case p_table
    when 'orders' then 'merchant_code,platform,order_id'
    when 'products' then 'merchant_code,sku'
    when 'inventory' then 'merchant_code,sku,platform'
    when 'inbound_shipments' then 'merchant_code,platform,asn_number'
    when 'inbound_shipment_items' then 'shipment_id,sku'
    when 'goods_received' then 'merchant_code,platform,asn_number,sku,qc_status,reject_reason'
    when 'ad_metrics' then 'merchant_code,platform,report_date,campaign_name,ad_group_name,sku,search_query'
    when 'account_transactions' then 'merchant_code,platform,transaction_no'
    when 'platform_deals' then 'merchant_code,platform,barcode,content_id'
    when 'product_performance_snapshots' then 'merchant_code,platform,snapshot_date,sku'
    when 'amazon_daily_sales' then 'merchant_code,data_date'
    else null
  end;

  if v_conflict_columns is null then
    raise exception using errcode = '22023', message = 'unsupported import table';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'import rows must be an array';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_rows) > 100000 then
    raise exception using errcode = '54000', message = 'import payload is too large';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_value
    where jsonb_typeof(row_value) <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'every import row must be an object';
  end if;

  if p_table='products' then
    select marketplace_account_id into v_account from public.platform_file_uploads where id=p_upload_id and merchant_code=p_merchant_code;
    if v_account is null then raise exception 'Import account is required'; end if;
    for v_chunk in
      select jsonb_agg(value order by ordinality) from jsonb_array_elements(p_rows) with ordinality
      group by (ordinality-1)/5000 order by (ordinality-1)/5000
    loop
      select jsonb_agg((value-'merchant_code'-'id'-'upload_id'-'created_at')||jsonb_build_object('upload_id',p_upload_id)) into v_chunk from jsonb_array_elements(v_chunk);
      perform security.upsert_marketplace_products(v_account,p_merchant_code,v_chunk);
    end loop;
    return jsonb_array_length(p_rows);
  end if;
  if p_table <> 'products' then
    select marketplace_account_id into v_account from public.platform_file_uploads where id=p_upload_id and merchant_code=p_merchant_code;
    if v_account is null then raise exception 'Import account is required'; end if;
    if p_table <> 'inbound_shipment_items' then
      v_conflict_columns:=v_conflict_columns||',marketplace_account_id';
    end if;
    select jsonb_agg(row_value || jsonb_build_object('marketplace_account_id',v_account)) into p_rows
      from jsonb_array_elements(p_rows) row_value;
  end if;
  v_conflict_array := string_to_array(v_conflict_columns, ',');

  -- Five thousand rows keeps each jsonb_populate_recordset/upsert statement
  -- bounded. All chunks still run inside the caller's single transaction, so
  -- a failure in any chunk rolls back the complete file import.
  for v_chunk in
    select jsonb_agg(source.row_value order by source.ordinality)
    from jsonb_array_elements(p_rows) with ordinality as source(row_value, ordinality)
    group by ((source.ordinality - 1) / 5000)
    order by ((source.ordinality - 1) / 5000)
  loop
    select jsonb_agg(
      (row_value - 'merchant_code' - 'upload_id' - 'id' - 'created_at')
        || jsonb_build_object('merchant_code', p_merchant_code, 'upload_id', p_upload_id)
    )
    into v_rows
    from jsonb_array_elements(v_chunk) row_value;

    select
      string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum),
      string_agg(format('source.%I', attribute.attname), ', ' order by attribute.attnum),
      string_agg(
        format('%1$I = excluded.%1$I', attribute.attname),
        ', ' order by attribute.attnum
      ) filter (
        where not (attribute.attname = any(v_conflict_array))
          and attribute.attname not in ('id', 'created_at')
      )
    into v_insert_columns, v_select_columns, v_update_columns
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = format('public.%I', p_table)::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attgenerated = ''
      and attribute.attidentity = ''
      and attribute.attname not in ('id', 'created_at')
      and (
        attribute.attname in ('merchant_code', 'upload_id')
        or exists (
          select 1 from jsonb_array_elements(v_rows) row_value
          where row_value ? attribute.attname
        )
      );

    if v_insert_columns is null then
      raise exception using errcode = '22023', message = 'import payload has no supported columns';
    end if;
    if exists (
      select 1 from unnest(v_conflict_array) conflict_column
      where position(format('%I', conflict_column) in v_insert_columns) = 0
    ) then
      raise exception using errcode = '23502', message = 'import row is missing a required identifier';
    end if;

    v_sql := format(
      'with source as (select * from jsonb_populate_recordset(null::public.%1$I, $1))
       insert into public.%1$I (%2$s)
       select %3$s from source
       on conflict (%4$s) do %5$s',
      p_table,
      v_insert_columns,
      v_select_columns,
      v_conflict_columns,
      case when v_update_columns is null then 'nothing' else 'update set ' || v_update_columns end
    );

    execute v_sql using v_rows;
    get diagnostics v_chunk_affected = row_count;
    v_affected := v_affected + v_chunk_affected;
  end loop;

  return v_affected;
end
$$;

revoke all on function security.upsert_merchant_import_rows(text, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function security.upsert_merchant_import_rows(text, jsonb, uuid, text)
  to service_role;
