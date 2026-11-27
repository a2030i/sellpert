-- Derived rows are explicitly marked. Rebuilding an unrelated file must not
-- delete API orders, manual prices, or historical records of uncertain lineage.
alter table public.orders add column derived_source text;
alter table public.returns add column derived_source text;
create unique index returns_derived_account_key on public.returns(merchant_code,marketplace_account_id,derived_source,order_id) where derived_source is not null;

CREATE OR REPLACE FUNCTION security.derive_orders_from_account_tx(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  INSERT INTO public.orders (
    merchant_code, marketplace_account_id, derived_source, platform, order_id, status,
    product_name, sku, quantity, unit_price, total_amount,
    platform_fee, currency, order_date
  )
  SELECT
    merchant_code, marketplace_account_id, 'account_transactions', 'amazon', order_id,
    'delivered',
    MAX(NULLIF(description, '')),
    MAX(NULLIF(product_sku, '')),
    1,
    ROUND(SUM(GREATEST(credit, 0))::numeric / NULLIF(COUNT(*) FILTER (WHERE credit > 0), 0), 2),
    SUM(net_amount),
    SUM(GREATEST(debit, 0)),
    MAX(currency),
    MAX(COALESCE(transaction_date, posted_date, created_at))
  FROM public.account_transactions
  WHERE merchant_code = p_merchant_code
    AND platform = 'amazon' AND upload_id IS NOT NULL
    AND order_id ~ '^[0-9]{3}-[0-9]{7}-[0-9]{7}$'  -- صيغة طلب أمازون فقط
    AND transaction_type ILIKE '%مبلغ الطلب%'
    AND COALESCE(amount_description, '') NOT ILIKE '%استرداد%'
    AND COALESCE(amount_description, '') NOT ILIKE '%refund%'
    AND COALESCE(amount_description, '') NOT ILIKE '%إلغاء%'
    AND COALESCE(amount_description, '') NOT ILIKE '%cancel%'
    AND COALESCE(description, '') NOT ILIKE '%رسوم الإلغاء%'
    AND COALESCE(description, '') NOT ILIKE '%Tax%'
  GROUP BY merchant_code, marketplace_account_id, order_id
  HAVING SUM(net_amount) > 0
  ON CONFLICT (merchant_code,platform,order_id,marketplace_account_id) DO UPDATE SET
    total_amount=excluded.total_amount,platform_fee=excluded.platform_fee,unit_price=excluded.unit_price
    WHERE orders.derived_source='account_transactions';  -- فقط طلبات بقيمة موجبة

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;


CREATE OR REPLACE FUNCTION security.derive_returns_from_account_tx(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  INSERT INTO public.returns (
    merchant_code, marketplace_account_id, derived_source, platform, order_id, product_name, sku,
    quantity, return_amount, reason, return_date, status
  )
  SELECT
    merchant_code, marketplace_account_id, 'account_transactions', 'amazon',
    'AMZ-' || order_id,
    MAX(NULLIF(description, '')),
    MAX(NULLIF(product_sku, '')),
    1,
    ABS(SUM(net_amount))::numeric,
    MAX(amount_description),
    DATE(MAX(COALESCE(transaction_date, posted_date))),
    'processed'
  FROM public.account_transactions t
  WHERE merchant_code = p_merchant_code
    AND platform = 'amazon' AND upload_id IS NOT NULL
    AND NOT EXISTS (select 1 from public.returns r where r.merchant_code=t.merchant_code and r.marketplace_account_id=t.marketplace_account_id and r.order_id='AMZ-'||t.order_id and r.derived_source is null)
    AND order_id IS NOT NULL AND order_id <> '' AND order_id <> '---'
    AND (
      amount_description ILIKE '%استرداد%' OR amount_description ILIKE '%refund%' OR
      transaction_type ILIKE '%استرداد%' OR transaction_type ILIKE '%refund%'
    )
  GROUP BY merchant_code, marketplace_account_id, order_id
  HAVING SUM(net_amount) < 0
  ON CONFLICT (merchant_code,marketplace_account_id,derived_source,order_id) WHERE derived_source IS NOT NULL
  DO UPDATE SET return_amount=excluded.return_amount,reason=excluded.reason;  -- فقط المرتجعات الحقيقية (سالبة)

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;


CREATE OR REPLACE FUNCTION security.derive_returns_from_snapshots(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  INSERT INTO public.returns (
    merchant_code, marketplace_account_id, derived_source, platform, order_id, product_name, sku,
    quantity, return_amount, reason, return_date, status
  )
  SELECT
    s.merchant_code, s.marketplace_account_id, 'snapshots', s.platform,
    'SNAP-' || s.id::text,
    s.product_name, s.sku,
    s.returned,
    ROUND((COALESCE(s.avg_price, 0) * s.returned)::numeric, 2),
    (
      SELECT key FROM jsonb_each_text(s.return_reasons) AS r(key, val)
      WHERE val::numeric > 0
      ORDER BY val::numeric DESC LIMIT 1
    ),
    s.snapshot_date,
    'processed'
  FROM public.product_performance_snapshots s
  WHERE s.merchant_code = p_merchant_code
    AND NOT EXISTS (select 1 from public.returns r where r.merchant_code=s.merchant_code and r.marketplace_account_id=s.marketplace_account_id and r.order_id='SNAP-'||s.id::text and r.derived_source is null)
    AND s.returned > 0
  ON CONFLICT (merchant_code,marketplace_account_id,derived_source,order_id) WHERE derived_source IS NOT NULL
  DO UPDATE SET quantity=excluded.quantity,return_amount=excluded.return_amount,reason=excluded.reason;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;


create or replace function security.derive_product_platform_prices(p_merchant_code text)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  insert into public.product_platform_prices(product_id,merchant_code,platform,marketplace_account_id,selling_price,commission_rate,is_active)
  select distinct on (p.id,i.marketplace_account_id) p.id,p.merchant_code,i.platform,i.marketplace_account_id,
    coalesce(p.sale_price,p.msrp,p.target_net_price,0),coalesce(c.commission_rate,0),i.is_active
  from public.inventory i
  join public.product_channel_mappings m on m.merchant_code=i.merchant_code and m.marketplace_account_id=i.marketplace_account_id
    and m.match_status='linked' and (m.identifier_value=i.sku or m.source_sku=i.sku)
  join public.products p on p.id=m.product_id and p.merchant_code=m.merchant_code
  left join public.platform_fee_categories c on c.platform=i.platform and c.category_key=security.platform_fee_category(i.platform,p.category)
  where i.merchant_code=p_merchant_code
  order by p.id,i.marketplace_account_id,i.id
  on conflict (product_id,platform,marketplace_account_id) do nothing;
  get diagnostics n=row_count;
  return n;
end $$;

CREATE OR REPLACE FUNCTION security.commit_merchant_file_import(p_upload_id uuid, p_payloads jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Amazon API is authoritative after this workspace connects.
  -- Inspect payloads too, so a client cannot relabel an Amazon file as Noon.
  if exists (
    select 1 from public.platform_credentials
    where merchant_code = v_upload.merchant_code
      and platform = 'amazon' and is_active = true
  ) and (
    v_upload.platform = 'amazon'
    or exists (
      select 1 from jsonb_array_elements(p_payloads) payload
      where payload ->> 'table' = 'amazon_daily_sales'
        or exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(payload -> 'rows') = 'array'
              then payload -> 'rows' else '[]'::jsonb end
          ) source_row
          where source_row ->> 'platform' = 'amazon'
        )
    )
  ) then
    raise exception using errcode = '55000',
      message = 'Amazon file imports are disabled while the direct connection is active';
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
       and shipment.marketplace_account_id = v_upload.marketplace_account_id
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
$function$;


create unique index inbound_shipments_account_id_key on public.inbound_shipments(merchant_code,marketplace_account_id,id);
alter table public.inbound_shipment_items add constraint shipment_item_account_fk
  foreign key (merchant_code,marketplace_account_id,shipment_id) references public.inbound_shipments(merchant_code,marketplace_account_id,id);

revoke all on function security.derive_orders_from_account_tx(text) from public,anon,authenticated;
grant execute on function security.derive_orders_from_account_tx(text) to service_role;
revoke all on function security.derive_returns_from_account_tx(text) from public,anon,authenticated;
grant execute on function security.derive_returns_from_account_tx(text) to service_role;
revoke all on function security.derive_returns_from_snapshots(text) from public,anon,authenticated;
grant execute on function security.derive_returns_from_snapshots(text) to service_role;
revoke all on function security.derive_product_platform_prices(text) from public,anon,authenticated;
grant execute on function security.derive_product_platform_prices(text) to service_role;