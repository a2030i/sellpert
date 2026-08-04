-- Commit every accepted source file in one database transaction. A parser or
-- constraint failure therefore cannot leave a merchant with half an import.

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
  v_rows jsonb;
  v_insert_columns text;
  v_select_columns text;
  v_update_columns text;
  v_sql text;
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
  if jsonb_array_length(p_rows) > 25000 then
    raise exception using errcode = '54000', message = 'import payload is too large';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) row_value where jsonb_typeof(row_value) <> 'object') then
    raise exception using errcode = '22023', message = 'every import row must be an object';
  end if;

  -- Tenant and audit identity are server-owned, never trusted from the client.
  select jsonb_agg(
    (row_value - 'merchant_code' - 'upload_id' - 'id' - 'created_at')
      || jsonb_build_object('merchant_code', p_merchant_code, 'upload_id', p_upload_id)
  )
  into v_rows
  from jsonb_array_elements(p_rows) row_value;

  v_conflict_array := string_to_array(v_conflict_columns, ',');

  select
    string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum),
    string_agg(format('source.%I', attribute.attname), ', ' order by attribute.attnum),
    string_agg(
      format('%1$I = excluded.%1$I', attribute.attname),
      ', ' order by attribute.attnum
    ) filter (where not (attribute.attname = any(v_conflict_array)) and attribute.attname not in ('id', 'created_at'))
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
  get diagnostics v_affected = row_count;
  return v_affected;
end
$$;

create or replace function security.commit_merchant_file_import(
  p_upload_id uuid,
  p_payloads jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_upload public.platform_file_uploads%rowtype;
  v_payload jsonb;
  v_table text;
  v_rows jsonb;
  v_items jsonb;
  v_expected_items integer := 0;
  v_total integer := 0;
  v_inserted integer := 0;
  v_count integer := 0;
  v_derived jsonb := '{}'::jsonb;
  v_is_service_role boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if not v_is_service_role and (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if jsonb_typeof(p_payloads) is distinct from 'array' or jsonb_array_length(p_payloads) = 0 then
    raise exception using errcode = '22023', message = 'at least one import payload is required';
  end if;

  select * into v_upload
  from public.platform_file_uploads
  where id = p_upload_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'upload record not found';
  end if;
  if not v_is_service_role and not security.has_merchant_permission(v_upload.merchant_code, 'integrations') then
    raise exception using errcode = '42501', message = 'upload does not belong to the active merchant workspace';
  end if;
  if v_upload.status <> 'processing' then
    raise exception using errcode = '55000', message = 'upload is not ready for import';
  end if;
  if v_upload.storage_path is null then
    raise exception using errcode = '55000', message = 'source file must be archived before import';
  end if;
  if split_part(v_upload.storage_path, '/', 1) <> v_upload.merchant_code
     or split_part(v_upload.storage_path, '/', 2) <> p_upload_id::text then
    raise exception using errcode = '42501', message = 'source archive is outside the merchant workspace';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payloads) payload
    group by payload ->> 'table'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'duplicate import payload table';
  end if;

  select coalesce(sum(jsonb_array_length(payload -> 'rows')), 0)
  into v_total
  from jsonb_array_elements(p_payloads) payload
  where jsonb_typeof(payload -> 'rows') = 'array';

  if v_total <= 0 or v_total > 100000 then
    raise exception using errcode = '54000', message = 'import row count is outside the supported range';
  end if;

  -- Parents are always committed before their ASN items, independent of the
  -- client payload order. Every statement remains in this same transaction.
  for v_payload in
    select payload
    from jsonb_array_elements(p_payloads) payload
    order by case payload ->> 'table'
      when 'inbound_shipments' then 0
      when 'inbound_shipment_items' then 2
      else 1
    end
  loop
    v_table := v_payload ->> 'table';
    v_rows := v_payload -> 'rows';
    if jsonb_typeof(v_rows) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'import rows must be an array';
    end if;

    if v_table = 'inbound_shipment_items' then
      v_expected_items := jsonb_array_length(v_rows);
      if exists (
        select 1 from jsonb_array_elements(v_rows) item
        where nullif(btrim(item ->> '_asn_number'), '') is null
      ) then
        raise exception using errcode = '23502', message = 'shipment item is missing its ASN number';
      end if;

      select jsonb_agg(
        (item - '_asn_number' - 'merchant_code' - 'upload_id' - 'shipment_id')
          || jsonb_build_object(
            'merchant_code', v_upload.merchant_code,
            'upload_id', p_upload_id,
            'shipment_id', shipment.id
          )
      )
      into v_items
      from jsonb_array_elements(v_rows) item
      join public.inbound_shipments shipment
        on shipment.merchant_code = v_upload.merchant_code
       and shipment.platform = item ->> 'platform'
       and shipment.asn_number = item ->> '_asn_number';

      if coalesce(jsonb_array_length(v_items), 0) <> v_expected_items then
        raise exception using errcode = '23503', message = 'shipment item could not be matched to its ASN';
      end if;
      v_count := security.upsert_merchant_import_rows(v_table, v_items, p_upload_id, v_upload.merchant_code);
    else
      v_count := security.upsert_merchant_import_rows(v_table, v_rows, p_upload_id, v_upload.merchant_code);
    end if;
    v_inserted := v_inserted + v_count;
  end loop;

  v_derived := security.rebuild_all_derived_data(v_upload.merchant_code);

  update public.platform_file_uploads
  set rows_processed = v_total,
      rows_inserted = v_inserted,
      status = 'success',
      error_message = null,
      finished_at = now()
  where id = p_upload_id;

  return jsonb_build_object(
    'inserted', v_inserted,
    'processed', v_total,
    'derived', coalesce(v_derived, '{}'::jsonb)
  );
end
$$;

create or replace function public.commit_my_file_import(
  p_upload_id uuid,
  p_payloads jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select security.commit_merchant_file_import(p_upload_id, p_payloads)
$$;

revoke all on function security.upsert_merchant_import_rows(text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function security.commit_merchant_file_import(uuid, jsonb) from public, anon;
revoke all on function public.commit_my_file_import(uuid, jsonb) from public, anon;

grant execute on function security.upsert_merchant_import_rows(text, jsonb, uuid, text) to service_role;
grant execute on function security.commit_merchant_file_import(uuid, jsonb) to authenticated, service_role;
grant execute on function public.commit_my_file_import(uuid, jsonb) to authenticated, service_role;

comment on function public.commit_my_file_import(uuid, jsonb) is
  'Atomically imports one archived source file into its authorized merchant workspace.';
