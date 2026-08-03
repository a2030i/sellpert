-- A platform can have several representations of the same sale: an order,
-- a finance transaction, and a reporting snapshot. Use a strict source
-- precedence per platform so the financial dashboard never counts the same
-- sale more than once.
CREATE OR REPLACE FUNCTION public.rebuild_performance_data(p_merchant_code text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE affected integer;
BEGIN
  DELETE FROM public.performance_data WHERE merchant_code = p_merchant_code;

  WITH order_agg AS (
    SELECT o.merchant_code, o.platform, DATE(o.order_date) AS data_date,
      SUM(o.total_amount) AS total_sales,
      COUNT(*)::int AS order_count,
      SUM(CASE WHEN o.platform = 'noon' AND COALESCE(o.platform_fee,0) = 0
            THEN o.total_amount * (COALESCE(cr.rate,0)/100.0) * (1 + COALESCE(cr.vat_rate,0)/100.0)
            ELSE COALESCE(o.platform_fee,0) END) AS platform_fees
    FROM public.orders o
    LEFT JOIN public.platform_commission_rates cr
      ON cr.platform = o.platform AND cr.category = 'default'
    WHERE o.merchant_code = p_merchant_code AND o.status NOT IN ('cancelled')
    GROUP BY o.merchant_code, o.platform, DATE(o.order_date)
  ),
  amz_tx_orders AS (
    SELECT t.merchant_code, t.platform, DATE(t.transaction_date) AS data_date,
      SUM(GREATEST(t.credit, 0)) AS total_sales,
      COUNT(*)::int AS order_count,
      SUM(GREATEST(t.debit, 0)) AS platform_fees
    FROM public.account_transactions t
    WHERE t.merchant_code = p_merchant_code
      AND t.platform = 'amazon'
      AND (t.transaction_type ILIKE '%مبلغ الطلب%'
        OR t.transaction_type ILIKE '%order%'
        OR t.amount_type ILIKE '%ItemPrice%')
      AND t.transaction_date IS NOT NULL
      -- Orders are the canonical sale source once they exist. Amazon finance
      -- rows can be posted on another date and must not be added again.
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon')
    GROUP BY t.merchant_code, t.platform, DATE(t.transaction_date)
  ),
  amz_dashboard AS (
    SELECT d.merchant_code, 'amazon'::text AS platform, d.data_date,
      d.total_sales, COALESCE(d.units,0) AS order_count,
      0::numeric AS platform_fees
    FROM public.amazon_daily_sales d
    WHERE d.merchant_code = p_merchant_code
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon')
      AND NOT EXISTS (SELECT 1 FROM amz_tx_orders)
  ),
  trendyol_snap AS (
    SELECT s.merchant_code, s.platform, s.snapshot_date AS data_date,
      SUM(s.gross_sales) AS total_sales,
      SUM(s.net_sold)::int AS order_count,
      SUM(s.discount) AS platform_fees
    FROM public.product_performance_snapshots s
    WHERE s.merchant_code = p_merchant_code
      AND s.platform = 'trendyol'
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'trendyol')
    GROUP BY s.merchant_code, s.platform, s.snapshot_date
  ),
  ad_agg AS (
    SELECT merchant_code, platform, report_date AS data_date, SUM(spend) AS ad_spend
    FROM public.ad_metrics
    WHERE merchant_code = p_merchant_code
    GROUP BY merchant_code, platform, report_date
  ),
  combined AS (
    SELECT * FROM order_agg
    UNION ALL SELECT * FROM amz_tx_orders
    UNION ALL SELECT * FROM amz_dashboard
    UNION ALL SELECT * FROM trendyol_snap
  ),
  collapsed AS (
    SELECT merchant_code, platform, data_date,
      SUM(total_sales) AS total_sales,
      SUM(order_count) AS order_count,
      SUM(platform_fees) AS platform_fees
    FROM combined
    GROUP BY merchant_code, platform, data_date
  )
  INSERT INTO public.performance_data
    (merchant_code, platform, data_date, total_sales, order_count, platform_fees, ad_spend)
  SELECT COALESCE(c.merchant_code, a.merchant_code),
    COALESCE(c.platform, a.platform), COALESCE(c.data_date, a.data_date),
    COALESCE(c.total_sales, 0), COALESCE(c.order_count, 0)::int,
    COALESCE(c.platform_fees, 0), COALESCE(a.ad_spend, 0)
  FROM collapsed c
  FULL OUTER JOIN ad_agg a
    ON c.merchant_code = a.merchant_code
   AND c.platform = a.platform
   AND c.data_date = a.data_date;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

REVOKE ALL ON FUNCTION public.rebuild_performance_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_performance_data(text) TO service_role;

COMMENT ON FUNCTION public.rebuild_performance_data(text) IS
  'Rebuilds daily performance using one canonical sales source per platform: orders, then finance-derived orders, then reporting snapshots.';
