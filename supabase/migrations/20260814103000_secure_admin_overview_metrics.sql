-- Server-side aggregation for the administration overview. Returning a small
-- JSON document keeps the dashboard bounded as merchant/data volume grows.
CREATE OR REPLACE FUNCTION security.admin_overview_metrics(
  p_start_date date,
  p_end_date date,
  p_platforms text[] DEFAULT NULL,
  p_merchant_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  result jsonb;
  period_days integer;
  previous_start date;
  previous_end date;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT security.has_platform_permission('view_merchants') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid date range' USING errcode = '22023';
  END IF;
  IF p_end_date - p_start_date > 730 THEN
    RAISE EXCEPTION 'date range exceeds 731 days' USING errcode = '22023';
  END IF;
  IF p_merchant_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.merchants m WHERE m.merchant_code = p_merchant_code AND m.role = 'merchant'
  ) THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;

  period_days := p_end_date - p_start_date + 1;
  previous_end := p_start_date - 1;
  previous_start := previous_end - period_days + 1;

  WITH scoped AS (
    SELECT pd.merchant_code, pd.platform, pd.data_date,
      coalesce(pd.total_sales, 0)::numeric AS total_sales,
      coalesce(pd.order_count, 0)::bigint AS order_count,
      coalesce(pd.platform_fees, 0)::numeric AS platform_fees,
      pd.created_at
    FROM public.performance_data pd
    WHERE pd.data_date BETWEEN previous_start AND p_end_date
      AND (p_platforms IS NULL OR cardinality(p_platforms) = 0 OR pd.platform = ANY(p_platforms))
      AND (p_merchant_code IS NULL OR pd.merchant_code = p_merchant_code)
  ), current_scope AS (
    SELECT * FROM scoped WHERE data_date BETWEEN p_start_date AND p_end_date
  ), previous_scope AS (
    SELECT * FROM scoped WHERE data_date BETWEEN previous_start AND previous_end
  ), totals AS (
    SELECT coalesce(sum(total_sales), 0) gmv, coalesce(sum(order_count), 0) orders,
      coalesce(sum(platform_fees), 0) fees, count(DISTINCT merchant_code) active_merchants,
      count(*) rows, min(data_date) first_date, max(data_date) last_date, max(created_at) updated_at
    FROM current_scope
  ), previous_totals AS (
    SELECT coalesce(sum(total_sales), 0) gmv, coalesce(sum(order_count), 0) orders,
      count(DISTINCT merchant_code) active_merchants FROM previous_scope
  ), days AS (
    SELECT d::date AS date FROM generate_series(p_start_date, p_end_date, interval '1 day') d
  ), trend AS (
    SELECT days.date, coalesce(sum(c.total_sales), 0) gmv, coalesce(sum(c.order_count), 0) orders
    FROM days LEFT JOIN current_scope c ON c.data_date = days.date GROUP BY days.date ORDER BY days.date
  ), by_platform AS (
    SELECT platform, sum(total_sales) gmv, sum(order_count) orders
    FROM current_scope GROUP BY platform ORDER BY sum(total_sales) DESC
  ), by_merchant AS (
    SELECT c.merchant_code, m.name, sum(c.total_sales) gmv, sum(c.order_count) orders
    FROM current_scope c JOIN public.merchants m ON m.merchant_code = c.merchant_code
    GROUP BY c.merchant_code, m.name ORDER BY sum(c.total_sales) DESC LIMIT 10
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('start', p_start_date, 'end', p_end_date, 'previous_start', previous_start, 'previous_end', previous_end),
    'totals', (SELECT to_jsonb(totals) FROM totals),
    'previous', (SELECT to_jsonb(previous_totals) FROM previous_totals),
    'trend', coalesce((SELECT jsonb_agg(to_jsonb(trend) ORDER BY date) FROM trend), '[]'::jsonb),
    'platforms', coalesce((SELECT jsonb_agg(to_jsonb(by_platform)) FROM by_platform), '[]'::jsonb),
    'merchants', coalesce((SELECT jsonb_agg(to_jsonb(by_merchant)) FROM by_merchant), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION security.admin_overview_metrics(date, date, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.admin_overview_metrics(date, date, text[], text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_overview_metrics(
  p_start_date date,
  p_end_date date,
  p_platforms text[] DEFAULT NULL,
  p_merchant_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT security.admin_overview_metrics(p_start_date, p_end_date, p_platforms, p_merchant_code)
$$;

REVOKE ALL ON FUNCTION public.admin_overview_metrics(date, date, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_overview_metrics(date, date, text[], text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_overview_metrics(date, date, text[], text) IS
  'Permission-checked, server-aggregated administration overview for one consistent date/platform/merchant scope.';
