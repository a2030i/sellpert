-- Keep the public financial API aligned with the merchant-facing statement.
-- A platform summary may contain sales for which detailed orders have not yet
-- been imported. In that state known product costs must never be extrapolated
-- to all sales or returned as a complete net profit.
CREATE OR REPLACE FUNCTION public.pnl_statement(
  p_merchant_code text,
  p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_start date;
  v_end date;
  v_revenue numeric := 0;
  v_fees numeric := 0;
  v_ad_spend numeric := 0;
  v_returns numeric := 0;
  v_reported_activity integer := 0;
  v_detailed_revenue numeric := 0;
  v_detailed_orders integer := 0;
  v_known_cogs numeric := 0;
  v_costed_units numeric := 0;
  v_missing_cost_units numeric := 0;
  v_detail_coverage numeric := 0;
  v_cost_coverage numeric := 0;
  v_sales_details_complete boolean := false;
  v_product_costs_complete boolean := false;
  v_profit_complete boolean := false;
  v_net_before_product_cost numeric := 0;
  v_provisional_net numeric := 0;
  v_net_income numeric;
  v_source text;
BEGIN
  IF p_merchant_code IS NULL OR btrim(p_merchant_code) = '' THEN
    RAISE EXCEPTION 'merchant_code is required' USING ERRCODE = '22023';
  END IF;

  IF p_year IS NULL OR p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'valid year and month are required' USING ERRCODE = '22023';
  END IF;

  IF (SELECT auth.uid()) IS NOT NULL THEN
    IF NOT security.can_access_merchant(p_merchant_code)
       OR NOT (
         security.has_platform_permission('view_finance')
         OR security.current_has_merchant_permission('statement')
       ) THEN
      RAISE EXCEPTION 'financial statement access denied' USING ERRCODE = '42501';
    END IF;
  ELSIF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;

  SELECT
    COALESCE(sum(performance.total_sales), 0),
    COALESCE(sum(performance.platform_fees), 0),
    COALESCE(sum(performance.ad_spend), 0),
    COALESCE(sum(performance.order_count), 0)::integer
  INTO v_revenue, v_fees, v_ad_spend, v_reported_activity
  FROM public.performance_data performance
  WHERE performance.merchant_code = p_merchant_code
    AND performance.data_date BETWEEN v_start AND v_end;

  SELECT
    COALESCE(sum(order_row.total_amount), 0),
    count(DISTINCT order_row.order_id)::integer
  INTO v_detailed_revenue, v_detailed_orders
  FROM public.orders order_row
  WHERE order_row.merchant_code = p_merchant_code
    AND order_row.order_date >= v_start::timestamptz
    AND order_row.order_date < (v_end + 1)::timestamptz
    AND order_row.status <> 'cancelled';

  WITH active_orders AS (
    SELECT order_row.*
    FROM public.orders order_row
    WHERE order_row.merchant_code = p_merchant_code
      AND order_row.order_date >= v_start::timestamptz
      AND order_row.order_date < (v_end + 1)::timestamptz
      AND order_row.status NOT IN ('cancelled', 'returned')
  ), costed_orders AS (
    SELECT
      active.quantity,
      product_cost.cost_price
    FROM active_orders active
    LEFT JOIN LATERAL (
      SELECT product.cost_price
      FROM public.products product
      WHERE product.merchant_code = active.merchant_code
        AND active.sku IS NOT NULL
        AND lower(product.sku) = lower(active.sku)
      ORDER BY CASE WHEN product.sku = active.sku THEN 0 ELSE 1 END,
               product.updated_at DESC NULLS LAST,
               product.id
      LIMIT 1
    ) product_cost ON true
  )
  SELECT
    COALESCE(sum(CASE WHEN COALESCE(cost_price, 0) > 0 THEN quantity * cost_price ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN COALESCE(cost_price, 0) > 0 THEN quantity ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN COALESCE(cost_price, 0) <= 0 THEN quantity ELSE 0 END), 0)
  INTO v_known_cogs, v_costed_units, v_missing_cost_units
  FROM costed_orders;

  SELECT COALESCE(sum(return_row.return_amount), 0)
  INTO v_returns
  FROM public.returns return_row
  WHERE return_row.merchant_code = p_merchant_code
    AND return_row.return_date BETWEEN v_start AND v_end;

  v_detail_coverage := CASE
    WHEN v_revenue > 0 THEN LEAST(100, v_detailed_revenue / v_revenue * 100)
    WHEN v_detailed_orders > 0 THEN 100
    ELSE 0
  END;
  v_cost_coverage := CASE
    WHEN v_costed_units + v_missing_cost_units > 0
      THEN v_costed_units / (v_costed_units + v_missing_cost_units) * 100
    ELSE 0
  END;
  v_sales_details_complete := CASE
    WHEN v_revenue > 0
      THEN abs(v_revenue - v_detailed_revenue) <= greatest(0.05, v_revenue * 0.005)
    ELSE v_detailed_orders = 0 AND v_detailed_revenue = 0
  END;
  v_product_costs_complete := v_missing_cost_units = 0 AND v_costed_units > 0;
  v_profit_complete := v_sales_details_complete AND v_product_costs_complete;
  v_net_before_product_cost := v_revenue - v_fees - v_ad_spend - v_returns;
  v_provisional_net := v_net_before_product_cost - v_known_cogs;
  v_net_income := CASE WHEN v_profit_complete THEN v_provisional_net ELSE NULL END;
  v_source := CASE
    WHEN v_sales_details_complete THEN 'detailed_orders'
    WHEN v_detailed_revenue > 0 THEN 'mixed'
    ELSE 'platform_summary'
  END;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'source', v_source,
    'revenue', round(v_revenue, 2),
    'platform_fees', round(v_fees, 2),
    'ad_spend', round(v_ad_spend, 2),
    'returns', round(v_returns, 2),
    'operating_expenses', round(v_fees + v_ad_spend + v_returns, 2),
    'net_before_product_cost', round(v_net_before_product_cost, 2),
    'cogs', round(v_known_cogs, 2),
    'provisional_net_after_known_costs', round(v_provisional_net, 2),
    'gross_profit', CASE WHEN v_profit_complete THEN round(v_revenue - v_known_cogs, 2) ELSE NULL END,
    'gross_margin_pct', CASE WHEN v_profit_complete AND v_revenue > 0 THEN round((v_revenue - v_known_cogs) / v_revenue * 100, 1) ELSE NULL END,
    'net_income', CASE WHEN v_net_income IS NOT NULL THEN round(v_net_income, 2) ELSE NULL END,
    'net_margin_pct', CASE WHEN v_net_income IS NOT NULL AND v_revenue > 0 THEN round(v_net_income / v_revenue * 100, 1) ELSE NULL END,
    'orders', v_detailed_orders,
    'reported_activity', v_reported_activity,
    'aov', CASE WHEN v_detailed_orders > 0 THEN round(v_detailed_revenue / v_detailed_orders, 2) ELSE 0 END,
    'data_quality', jsonb_build_object(
      'profit_complete', v_profit_complete,
      'sales_details_complete', v_sales_details_complete,
      'product_costs_complete', v_product_costs_complete,
      'detail_coverage_pct', round(v_detail_coverage, 1),
      'cost_coverage_pct', round(v_cost_coverage, 1),
      'detailed_revenue', round(v_detailed_revenue, 2),
      'detailed_orders', v_detailed_orders,
      'costed_units', v_costed_units,
      'missing_cost_units', v_missing_cost_units
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pnl_statement(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pnl_statement(text, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.pnl_statement(text, integer, integer) IS
  'Tenant-scoped monthly financial statement. Net income is null until detailed sales and product costs are complete; data_quality explains coverage.';
