-- The production baseline originally captured tables and functions but not
-- analytical views. Restore the tenant-safe profitability view before health
-- and executive-brief RPCs begin consuming it.
CREATE OR REPLACE VIEW public.product_profitability
WITH (security_invoker = true)
AS
WITH order_agg AS (
  SELECT
    o.merchant_code,
    o.sku,
    count(*)::integer AS orders_count,
    sum(o.quantity) AS units_sold,
    sum(o.total_amount) AS revenue,
    sum(
      CASE
        WHEN o.platform = 'noon' AND coalesce(o.platform_fee, 0) = 0
          THEN o.total_amount * (coalesce(cr.rate, 0) / 100.0)
            * (1 + coalesce(cr.vat_rate, 0) / 100.0)
        ELSE coalesce(o.platform_fee, 0)
      END
    ) AS platform_fees
  FROM public.orders o
  LEFT JOIN public.platform_commission_rates cr
    ON cr.platform = o.platform AND cr.category = 'default'
  WHERE o.status <> 'cancelled' AND o.sku IS NOT NULL
  GROUP BY o.merchant_code, o.sku
),
ad_agg AS (
  SELECT
    am.merchant_code,
    coalesce(p.sku, am.sku) AS sku,
    sum(am.spend) AS ad_spend,
    sum(coalesce(am.revenue, 0)) AS ad_revenue
  FROM public.ad_metrics am
  LEFT JOIN public.products p
    ON p.merchant_code = am.merchant_code
   AND (p.sku = am.sku OR p.noon_sku_child = am.sku)
  WHERE am.sku IS NOT NULL AND am.sku <> ''
  GROUP BY am.merchant_code, coalesce(p.sku, am.sku)
),
return_agg AS (
  SELECT
    merchant_code,
    sku,
    count(*)::integer AS returns_count,
    sum(return_amount) AS returns_amount
  FROM public.returns
  WHERE sku IS NOT NULL
  GROUP BY merchant_code, sku
)
SELECT
  p.id AS product_id,
  p.merchant_code,
  p.sku,
  p.name AS product_name,
  p.brand,
  p.category,
  coalesce(p.cost_price, 0) AS cost_price,
  coalesce(p.sale_price, p.msrp, p.target_net_price, 0) AS selling_price,
  coalesce(o.units_sold, 0) AS units_sold,
  coalesce(o.revenue, 0) AS revenue,
  round(coalesce(o.platform_fees, 0), 2) AS platform_fees,
  coalesce(a.ad_spend, 0) AS ad_spend,
  coalesce(r.returns_count, 0) AS returns_count,
  coalesce(r.returns_amount, 0) AS returns_amount,
  coalesce(o.units_sold, 0)::numeric * coalesce(p.cost_price, 0) AS total_cost,
  round(
    coalesce(o.revenue, 0)
      - coalesce(o.units_sold, 0)::numeric * coalesce(p.cost_price, 0)
      - coalesce(o.platform_fees, 0)
      - coalesce(a.ad_spend, 0)
      - coalesce(r.returns_amount, 0),
    2
  ) AS net_profit,
  CASE WHEN coalesce(o.revenue, 0) > 0 THEN round(
    (
      coalesce(o.revenue, 0)
        - coalesce(o.units_sold, 0)::numeric * coalesce(p.cost_price, 0)
        - coalesce(o.platform_fees, 0)
        - coalesce(a.ad_spend, 0)
        - coalesce(r.returns_amount, 0)
    ) / coalesce(o.revenue, 0) * 100,
    1
  ) END AS profit_margin_pct,
  CASE WHEN coalesce(a.ad_spend, 0) > 0
    THEN round(coalesce(o.revenue, 0) / a.ad_spend, 2)
  END AS roas,
  coalesce(a.ad_revenue, 0) AS ad_revenue,
  CASE WHEN coalesce(a.ad_spend, 0) > 0
    THEN round(coalesce(a.ad_revenue, 0) / a.ad_spend, 2)
  END AS ad_roas
FROM public.products p
LEFT JOIN order_agg o ON o.merchant_code = p.merchant_code AND o.sku = p.sku
LEFT JOIN ad_agg a ON a.merchant_code = p.merchant_code AND a.sku = p.sku
LEFT JOIN return_agg r ON r.merchant_code = p.merchant_code AND r.sku = p.sku;

REVOKE ALL ON public.product_profitability FROM PUBLIC, anon;
GRANT SELECT ON public.product_profitability TO authenticated, service_role;
