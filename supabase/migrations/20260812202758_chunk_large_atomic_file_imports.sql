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

comment on function security.upsert_merchant_import_rows(text, jsonb, uuid, text) is
  'Upserts one import table in 5,000-row statements while preserving the caller transaction.';
