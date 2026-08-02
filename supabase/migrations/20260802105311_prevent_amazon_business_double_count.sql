-- Business Report rows are period-level ASIN analytics, not another daily
-- sales source. Only Trendyol snapshots belong in performance_data; Amazon's
-- time series comes from orders/transactions or amazon_daily_sales fallback.
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
    LEFT JOIN platform_commission_rates cr ON cr.platform = o.platform AND cr.category = 'default'
    WHERE o.merchant_code = p_merchant_code AND o.status NOT IN ('cancelled')
    GROUP BY o.merchant_code, o.platform, DATE(o.order_date)
  ),
  amz_tx_orders AS (
    SELECT merchant_code, platform, DATE(transaction_date) AS data_date,
      SUM(GREATEST(credit, 0)) AS total_sales, COUNT(*)::int AS order_count, SUM(GREATEST(debit, 0)) AS platform_fees
    FROM public.account_transactions
    WHERE merchant_code = p_merchant_code AND platform = 'amazon'
      AND (transaction_type ILIKE '%مبلغ الطلب%' OR transaction_type ILIKE '%order%' OR amount_type ILIKE '%ItemPrice%')
      AND transaction_date IS NOT NULL
    GROUP BY merchant_code, platform, DATE(transaction_date)
  ),
  amz_dashboard AS (
    SELECT d.merchant_code, 'amazon'::text AS platform, d.data_date,
      d.total_sales, COALESCE(d.units,0) AS order_count, 0::numeric AS platform_fees
    FROM public.amazon_daily_sales d
    WHERE d.merchant_code = p_merchant_code
      AND NOT EXISTS (SELECT 1 FROM amz_tx_orders t WHERE t.data_date = d.data_date)
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon' AND o.data_date = d.data_date)
  ),
  trendyol_snap AS (
    SELECT merchant_code, platform, snapshot_date AS data_date,
      SUM(gross_sales) AS total_sales, SUM(net_sold)::int AS order_count, SUM(discount) AS platform_fees
    FROM public.product_performance_snapshots
    WHERE merchant_code = p_merchant_code
      AND platform = 'trendyol'
    GROUP BY merchant_code, platform, snapshot_date
  ),
  ad_agg AS (
    SELECT merchant_code, platform, report_date AS data_date, SUM(spend) AS ad_spend
    FROM public.ad_metrics WHERE merchant_code = p_merchant_code
    GROUP BY merchant_code, platform, report_date
  ),
  combined AS (
    SELECT * FROM order_agg o
    WHERE NOT (o.platform = 'amazon'
               AND EXISTS (SELECT 1 FROM amz_tx_orders t WHERE t.data_date = o.data_date))
    UNION ALL SELECT * FROM amz_tx_orders
    UNION ALL SELECT * FROM amz_dashboard
    UNION ALL SELECT * FROM trendyol_snap
  ),
  collapsed AS (
    SELECT merchant_code, platform, data_date,
      SUM(total_sales) AS total_sales, SUM(order_count) AS order_count, SUM(platform_fees) AS platform_fees
    FROM combined GROUP BY merchant_code, platform, data_date
  )
  INSERT INTO public.performance_data (merchant_code, platform, data_date, total_sales, order_count, platform_fees, ad_spend)
  SELECT COALESCE(c.merchant_code, a.merchant_code), COALESCE(c.platform, a.platform), COALESCE(c.data_date, a.data_date),
    COALESCE(c.total_sales, 0), COALESCE(c.order_count, 0)::int, COALESCE(c.platform_fees, 0), COALESCE(a.ad_spend, 0)
  FROM collapsed c
  FULL OUTER JOIN ad_agg a ON c.merchant_code = a.merchant_code AND c.platform = a.platform AND c.data_date = a.data_date;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

COMMENT ON FUNCTION public.rebuild_performance_data(text) IS
  'Rebuilds daily performance. Amazon Business Report snapshots are excluded because they duplicate period totals from the Amazon daily source.';
