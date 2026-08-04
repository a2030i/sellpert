-- Generate durable merchant alerts from the same operational evidence shown
-- in the attention centre. The internal function owns the insert privilege;
-- merchants can request a refresh but cannot forge arbitrary notification
-- rows through the Data API.

create or replace function security.generate_merchant_operational_alerts(
  p_merchant_code text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_created integer := 0;
  v_rows integer := 0;
  v_count integer := 0;
  v_is_service_role boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
  rec record;
begin
  if p_merchant_code is null or btrim(p_merchant_code) = '' then
    raise exception using errcode = '22023', message = 'merchant code is required';
  end if;

  if not v_is_service_role then
    if (select auth.uid()) is null
       or not security.has_merchant_permission(p_merchant_code, 'dashboard') then
      raise exception using errcode = '42501', message = 'dashboard permission is required';
    end if;
  end if;

  if not exists (
    select 1 from public.merchants
    where merchant_code = p_merchant_code
      and role = 'merchant'
      and coalesce(is_active, false)
  ) then
    raise exception using errcode = '42501', message = 'merchant workspace is inactive';
  end if;

  -- Inventory at risk. Only fresh velocity evidence may create a purchasing
  -- alert; stale inventory never produces a false recommendation.
  for rec in
    select product_name, sold_30d
    from public.inventory_health
    where merchant_code = p_merchant_code
      and data_age_days between 0 and 2
      and health_status = 'out_of_stock'
      and sold_30d > 0
  loop
    insert into public.notifications (merchant_code, type, title, body, action_path)
    select p_merchant_code, 'warning',
      'نفد مخزون ' || coalesce(rec.product_name, 'منتج'),
      'باع المنتج ' || rec.sold_30d || ' وحدة خلال آخر 30 يومًا. راجع كمية إعادة التوريد.',
      '/inventory'
    where not exists (
      select 1 from public.notifications
      where merchant_code = p_merchant_code
        and title = 'نفد مخزون ' || coalesce(rec.product_name, 'منتج')
        and created_at > now() - interval '24 hours'
    );
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;

  for rec in
    select product_name, days_of_stock
    from public.inventory_health
    where merchant_code = p_merchant_code
      and data_age_days between 0 and 2
      and daily_velocity > 0
      and health_status = 'reorder_soon'
  loop
    insert into public.notifications (merchant_code, type, title, body, action_path)
    select p_merchant_code, 'info',
      'إعادة توريد مطلوبة لـ ' || coalesce(rec.product_name, 'منتج'),
      'التغطية الحالية نحو ' || round(rec.days_of_stock, 1) || ' يوم. راجع التوصية قبل الشراء.',
      '/inventory'
    where not exists (
      select 1 from public.notifications
      where merchant_code = p_merchant_code
        and title = 'إعادة توريد مطلوبة لـ ' || coalesce(rec.product_name, 'منتج')
        and created_at > now() - interval '24 hours'
    );
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;

  -- Profitability is only actionable when product cost exists in the source
  -- view. The view excludes unknown costs from final-profit claims.
  for rec in
    select product_name, profit_margin_pct
    from public.product_profitability
    where merchant_code = p_merchant_code
      and units_sold > 0
      and cost_price > 0
      and net_profit < 0
    order by net_profit asc
    limit 5
  loop
    insert into public.notifications (merchant_code, type, title, body, action_path)
    select p_merchant_code, 'warning',
      'منتج يحقق خسارة: ' || coalesce(rec.product_name, 'منتج'),
      'الهامش ' || round(rec.profit_margin_pct, 1) || '%. راجع السعر والتكلفة والإنفاق الإعلاني.',
      '/products'
    where not exists (
      select 1 from public.notifications
      where merchant_code = p_merchant_code
        and title = 'منتج يحقق خسارة: ' || coalesce(rec.product_name, 'منتج')
        and created_at > now() - interval '24 hours'
    );
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;

  -- Open fulfilment older than 24 hours requires an explicit review. This is
  -- an age warning, not a claim that the marketplace SLA was breached.
  select count(*)::integer into v_count
  from public.order_packages p
  join public.orders o
    on o.merchant_code = p.merchant_code
   and o.platform = p.platform
   and o.order_id = p.order_id
  where p.merchant_code = p_merchant_code
    and regexp_replace(lower(coalesce(p.provider_status, p.status, '')), '[^a-z]', '', 'g')
      in ('created','unpacked','picking','processing','notinvoiced','awaiting')
    and nullif(btrim(coalesce(p.cargo_tracking_number, '')), '') is null
    and o.order_date < now() - interval '24 hours';

  if v_count > 0 then
    insert into public.notifications (merchant_code, type, title, body, action_path)
    select p_merchant_code, 'warning', 'شحنات مفتوحة منذ أكثر من 24 ساعة',
      v_count || ' شحنة ما زالت تنتظر التجهيز أو رقم التتبع. ابدأ بالأقدم وراجع حالتها في منصة البيع.',
      '/orders'
    where not exists (
      select 1 from public.notifications
      where merchant_code = p_merchant_code
        and title = 'شحنات مفتوحة منذ أكثر من 24 ساعة'
        and created_at > now() - interval '6 hours'
    );
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end if;

  select count(*)::integer into v_count
  from public.order_packages
  where merchant_code = p_merchant_code
    and (
      lower(coalesce(invoice_status, '')) like '%reject%'
      or (invoice_rejected_reasons is not null and invoice_rejected_reasons not in ('{}'::jsonb, '[]'::jsonb, 'null'::jsonb))
    );

  if v_count > 0 then
    insert into public.notifications (merchant_code, type, title, body, action_path)
    select p_merchant_code, 'error', 'فواتير شحن تحتاج تصحيحًا',
      v_count || ' شحنة رفضت منصة البيع فاتورتها. افتح الطلب وصحح الفاتورة قبل اكتمال المعالجة.',
      '/orders'
    where not exists (
      select 1 from public.notifications
      where merchant_code = p_merchant_code
        and title = 'فواتير شحن تحتاج تصحيحًا'
        and created_at > now() - interval '6 hours'
    );
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end if;

  select count(*)::integer into v_count
  from public.trendyol_customer_questions
  where merchant_code = p_merchant_code
    and lower(coalesce(status, '')) in ('waiting_for_answer','waiting','unanswered','pending')
    and asked_at < now() - interval '4 hours';

  if v_count > 0 then
    insert into public.notifications (merchant_code, type, title, body, action_path)
    select p_merchant_code, 'warning', 'أسئلة عملاء تنتظر الرد',
      v_count || ' سؤالًا من عملاء Trendyol مضى عليه أكثر من 4 ساعات دون إجابة.',
      '/integrations?panel=trendyol-questions'
    where not exists (
      select 1 from public.notifications
      where merchant_code = p_merchant_code
        and title = 'أسئلة عملاء تنتظر الرد'
        and created_at > now() - interval '4 hours'
    );
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end if;

  -- Alert only on the most recent sync per platform. An old failed attempt is
  -- not actionable after a newer successful refresh.
  for rec in
    select platform, status
    from (
      select distinct on (platform) platform, status, started_at
      from public.sync_logs
      where merchant_code = p_merchant_code
        and started_at > now() - interval '24 hours'
      order by platform, started_at desc
    ) latest
    where lower(coalesce(status, '')) in ('error','failed')
  loop
    insert into public.notifications (merchant_code, type, title, body, action_path)
    select p_merchant_code, 'error',
      'تعذر تحديث ' || case rec.platform when 'trendyol' then 'Trendyol' when 'amazon' then 'Amazon' when 'noon' then 'Noon' when 'salla' then 'سلة' when 'zid' then 'زد' else 'منصة البيع' end,
      'لم تكتمل آخر مزامنة. افتح الربط وراجع الحالة ثم أعد المحاولة.',
      '/integrations'
    where not exists (
      select 1 from public.notifications
      where merchant_code = p_merchant_code
        and title = 'تعذر تحديث ' || case rec.platform when 'trendyol' then 'Trendyol' when 'amazon' then 'Amazon' when 'noon' then 'Noon' when 'salla' then 'سلة' when 'zid' then 'زد' else 'منصة البيع' end
        and created_at > now() - interval '6 hours'
    );
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;

  select count(*)::integer into v_count
  from public.marketplace_action_logs
  where merchant_code = p_merchant_code
    and risk_level <> 'read'
    and status in ('failed','partial')
    and started_at > now() - interval '24 hours';

  if v_count > 0 then
    insert into public.notifications (merchant_code, type, title, body, action_path)
    select p_merchant_code, 'error', 'عمليات منصة تحتاج مراجعة',
      v_count || ' عملية إرسال أو تحديث لم تكتمل خلال آخر 24 ساعة. راجع النتيجة قبل إعادة المحاولة.',
      '/notifications?tab=operations'
    where not exists (
      select 1 from public.notifications
      where merchant_code = p_merchant_code
        and title = 'عمليات منصة تحتاج مراجعة'
        and created_at > now() - interval '4 hours'
    );
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end if;

  return v_created;
end
$$;

create or replace function public.generate_proactive_alerts(p_merchant_code text)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select security.generate_merchant_operational_alerts(p_merchant_code)
$$;

revoke all on function security.generate_merchant_operational_alerts(text) from public, anon, authenticated;
revoke all on function public.generate_proactive_alerts(text) from public, anon;
grant execute on function security.generate_merchant_operational_alerts(text) to service_role;
grant execute on function public.generate_proactive_alerts(text) to authenticated, service_role;

comment on function security.generate_merchant_operational_alerts(text) is
  'Privileged notification writer with explicit tenant and dashboard-permission checks.';
comment on function public.generate_proactive_alerts(text) is
  'Tenant-scoped refresh for durable inventory, profit, fulfilment, customer, sync and delivery alerts.';
