-- Restore the remaining operating views consumed by the merchant dashboard
-- and executive brief. Both views inherit tenant RLS from their source tables.
CREATE OR REPLACE VIEW public.monthly_cashflow
WITH (security_invoker = true)
AS
SELECT
  merchant_code,
  platform,
  date_trunc('month', coalesce(transaction_date, posted_date))::date AS month,
  round(sum(coalesce(credit, 0)), 2) AS cash_in,
  round(sum(coalesce(debit, 0)), 2) AS cash_out,
  round(sum(coalesce(credit, 0)) - sum(coalesce(debit, 0)), 2) AS net,
  count(*) AS tx_count
FROM public.account_transactions
WHERE coalesce(transaction_date, posted_date) IS NOT NULL
GROUP BY merchant_code, platform,
  date_trunc('month', coalesce(transaction_date, posted_date))::date;

CREATE OR REPLACE VIEW public.inventory_health
WITH (security_invoker = true)
AS
WITH platform_anchor AS (
  SELECT
    merchant_code,
    lower(btrim(platform)) AS platform,
    max(order_date) AS data_as_of
  FROM public.orders
  WHERE status NOT IN ('cancelled', 'returned')
    AND sku IS NOT NULL AND btrim(sku) <> ''
  GROUP BY merchant_code, lower(btrim(platform))
),
velocity AS (
  SELECT
    o.merchant_code,
    lower(btrim(o.platform)) AS platform,
    lower(btrim(o.sku)) AS normalized_sku,
    sum(o.quantity)::numeric
      / greatest(least(30::numeric, extract(day FROM a.data_as_of - min(o.order_date)) + 1), 1) AS daily_velocity,
    sum(o.quantity) AS sold_30d,
    max(o.order_date) AS last_sold_at,
    a.data_as_of
  FROM public.orders o
  JOIN platform_anchor a
    ON a.merchant_code = o.merchant_code
   AND a.platform = lower(btrim(o.platform))
  WHERE o.order_date > a.data_as_of - interval '30 days'
    AND o.order_date <= a.data_as_of
    AND o.status NOT IN ('cancelled', 'returned')
    AND o.sku IS NOT NULL AND btrim(o.sku) <> ''
  GROUP BY o.merchant_code, lower(btrim(o.platform)), lower(btrim(o.sku)), a.data_as_of
),
product_price AS (
  SELECT DISTINCT ON (merchant_code, lower(btrim(sku)))
    merchant_code,
    lower(btrim(sku)) AS normalized_sku,
    cost_price,
    coalesce(sale_price, msrp, target_net_price, 0) AS selling_price
  FROM public.products
  WHERE sku IS NOT NULL AND btrim(sku) <> ''
  ORDER BY merchant_code, lower(btrim(sku)), updated_at DESC NULLS LAST, created_at DESC NULLS LAST
)
SELECT
  i.id,
  i.merchant_code,
  i.platform,
  i.sku,
  i.product_name,
  i.quantity,
  coalesce(nullif(i.cost_price, 0), p.cost_price, 0)::numeric(12,2) AS cost_price,
  i.low_stock_threshold,
  coalesce(p.selling_price, 0) AS selling_price,
  i.quantity::numeric * coalesce(nullif(i.cost_price, 0), p.cost_price, 0) AS stock_value_cost,
  i.quantity::numeric * coalesce(p.selling_price, 0) AS stock_value_retail,
  coalesce(v.daily_velocity, 0) AS daily_velocity,
  coalesce(v.sold_30d, 0) AS sold_30d,
  v.last_sold_at,
  CASE WHEN v.daily_velocity > 0 THEN round(i.quantity::numeric / v.daily_velocity, 0) END AS days_of_stock,
  CASE
    WHEN i.quantity = 0 THEN 'out_of_stock'
    WHEN i.quantity <= coalesce(i.low_stock_threshold, 10) THEN 'low_stock'
    WHEN v.daily_velocity > 0 AND i.quantity::numeric / v.daily_velocity < 7 THEN 'reorder_soon'
    WHEN v.last_sold_at IS NULL THEN 'no_sales_data'
    WHEN v.last_sold_at < v.data_as_of - interval '30 days' THEN 'slow_mover'
    ELSE 'healthy'
  END AS health_status,
  v.data_as_of,
  CASE WHEN v.data_as_of IS NOT NULL
    THEN greatest(0, current_date - v.data_as_of::date)
  END AS data_age_days
FROM public.inventory i
LEFT JOIN product_price p
  ON p.merchant_code = i.merchant_code
 AND p.normalized_sku = lower(btrim(i.sku))
LEFT JOIN velocity v
  ON v.merchant_code = i.merchant_code
 AND v.platform = lower(btrim(i.platform))
 AND v.normalized_sku = lower(btrim(i.sku));

REVOKE ALL ON public.monthly_cashflow, public.inventory_health FROM PUBLIC, anon;
GRANT SELECT ON public.monthly_cashflow, public.inventory_health TO authenticated, service_role;
