-- Tenant-scoped weekly executive brief.
-- Only confirmed deductions are shown; net profit stays unavailable until
-- product-cost coverage is sufficient.

create or replace function public.merchant_executive_brief(p_merchant_code text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, security
as $$
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
  if auth.uid() is not null
     and p_merchant_code is distinct from v_owner_code
     and not security.can_access_all_merchants() then
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
$$;

revoke all on function public.merchant_executive_brief(text) from public, anon;
grant execute on function public.merchant_executive_brief(text) to authenticated, service_role;

comment on function public.merchant_executive_brief(text) is
  'Tenant-scoped weekly operating brief with confirmed deductions, evidence coverage, inventory risk and one ranked action.';
