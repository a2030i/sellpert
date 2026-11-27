-- Preserve source precedence within each explicitly identified account.
-- Never join two sellers by their coincidentally equal external order number.
drop index public.performance_data_agg_upsert;
drop index public.performance_data_prod_upsert;
drop index public.performance_data_uniq;
create unique index performance_data_agg_upsert on public.performance_data(merchant_code,platform,data_date,marketplace_account_id)
  where data_date is not null and product_name is null;
create unique index performance_data_prod_upsert on public.performance_data(merchant_code,platform,data_date,product_name,marketplace_account_id)
  where data_date is not null and product_name is not null;
create unique index performance_data_uniq on public.performance_data(merchant_code,platform,data_date,marketplace_account_id)
  where product_name is null;

CREATE OR REPLACE FUNCTION security.rebuild_performance_data(p_merchant_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE affected integer;
BEGIN
  DELETE FROM public.performance_data WHERE merchant_code = p_merchant_code;

  WITH item_fees AS (
    SELECT merchant_code, platform, marketplace_account_id, order_id, sum(coalesce(commission_amount, 0)) AS platform_fee
    FROM public.order_items
    WHERE merchant_code = p_merchant_code
    GROUP BY merchant_code, platform, marketplace_account_id, order_id
  ),
  order_agg AS (
    SELECT o.merchant_code, o.platform, o.marketplace_account_id, DATE(o.order_date) AS data_date,
      SUM(o.total_amount) AS total_sales,
      COUNT(*)::int AS order_count,
      SUM(CASE
        WHEN coalesce(items.platform_fee, 0) > 0 THEN items.platform_fee
        ELSE coalesce(o.platform_fee, 0)
      END) AS platform_fees
    FROM public.orders o
    LEFT JOIN item_fees items
      ON items.merchant_code = o.merchant_code
     AND items.platform = o.platform
     AND items.order_id = o.order_id
     AND items.marketplace_account_id = o.marketplace_account_id
    WHERE o.merchant_code = p_merchant_code AND o.status NOT IN ('cancelled')
    GROUP BY o.merchant_code, o.platform, o.marketplace_account_id, DATE(o.order_date)
  ),
  amz_tx_orders AS (
    SELECT t.merchant_code, t.platform, t.marketplace_account_id, DATE(t.transaction_date) AS data_date,
      SUM(GREATEST(t.credit, 0)) AS total_sales, COUNT(*)::int AS order_count,
      SUM(GREATEST(t.debit, 0)) AS platform_fees
    FROM public.account_transactions t
    WHERE t.merchant_code = p_merchant_code AND t.platform = 'amazon'
      AND (t.transaction_type ILIKE '%مبلغ الطلب%' OR t.transaction_type ILIKE '%order%' OR t.amount_type ILIKE '%ItemPrice%')
      AND t.transaction_date IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon' AND o.marketplace_account_id = t.marketplace_account_id)
    GROUP BY t.merchant_code, t.platform, t.marketplace_account_id, DATE(t.transaction_date)
  ),
  amz_dashboard AS (
    SELECT d.merchant_code, 'amazon'::text AS platform, d.marketplace_account_id, d.data_date,
      d.total_sales, COALESCE(d.units,0) AS order_count, 0::numeric AS platform_fees
    FROM public.amazon_daily_sales d
    WHERE d.merchant_code = p_merchant_code
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon' AND o.marketplace_account_id = d.marketplace_account_id)
      AND NOT EXISTS (SELECT 1 FROM amz_tx_orders t WHERE t.marketplace_account_id = d.marketplace_account_id)
  ),
  trendyol_snap AS (
    SELECT s.merchant_code, s.platform, s.marketplace_account_id, s.snapshot_date AS data_date,
      SUM(s.gross_sales) AS total_sales, SUM(s.net_sold)::int AS order_count, 0::numeric AS platform_fees
    FROM public.product_performance_snapshots s
    WHERE s.merchant_code = p_merchant_code AND s.platform = 'trendyol'
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'trendyol' AND o.marketplace_account_id = s.marketplace_account_id)
    GROUP BY s.merchant_code, s.platform, s.marketplace_account_id, s.snapshot_date
  ),
  ad_agg AS (
    SELECT merchant_code, platform, marketplace_account_id, report_date AS data_date, SUM(spend) AS ad_spend
    FROM public.ad_metrics WHERE merchant_code = p_merchant_code
    GROUP BY merchant_code, platform, marketplace_account_id, report_date
  ),
  combined AS (
    SELECT * FROM order_agg UNION ALL SELECT * FROM amz_tx_orders
    UNION ALL SELECT * FROM amz_dashboard UNION ALL SELECT * FROM trendyol_snap
  ),
  collapsed AS (
    SELECT merchant_code, platform, marketplace_account_id, data_date, SUM(total_sales) AS total_sales,
      SUM(order_count) AS order_count, SUM(platform_fees) AS platform_fees
    FROM combined GROUP BY merchant_code, platform, marketplace_account_id, data_date
  )
  INSERT INTO public.performance_data
    (merchant_code, platform, marketplace_account_id, data_date, total_sales, order_count, platform_fees, ad_spend)
  SELECT COALESCE(c.merchant_code, a.merchant_code), COALESCE(c.platform, a.platform), COALESCE(c.marketplace_account_id, a.marketplace_account_id),
    COALESCE(c.data_date, a.data_date), COALESCE(c.total_sales, 0),
    COALESCE(c.order_count, 0)::int, COALESCE(c.platform_fees, 0), COALESCE(a.ad_spend, 0)
  FROM collapsed c FULL OUTER JOIN ad_agg a
    ON c.merchant_code = a.merchant_code AND c.platform = a.platform AND c.data_date = a.data_date AND c.marketplace_account_id = a.marketplace_account_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;


revoke all on function security.rebuild_performance_data(text) from public,anon,authenticated;
grant execute on function security.rebuild_performance_data(text) to service_role;
