-- DRAFT: preserve three production validation guards and repair two fallback labels.
-- Scoped catalog source passed credential/network/settings preflight.
-- No financial formulas, actor checks, signatures, function options or grants change.
-- Abort if either reviewed source version no longer matches the target.
DO $analytics_compat$
DECLARE object_oid oid;
BEGIN
  object_oid := to_regprocedure('public.merchant_health_score(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('4756fbbf9af85b758d608995c6bdd85f', 'fd5def43ee5918e71a626137f189bb93') THEN
    RAISE EXCEPTION 'Unexpected definition for public.merchant_health_score; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION public.merchant_health_score(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
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
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
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
    (select security.latest_platform_sync_at(p_merchant_code))
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
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('public.revenue_forecast(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('657e01d64fb9785f70b7e997a05c04cc', 'a44ca5b9208e9378093d352eae66305a') THEN
    RAISE EXCEPTION 'Unexpected definition for public.revenue_forecast; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION public.revenue_forecast(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
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
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
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
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('security.merchant_executive_brief_base(text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('2286d4081ed826cc61dfeaafd2827f50', '59952ef2c5a4a85c6a401a5a9b29f92b') THEN
    RAISE EXCEPTION 'Unexpected definition for security.merchant_executive_brief_base; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION security.merchant_executive_brief_base(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'security'
AS $function$
declare
  v_owner_code text := public.current_merchant_code();
  v_anchor_date date;
  v_period_start date;
  v_previous_start date;
  v_data_age_days integer;

  v_sales numeric := 0;
  v_previous_sales numeric := 0;
  v_orders integer := 0;
  v_previous_orders integer := 0;
  v_units numeric := 0;
  v_fees numeric := 0;
  v_shipping numeric := 0;
  v_discounts numeric := 0;
  v_contribution numeric := 0;
  v_previous_contribution numeric := 0;
  v_cancelled_or_returned integer := 0;
  v_previous_cancelled_or_returned integer := 0;
  v_all_orders integer := 0;
  v_previous_all_orders integer := 0;
  v_sales_change_pct numeric;
  v_contribution_change_pct numeric;
  v_exception_rate numeric;
  v_previous_exception_rate numeric;
  v_return_claims integer := 0;
  v_return_claims_amount numeric := 0;

  v_inventory_items integer := 0;
  v_inventory_fresh_items integer := 0;
  v_inventory_costed_items integer := 0;
  v_stockout_skus integer := 0;
  v_stockout_demand_value numeric := 0;
  v_slow_stock_value numeric := 0;
  v_unanalysed_stock_value numeric := 0;
  v_inventory_cost_coverage_pct numeric := 0;

  v_sold_products integer := 0;
  v_costed_products integer := 0;
  v_product_cost_coverage_pct numeric := 0;
  v_net_profit numeric;
  v_net_margin_pct numeric;

  v_cash_month date;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_cash_net numeric := 0;

  v_evidence_coverage numeric := 0;
  v_confidence text := 'low';
  v_priority_key text := 'connect_sources';
  v_priority_title text := 'اربط مصدر الطلبات لبدء الملخص التنفيذي';
  v_priority_detail text := 'لا توجد طلبات يمكن بناء قرارات أسبوعية موثوقة عليها.';
  v_priority_path text := '/integrations';
  v_priority_level text := 'high';
  v_priority_category text := 'data_quality';
begin
  if auth.uid() is null and current_user <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_merchant_code), '') is null then
    raise exception 'MERCHANT_CODE_REQUIRED' using errcode = '22023';
  end if;
  if auth.uid() is not null
     and not security.can_access_merchant(p_merchant_code) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select max(order_date)::date
    into v_anchor_date
  from public.orders
  where merchant_code = p_merchant_code;

  if v_anchor_date is not null then
    v_period_start := v_anchor_date - 6;
    v_previous_start := v_anchor_date - 13;
    v_data_age_days := greatest(0, current_date - v_anchor_date);

    select
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(quantity) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(platform_fee) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(shipping_cost) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(discount_amount) filter (where status not in ('cancelled', 'returned')), 0),
      coalesce(sum(total_amount - coalesce(platform_fee, 0) - coalesce(shipping_cost, 0) - coalesce(discount_amount, 0))
        filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status in ('cancelled', 'returned'))::integer,
      count(distinct order_id)::integer
    into v_sales, v_orders, v_units, v_fees, v_shipping, v_discounts,
         v_contribution, v_cancelled_or_returned, v_all_orders
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_period_start and v_anchor_date;

    select
      coalesce(sum(total_amount) filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status not in ('cancelled', 'returned'))::integer,
      coalesce(sum(total_amount - coalesce(platform_fee, 0) - coalesce(shipping_cost, 0) - coalesce(discount_amount, 0))
        filter (where status not in ('cancelled', 'returned')), 0),
      count(distinct order_id) filter (where status in ('cancelled', 'returned'))::integer,
      count(distinct order_id)::integer
    into v_previous_sales, v_previous_orders, v_previous_contribution,
         v_previous_cancelled_or_returned, v_previous_all_orders
    from public.orders
    where merchant_code = p_merchant_code
      and order_date::date between v_previous_start and v_period_start - 1;

    v_sales_change_pct := case when v_previous_sales > 0
      then round((v_sales - v_previous_sales) / v_previous_sales * 100, 1) end;
    v_contribution_change_pct := case when v_previous_contribution > 0
      then round((v_contribution - v_previous_contribution) / v_previous_contribution * 100, 1) end;
    v_exception_rate := case when v_all_orders > 0
      then round(v_cancelled_or_returned::numeric / v_all_orders * 100, 1) end;
    v_previous_exception_rate := case when v_previous_all_orders > 0
      then round(v_previous_cancelled_or_returned::numeric / v_previous_all_orders * 100, 1) end;

    select count(*)::integer, coalesce(sum(return_amount), 0)
      into v_return_claims, v_return_claims_amount
    from public.returns
    where merchant_code = p_merchant_code
      and return_date between v_period_start and v_anchor_date;
  end if;

  select
    count(*)::integer,
    count(*) filter (where data_age_days between 0 and 2)::integer,
    count(*) filter (where data_age_days between 0 and 2 and cost_price > 0)::integer,
    count(*) filter (where data_age_days between 0 and 2 and health_status = 'out_of_stock' and daily_velocity > 0)::integer,
    coalesce(sum(daily_velocity * 30 * selling_price)
      filter (where data_age_days between 0 and 2 and health_status = 'out_of_stock' and daily_velocity > 0 and selling_price > 0), 0),
    coalesce(sum(stock_value_cost)
      filter (where data_age_days between 0 and 2 and health_status = 'slow_mover' and stock_value_cost > 0), 0),
    coalesce(sum(stock_value_cost)
      filter (where data_age_days between 0 and 2 and health_status = 'no_sales_data' and stock_value_cost > 0), 0)
  into v_inventory_items, v_inventory_fresh_items, v_inventory_costed_items,
       v_stockout_skus, v_stockout_demand_value, v_slow_stock_value,
       v_unanalysed_stock_value
  from public.inventory_health
  where merchant_code = p_merchant_code;

  v_inventory_cost_coverage_pct := case when v_inventory_fresh_items > 0
    then round(v_inventory_costed_items::numeric / v_inventory_fresh_items * 100, 1)
    else 0 end;

  select
    count(*) filter (where units_sold > 0)::integer,
    count(*) filter (where units_sold > 0 and cost_price > 0)::integer,
    sum(net_profit) filter (where units_sold > 0 and cost_price > 0),
    case when sum(revenue) filter (where units_sold > 0 and cost_price > 0) > 0
      then round(sum(net_profit) filter (where units_sold > 0 and cost_price > 0)
        / sum(revenue) filter (where units_sold > 0 and cost_price > 0) * 100, 1) end
  into v_sold_products, v_costed_products, v_net_profit, v_net_margin_pct
  from public.product_profitability
  where merchant_code = p_merchant_code;

  v_product_cost_coverage_pct := case when v_sold_products > 0
    then round(v_costed_products::numeric / v_sold_products * 100, 1)
    else 0 end;
  if v_product_cost_coverage_pct < 80 then
    v_net_profit := null;
    v_net_margin_pct := null;
  end if;

  select max(month) into v_cash_month
  from public.monthly_cashflow
  where merchant_code = p_merchant_code;

  if v_cash_month is not null then
    select coalesce(sum(cash_in), 0), coalesce(sum(cash_out), 0), coalesce(sum(net), 0)
      into v_cash_in, v_cash_out, v_cash_net
    from public.monthly_cashflow
    where merchant_code = p_merchant_code and month = v_cash_month;
  end if;

  v_evidence_coverage :=
    (case when v_anchor_date is not null then 35 else 0 end)
    + (case when v_inventory_fresh_items > 0 then 25 else 0 end)
    + (case when v_cash_month is not null then 20 else 0 end)
    + (case when v_product_cost_coverage_pct >= 80 then 20 else 0 end);
  v_confidence := case
    when v_evidence_coverage >= 80 and coalesce(v_data_age_days, 999) <= 2 then 'high'
    when v_evidence_coverage >= 60 and coalesce(v_data_age_days, 999) <= 7 then 'medium'
    else 'low' end;

  if v_anchor_date is null then
    null;
  elsif v_data_age_days > 7 then
    v_priority_key := 'executive_data_stale';
    v_priority_title := 'حدّث بيانات الطلبات قبل اتخاذ قرار أسبوعي';
    v_priority_detail := 'آخر طلب أقدم من 7 أيام، لذلك المقارنة الحالية لا تمثل وضع المتجر الآن.';
    v_priority_path := '/integrations';
    v_priority_level := 'high';
    v_priority_category := 'data_quality';
  elsif v_sold_products > 0 and v_product_cost_coverage_pct < 80 then
    v_priority_key := 'executive_cost_coverage';
    v_priority_title := 'استكمل تكلفة الشراء لاعتماد صافي الربح';
    v_priority_detail := 'التكاليف مكتملة لأقل من 80% من المنتجات المباعة، لذلك أخفى النظام الربح بدل عرض رقم مضلل.';
    v_priority_path := '/products?costs=import';
    v_priority_level := 'urgent';
    v_priority_category := 'profitability';
  elsif coalesce(v_exception_rate, 0) >= 10 then
    v_priority_key := 'executive_order_exceptions';
    v_priority_title := 'راجع ارتفاع الإلغاءات والمرتجعات هذا الأسبوع';
    v_priority_detail := 'تجاوزت الطلبات الملغاة أو المرتجعة 10% من الطلبات المسجلة في الفترة.';
    v_priority_path := '/orders';
    v_priority_level := 'urgent';
    v_priority_category := 'orders';
  elsif v_stockout_skus > 0 then
    v_priority_key := 'executive_stockouts';
    v_priority_title := 'عالج الأصناف النافدة التي لديها طلب سابق';
    v_priority_detail := 'يعرض النظام فقط الأصناف النافدة ذات حركة بيع حديثة وبيانات مخزون محدثة.';
    v_priority_path := '/inventory';
    v_priority_level := 'high';
    v_priority_category := 'inventory';
  elsif v_cash_month is not null and v_cash_net < 0 then
    v_priority_key := 'executive_negative_cashflow';
    v_priority_title := 'راجع صافي التدفق النقدي السلبي';
    v_priority_detail := 'المبالغ الخارجة في آخر شهر مالي متاح تجاوزت المبالغ الداخلة.';
    v_priority_path := '/statement';
    v_priority_level := 'high';
    v_priority_category := 'cashflow';
  elsif coalesce(v_sales_change_pct, 0) <= -15 then
    v_priority_key := 'executive_sales_decline';
    v_priority_title := 'حلّل تراجع المبيعات الأسبوعية';
    v_priority_detail := 'انخفضت المبيعات بأكثر من 15% مقارنة بالأسبوع السابق ضمن آخر بيانات متاحة.';
    v_priority_path := '/orders';
    v_priority_level := 'high';
    v_priority_category := 'demand';
  else
    v_priority_key := 'executive_no_urgent_action';
    v_priority_title := 'لا توجد إشارة تشغيلية عاجلة هذا الأسبوع';
    v_priority_detail := 'استمر في تحديث الطلبات والمخزون والتكاليف للحفاظ على دقة المتابعة.';
    v_priority_path := '/actions';
    v_priority_level := 'medium';
    v_priority_category := 'operations';
  end if;

  return jsonb_build_object(
    'available', v_anchor_date is not null,
    'confidence', v_confidence,
    'evidence_coverage_pct', v_evidence_coverage,
    'data_as_of', v_anchor_date,
    'data_age_days', v_data_age_days,
    'period', jsonb_build_object(
      'start', v_period_start, 'end', v_anchor_date,
      'previous_start', v_previous_start,
      'previous_end', case when v_period_start is null then null else v_period_start - 1 end
    ),
    'week', jsonb_build_object(
      'sales', round(v_sales, 2), 'previous_sales', round(v_previous_sales, 2),
      'sales_change_pct', v_sales_change_pct,
      'orders', v_orders, 'previous_orders', v_previous_orders,
      'units', v_units,
      'average_order_value', case when v_orders > 0 then round(v_sales / v_orders, 2) else 0 end,
      'contribution_before_product_cost', round(v_contribution, 2),
      'previous_contribution_before_product_cost', round(v_previous_contribution, 2),
      'contribution_change_pct', v_contribution_change_pct,
      'cancelled_or_returned_orders', v_cancelled_or_returned,
      'exception_rate_pct', v_exception_rate,
      'previous_exception_rate_pct', v_previous_exception_rate
    ),
    'confirmed_deductions', jsonb_build_object(
      'platform_fees', round(v_fees, 2),
      'shipping', round(v_shipping, 2),
      'discounts', round(v_discounts, 2),
      'return_claims_count', v_return_claims,
      'return_claims_amount', round(v_return_claims_amount, 2),
      'total_excluding_returns', round(v_fees + v_shipping + v_discounts, 2)
    ),
    'inventory_risk', jsonb_build_object(
      'available', v_inventory_fresh_items > 0,
      'items', v_inventory_items,
      'fresh_items', v_inventory_fresh_items,
      'cost_coverage_pct', v_inventory_cost_coverage_pct,
      'stockout_skus', v_stockout_skus,
      'stockout_historical_30d_demand_value', round(v_stockout_demand_value, 2),
      'slow_stock_value', round(v_slow_stock_value, 2),
      'unanalysed_stock_value', round(v_unanalysed_stock_value, 2)
    ),
    'profitability', jsonb_build_object(
      'available', v_product_cost_coverage_pct >= 80 and v_sold_products > 0,
      'sold_products', v_sold_products,
      'costed_products', v_costed_products,
      'cost_coverage_pct', v_product_cost_coverage_pct,
      'net_profit', v_net_profit,
      'net_margin_pct', v_net_margin_pct,
      'minimum_coverage_pct', 80
    ),
    'cash', jsonb_build_object(
      'available', v_cash_month is not null,
      'month', v_cash_month,
      'cash_in', round(v_cash_in, 2),
      'cash_out', round(v_cash_out, 2),
      'net', round(v_cash_net, 2)
    ),
    'top_priority', jsonb_build_object(
      'source_key', v_priority_key,
      'title', v_priority_title,
      'detail', v_priority_detail,
      'path', v_priority_path,
      'priority', v_priority_level,
      'category', v_priority_category,
      'actionable', v_priority_key <> 'executive_no_urgent_action'
    )
  );
