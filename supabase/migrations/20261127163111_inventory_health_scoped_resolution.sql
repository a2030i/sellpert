-- Resolve source identifiers as one relation instead of running a scoped resolver
-- for every row before the selected-account limit. Preserve ambiguous/null results,
-- existing cost precedence, reservation handling, velocity and invoker authorization.
CREATE OR REPLACE VIEW public.inventory_health_by_account
WITH (security_invoker = true)
AS
WITH platform_anchor AS (
  SELECT
    merchant_code,marketplace_account_id,
    lower(btrim(platform)) AS platform,
    max(order_date) AS data_as_of
  FROM public.orders
  WHERE status NOT IN ('cancelled', 'returned')
    AND sku IS NOT NULL AND btrim(sku) <> ''
  GROUP BY merchant_code, marketplace_account_id, lower(btrim(platform))
),
velocity AS (
  SELECT
    o.merchant_code,o.marketplace_account_id,
    lower(btrim(o.platform)) AS platform,
    btrim(o.sku) AS normalized_sku,
    sum(o.quantity)::numeric
      / greatest(least(30::numeric, extract(day FROM a.data_as_of - min(o.order_date)) + 1), 1) AS daily_velocity,
    sum(o.quantity) AS sold_30d,
    max(o.order_date) AS last_sold_at,
    a.data_as_of
  FROM public.orders o
  JOIN platform_anchor a
    ON a.merchant_code = o.merchant_code AND a.marketplace_account_id=o.marketplace_account_id
   AND a.platform = lower(btrim(o.platform))
  WHERE o.order_date > a.data_as_of - interval '30 days'
    AND o.order_date <= a.data_as_of
    AND o.status NOT IN ('cancelled', 'returned')
    AND o.sku IS NOT NULL AND btrim(o.sku) <> ''
  GROUP BY o.merchant_code,o.marketplace_account_id, lower(btrim(o.platform)), btrim(o.sku), a.data_as_of
),
mapping_identifiers AS (
  SELECT m.merchant_code,m.marketplace_account_id,m.platform,m.product_id,alias.identifier
  FROM public.product_channel_mappings m
  CROSS JOIN LATERAL unnest(array[m.identifier_value,m.source_sku,m.source_barcode]) alias(identifier)
  WHERE m.match_status='linked' AND alias.identifier IS NOT NULL
),
resolved_inventory AS (
  SELECT i.id,i.merchant_code,i.marketplace_account_id,i.platform,i.sku,i.product_name,
    i.quantity,i.reserved_quantity,i.cost_price,i.low_stock_threshold,
    CASE WHEN count(DISTINCT m.product_id)=1
      THEN (array_agg(m.product_id) FILTER (WHERE m.product_id IS NOT NULL))[1] END product_id
  FROM public.inventory i LEFT JOIN mapping_identifiers m
    ON m.merchant_code=i.merchant_code AND m.marketplace_account_id=i.marketplace_account_id
    AND m.platform=i.platform AND m.identifier=ANY(array[i.sku,i.partner_sku])
  GROUP BY i.id,i.merchant_code,i.marketplace_account_id
)
SELECT
  i.id,
  i.marketplace_account_id,
  i.merchant_code,
  i.platform,
  i.sku,
  i.product_name,
  greatest(i.quantity-coalesce(i.reserved_quantity,0),0) quantity,
  coalesce(nullif(i.cost_price, 0), p.cost_price, 0)::numeric(12,2) AS cost_price,
  i.low_stock_threshold,
  coalesce(p.sale_price,p.msrp,p.target_net_price,0) AS selling_price,
  greatest(i.quantity-coalesce(i.reserved_quantity,0),0)::numeric * coalesce(nullif(i.cost_price, 0), p.cost_price, 0) AS stock_value_cost,
  greatest(i.quantity-coalesce(i.reserved_quantity,0),0)::numeric * coalesce(p.sale_price,p.msrp,p.target_net_price,0) AS stock_value_retail,
  coalesce(v.daily_velocity, 0) AS daily_velocity,
  coalesce(v.sold_30d, 0) AS sold_30d,
  v.last_sold_at,
  CASE WHEN v.daily_velocity > 0 THEN round(greatest(i.quantity-coalesce(i.reserved_quantity,0),0)::numeric / v.daily_velocity, 0) END AS days_of_stock,
  CASE
    WHEN greatest(i.quantity-coalesce(i.reserved_quantity,0),0) = 0 THEN 'out_of_stock'
    WHEN greatest(i.quantity-coalesce(i.reserved_quantity,0),0) <= coalesce(i.low_stock_threshold, 10) THEN 'low_stock'
    WHEN v.daily_velocity > 0 AND greatest(i.quantity-coalesce(i.reserved_quantity,0),0)::numeric / v.daily_velocity < 7 THEN 'reorder_soon'
    WHEN v.last_sold_at IS NULL THEN 'no_sales_data'
    WHEN v.last_sold_at < v.data_as_of - interval '30 days' THEN 'slow_mover'
    ELSE 'healthy'
  END AS health_status,
  v.data_as_of,
  CASE WHEN v.data_as_of IS NOT NULL
    THEN greatest(0, current_date - v.data_as_of::date)
  END AS data_age_days
FROM resolved_inventory i
LEFT JOIN public.products p ON p.merchant_code=i.merchant_code AND p.id=i.product_id
LEFT JOIN velocity v
  ON v.merchant_code = i.merchant_code AND v.marketplace_account_id=i.marketplace_account_id
 AND v.platform = lower(btrim(i.platform))
 AND v.normalized_sku = btrim(i.sku);

REVOKE ALL ON public.inventory_health_by_account FROM PUBLIC,anon;
GRANT SELECT ON public.inventory_health_by_account TO authenticated,service_role;
