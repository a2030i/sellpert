-- Truthful merchant operating health and bounded sales forecasting.
-- Missing evidence never awards points. Both RPCs enforce the authenticated
-- tenant boundary before aggregating merchant data.

create or replace function public.merchant_health_score(p_merchant_code text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, security
as $$
declare
  v_owner_code text := public.current_merchant_code();
  v_data_as_of timestamptz;
  v_data_age_days integer;
  v_anchor_date date;
  v_orders_30d integer := 0;
  v_orders_prev_30d integer := 0;
  v_active_days integer := 0;
  v_sales_30d numeric := 0;
  v_sales_prev_30d numeric := 0;
  v_growth_pct numeric;
  v_sold_products integer := 0;
  v_costed_products integer := 0;
  v_profitable_products integer := 0;
  v_cost_coverage_pct numeric := 0;
  v_avg_margin_pct numeric;
  v_inventory_total integer := 0;
  v_inventory_fresh integer := 0;
  v_inventory_velocity integer := 0;
  v_inventory_stockouts integer := 0;
  v_inventory_reorder integer := 0;
  v_ad_spend numeric := 0;
  v_ad_net numeric := 0;
  v_net_roas numeric;
  v_readiness_indicators integer := 0;
  v_readiness_total numeric := 0;
  v_readiness_score numeric;
  v_profitability_score numeric;
  v_inventory_score numeric;
  v_demand_score numeric;
  v_marketing_score numeric;
  v_available_weight numeric := 0;
  v_weighted_points numeric := 0;
  v_score numeric;
  v_coverage_pct numeric := 0;
  v_confidence text := 'low';
  v_rating text;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if auth.uid() is not null
     and p_merchant_code is distinct from v_owner_code
     and not security.can_access_all_merchants() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date
    into v_anchor_date
  from public.orders
  where merchant_code = p_merchant_code;

  v_data_as_of := greatest(
    (select max(created_at) from public.orders where merchant_code = p_merchant_code),
    (select max(last_updated) from public.inventory where merchant_code = p_merchant_code),
    (select max(uploaded_at) from public.platform_file_uploads where merchant_code = p_merchant_code),
    (select max(last_sync_at) from public.platform_credentials where merchant_code = p_merchant_code)
  );
  v_data_age_days := case when v_data_as_of is null then null
    else greatest(0, current_date - v_data_as_of::date) end;

  if v_anchor_date is not null then
    select
      count(*) filter (where status not in ('cancelled', 'returned'))::integer,
      count(distinct order_date::date) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0)
    into v_orders_30d, v_active_days, v_sales_30d
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_anchor_date - 29 and v_anchor_date;

    select
      count(*) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0)
    into v_orders_prev_30d, v_sales_prev_30d
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_anchor_date - 59 and v_anchor_date - 30;

    v_growth_pct := case when v_sales_prev_30d > 0
      then round(((v_sales_30d - v_sales_prev_30d) / v_sales_prev_30d) * 100, 1)
      else null end;
  end if;

  select
    count(*) filter (where units_sold > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0 and net_profit > 0)::integer,
    avg(profit_margin_pct) filter (where units_sold > 0 and cost_price > 0)
  into v_sold_products, v_costed_products, v_profitable_products, v_avg_margin_pct
  from public.product_profitability
  where merchant_code = p_merchant_code;

  v_cost_coverage_pct := case when v_sold_products > 0
    then round(v_costed_products::numeric / v_sold_products * 100, 1)
    else 0 end;

  select
    count(*)::integer,
    count(*) filter (where data_age_days between 0 and 2)::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0)::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0 and health_status = 'out_of_stock')::integer,
    count(*) filter (where data_age_days between 0 and 2 and daily_velocity > 0 and health_status = 'reorder_soon')::integer
  into v_inventory_total, v_inventory_fresh, v_inventory_velocity, v_inventory_stockouts, v_inventory_reorder
  from public.inventory_health
  where merchant_code = p_merchant_code;

  select coalesce(sum(total_spend), 0), coalesce(sum(total_net), 0)
    into v_ad_spend, v_ad_net
  from public.ad_net_summary
  where merchant_code = p_merchant_code;
  v_net_roas := case when v_ad_spend > 0 then v_ad_net / v_ad_spend else null end;

  -- Readiness (25%): only score evidence that actually exists.
  if v_sold_products > 0 then
    v_readiness_indicators := v_readiness_indicators + 1;
    v_readiness_total := v_readiness_total + v_cost_coverage_pct;
  end if;
  if v_data_as_of is not null then
    v_readiness_indicators := v_readiness_indicators + 1;
    v_readiness_total := v_readiness_total + case
      when v_data_age_days <= 2 then 100
      when v_data_age_days <= 7 then 70
      when v_data_age_days <= 14 then 40
      else 10 end;
  end if;
  if v_readiness_indicators > 0 then
    v_readiness_score := round(v_readiness_total / v_readiness_indicators, 1);
    v_available_weight := v_available_weight + 25;
    v_weighted_points := v_weighted_points + v_readiness_score * 0.25;
  end if;

  -- Profitability (25%): unavailable until at least 80% of sold products have cost.
  if v_costed_products > 0 and v_cost_coverage_pct >= 80 then
    v_profitability_score := round(least(100, greatest(0,
      (v_profitable_products::numeric / v_costed_products * 70)
      + (least(30, greatest(-10, coalesce(v_avg_margin_pct, -10))) + 10) / 40 * 30
    )), 1);
    v_available_weight := v_available_weight + 25;
    v_weighted_points := v_weighted_points + v_profitability_score * 0.25;
  end if;

  -- Inventory (20%): stale or velocity-free inventory is not scored.
  if v_inventory_velocity > 0 then
    v_inventory_score := round(least(100, greatest(0,
      100
      - (v_inventory_stockouts::numeric / v_inventory_velocity * 70)
      - (v_inventory_reorder::numeric / v_inventory_velocity * 30)
    )), 1);
    v_available_weight := v_available_weight + 20;
    v_weighted_points := v_weighted_points + v_inventory_score * 0.20;
  end if;

  -- Demand (15%): combine continuity with bounded period growth.
  if v_orders_30d > 0 then
    v_demand_score := round(least(100, greatest(0,
      (least(100, v_active_days::numeric / 30 * 100) * 0.45)
      + (case when v_growth_pct is null then 45
              else least(100, greatest(0, 50 + least(50, greatest(-50, v_growth_pct)))) end * 0.55)
    )), 1);
    v_available_weight := v_available_weight + 15;
    v_weighted_points := v_weighted_points + v_demand_score * 0.15;
  end if;

  -- Marketing (15%): no advertising data means unavailable, never free points.
  if v_ad_spend > 0 then
    v_marketing_score := case
      when v_net_roas < 1 then 10
      when v_net_roas < 2 then 40
      when v_net_roas < 3 then 65
      when v_net_roas < 5 then 85
      else 100 end;
    v_available_weight := v_available_weight + 15;
    v_weighted_points := v_weighted_points + v_marketing_score * 0.15;
  end if;

  v_coverage_pct := v_available_weight;
  v_score := case when v_available_weight >= 60
    then round(v_weighted_points / v_available_weight * 100, 0)
    else null end;
  v_confidence := case
    when v_coverage_pct >= 80 and coalesce(v_data_age_days, 999) <= 2 then 'high'
    when v_coverage_pct >= 60 and coalesce(v_data_age_days, 999) <= 7 then 'medium'
    else 'low' end;
  v_rating := case
    when v_score is null then 'insufficient'
    when v_score >= 80 then 'excellent'
    when v_score >= 65 then 'good'
    when v_score >= 45 then 'watch'
    else 'critical' end;

  return jsonb_build_object(
    'score', v_score,
    'rating', v_rating,
    'confidence', v_confidence,
    'coverage_pct', v_coverage_pct,
    'data_as_of', v_data_as_of,
    'data_age_days', v_data_age_days,
    'breakdown', jsonb_build_object(
      'readiness', jsonb_build_object('available', v_readiness_score is not null, 'score', v_readiness_score, 'weight', 25, 'cost_coverage_pct', v_cost_coverage_pct, 'data_age_days', v_data_age_days),
      'profitability', jsonb_build_object('available', v_profitability_score is not null, 'score', v_profitability_score, 'weight', 25, 'sold_products', v_sold_products, 'costed_products', v_costed_products, 'profitable_products', v_profitable_products, 'avg_margin_pct', round(coalesce(v_avg_margin_pct, 0), 1)),
      'inventory', jsonb_build_object('available', v_inventory_score is not null, 'score', v_inventory_score, 'weight', 20, 'total_items', v_inventory_total, 'fresh_items', v_inventory_fresh, 'velocity_items', v_inventory_velocity, 'stockouts', v_inventory_stockouts, 'reorder_soon', v_inventory_reorder),
      'demand', jsonb_build_object('available', v_demand_score is not null, 'score', v_demand_score, 'weight', 15, 'orders_30d', v_orders_30d, 'active_days', v_active_days, 'sales_30d', v_sales_30d, 'growth_pct', v_growth_pct),
      'marketing', jsonb_build_object('available', v_marketing_score is not null, 'score', v_marketing_score, 'weight', 15, 'spend', v_ad_spend, 'net_revenue', v_ad_net, 'net_roas', round(coalesce(v_net_roas, 0), 2))
    )
  );