end;
$function$;$reviewed_sql$;

  object_oid := to_regprocedure('security.admin_ad_performance(text, uuid, text, text, text)');
  IF object_oid IS NULL OR md5(pg_get_functiondef(object_oid)) NOT IN ('c247d9b553d1bc71209f0d90930ef2db', 'bc9571c936e8c0a85016b510ec608592') THEN
    RAISE EXCEPTION 'Unexpected definition for security.admin_ad_performance; review required';
  END IF;
  EXECUTE $reviewed_sql$CREATE OR REPLACE FUNCTION security.admin_ad_performance(p_merchant_code text, p_upload_id uuid DEFAULT NULL::uuid, p_platform text DEFAULT NULL::text, p_group_by text DEFAULT 'campaign'::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT security.has_platform_permission('manage_ads') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE merchant_code = p_merchant_code AND role = 'merchant') THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;
  IF p_group_by NOT IN ('campaign', 'sku', 'query') THEN
    RAISE EXCEPTION 'invalid advertising group' USING errcode = '22023';
  END IF;

  WITH filtered AS (
    SELECT am.* FROM public.ad_metrics am
    WHERE am.merchant_code = p_merchant_code
      AND (p_upload_id IS NULL OR am.upload_id = p_upload_id)
      AND (p_platform IS NULL OR am.platform = p_platform)
      AND (
        NULLIF(btrim(p_search), '') IS NULL
        OR coalesce(am.campaign_name, '') ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(am.sku, '') ILIKE '%' || btrim(p_search) || '%'
        OR coalesce(am.search_query, '') ILIKE '%' || btrim(p_search) || '%'
      )
  ), totals AS (
    SELECT count(*) rows, coalesce(sum(spend), 0) spend, coalesce(sum(revenue), 0) revenue,
      coalesce(sum(impressions), 0) impressions, coalesce(sum(clicks), 0) clicks,
      coalesce(sum(orders), 0) orders FROM filtered
  ), grouped AS (
    SELECT CASE p_group_by
        WHEN 'campaign' THEN coalesce(nullif(campaign_name, ''), nullif(ad_group_name, ''), 'بلا اسم')
        WHEN 'sku' THEN coalesce(nullif(sku, ''), '—')
        ELSE coalesce(nullif(search_query, ''), '—') END key,
      platform, sum(impressions) impressions, sum(clicks) clicks, sum(orders) orders,
      sum(spend) spend, sum(revenue) revenue, count(*) rows
    FROM filtered GROUP BY 1, platform ORDER BY sum(spend) DESC LIMIT 200
  )
  SELECT jsonb_build_object(
    'totals', (SELECT to_jsonb(totals) FROM totals),
    'groups', coalesce((SELECT jsonb_agg(to_jsonb(grouped)) FROM grouped), '[]'::jsonb),
    'platforms', coalesce((SELECT jsonb_agg(platform ORDER BY platform) FROM (SELECT DISTINCT platform FROM filtered) p), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;$reviewed_sql$;

END
$analytics_compat$;