end;
$$;

create or replace function public.revenue_forecast(p_merchant_code text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, security
as $$
declare
  v_owner_code text := public.current_merchant_code();
  v_anchor_date date;
  v_first_date date;
  v_observed_days integer := 0;
  v_active_days integer := 0;
  v_data_age_days integer;
  v_last_30_sales numeric := 0;
  v_prev_30_sales numeric := 0;
  v_avg_daily numeric := 0;
  v_stddev numeric := 0;
  v_cv numeric := 0;
  v_growth_pct numeric;
  v_bounded_growth numeric := 0;
  v_forecast_30 numeric := 0;
  v_uncertainty_pct numeric := 0.45;
  v_lower_30 numeric := 0;
  v_upper_30 numeric := 0;
  v_confidence text := 'low';
  v_caveat text;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if auth.uid() is not null
     and p_merchant_code is distinct from v_owner_code
     and not security.can_access_all_merchants() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date, min(order_date)::date
    into v_anchor_date, v_first_date
  from public.orders
  where merchant_code = p_merchant_code
    and status not in ('cancelled', 'returned');

  if v_anchor_date is null then
    return jsonb_build_object(
      'last_30_sales', 0, 'prev_30_sales', 0, 'avg_daily', 0,
      'forecast_30', 0, 'forecast_60', 0, 'forecast_90', 0,
      'lower_30', 0, 'upper_30', 0, 'growth_rate_pct', null,
      'confidence', 'low', 'is_actionable', false, 'observed_days', 0,
      'active_days', 0, 'data_as_of', null, 'data_age_days', null,
      'method', 'bounded_recent_run_rate',
      'caveat', 'لا توجد طلبات كافية لبناء توقع.'
    );
  end if;

  v_data_age_days := greatest(0, current_date - v_anchor_date);
  v_observed_days := least(30, greatest(1, v_anchor_date - v_first_date + 1));

  with calendar as (
    select day::date
    from generate_series(v_anchor_date - (v_observed_days - 1), v_anchor_date, interval '1 day') day
  ), daily as (
    select c.day, coalesce(sum(o.total_amount), 0)::numeric as sales
    from calendar c
    left join public.orders o
      on o.merchant_code = p_merchant_code
     and o.order_date::date = c.day
     and o.status not in ('cancelled', 'returned')
    group by c.day
  )
  select coalesce(sum(sales), 0), count(*) filter (where sales > 0)::integer,
         coalesce(avg(sales), 0), coalesce(stddev_pop(sales), 0)
    into v_last_30_sales, v_active_days, v_avg_daily, v_stddev
  from daily;

  select coalesce(sum(total_amount), 0)
    into v_prev_30_sales
  from public.orders
  where merchant_code = p_merchant_code
    and status not in ('cancelled', 'returned')
    and order_date::date between v_anchor_date - 59 and v_anchor_date - 30;

  v_growth_pct := case when v_prev_30_sales > 0
    then round(((v_last_30_sales - v_prev_30_sales) / v_prev_30_sales) * 100, 1)
    else null end;
  v_bounded_growth := least(50, greatest(-30, coalesce(v_growth_pct, 0)));
  v_cv := case when v_avg_daily > 0 then v_stddev / v_avg_daily else 0 end;

  v_confidence := case
    when (v_anchor_date - v_first_date + 1) >= 60 and v_active_days >= 20 and v_data_age_days <= 2 then 'high'
    when (v_anchor_date - v_first_date + 1) >= 30 and v_active_days >= 10 and v_data_age_days <= 7 then 'medium'
    else 'low' end;

  v_uncertainty_pct := case v_confidence
    when 'high' then greatest(0.15, least(0.30, v_cv * 0.35))
    when 'medium' then greatest(0.25, least(0.40, v_cv * 0.45))
    else 0.45 end;
  v_forecast_30 := round(greatest(0, v_avg_daily * 30 * (1 + v_bounded_growth / 200)), 2);
  v_lower_30 := round(greatest(0, v_forecast_30 * (1 - v_uncertainty_pct)), 2);
  v_upper_30 := round(v_forecast_30 * (1 + v_uncertainty_pct), 2);
  v_caveat := case
    when v_data_age_days > 7 then 'البيانات متأخرة؛ حدّث مصدر الطلبات قبل الاعتماد على التوقع.'
    when v_observed_days < 30 then 'السجل أقصر من 30 يومًا؛ سيضيق النطاق مع تراكم البيانات.'
    when v_active_days < 10 then 'أيام البيع الفعلية قليلة؛ التوقع استرشادي فقط.'
    else 'النطاق يعكس تذبذب المبيعات وحداثة البيانات، ولا يمثل ضمانًا.' end;

  return jsonb_build_object(
    'last_30_sales', round(v_last_30_sales, 2),
    'prev_30_sales', round(v_prev_30_sales, 2),
    'avg_daily', round(v_avg_daily, 2),
    'forecast_30', v_forecast_30,
    'forecast_60', round(v_forecast_30 * 2, 2),
    'forecast_90', round(v_forecast_30 * 3, 2),
    'lower_30', v_lower_30,
    'upper_30', v_upper_30,
    'growth_rate_pct', v_growth_pct,
    'confidence', v_confidence,
    'is_actionable', v_confidence in ('high', 'medium') and v_forecast_30 > 0,
    'observed_days', v_observed_days,
    'active_days', v_active_days,
    'data_as_of', v_anchor_date,
    'data_age_days', v_data_age_days,
    'method', 'bounded_recent_run_rate',
    'caveat', v_caveat
  );
end;
$$;

revoke all on function public.merchant_health_score(text) from public, anon;
revoke all on function public.revenue_forecast(text) from public, anon;
grant execute on function public.merchant_health_score(text) to authenticated, service_role;
grant execute on function public.revenue_forecast(text) to authenticated, service_role;

comment on function public.merchant_health_score(text) is
  'Tenant-scoped operating health. Missing evidence is unavailable and never awards points.';
comment on function public.revenue_forecast(text) is
  'Tenant-scoped bounded 30-day sales forecast with explicit confidence and caveats.';

-- Formal, tenant-scoped alerts. Count only rows actually inserted.
create or replace function public.generate_proactive_alerts(p_merchant_code text)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public, security
as $$
declare
  v_owner_code text := public.current_merchant_code();
  v_created integer := 0;
  v_rows integer := 0;
  rec record;
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if auth.uid() is not null
     and p_merchant_code is distinct from v_owner_code
     and not security.can_access_all_merchants() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  for rec in
    select product_name, sold_30d
    from public.inventory_health
    where merchant_code = p_merchant_code
      and data_age_days between 0 and 2
      and health_status = 'out_of_stock' and sold_30d > 0
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

  for rec in
    select product_name, profit_margin_pct, net_profit
    from public.product_profitability
    where merchant_code = p_merchant_code
      and units_sold > 0 and cost_price > 0 and net_profit < 0
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

  return v_created;
end;
$$;

revoke all on function public.generate_proactive_alerts(text) from public, anon;
grant execute on function public.generate_proactive_alerts(text) to authenticated, service_role;

comment on function public.generate_proactive_alerts(text) is
  'Creates formal tenant-scoped operational alerts and returns only the number actually inserted.';
