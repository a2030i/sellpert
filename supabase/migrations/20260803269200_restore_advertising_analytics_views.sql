-- Tenant-safe fee, return, and net advertising analytics used by merchant
-- health scoring and the dashboard.
CREATE OR REPLACE VIEW public.platform_fee_profile
WITH (security_invoker = true)
AS
WITH principal AS (
  SELECT
    merchant_code,
    platform,
    sum(net_amount) FILTER (
      WHERE amount_type = 'ItemPrice'
        AND amount_description IN ('Principal', 'Tax', 'Shipping', 'ShippingTax')
    ) AS principal_gross,
    sum(net_amount) FILTER (
      WHERE amount_type = 'ItemFees' AND amount_description = 'Commission'
    ) AS commission,
    sum(net_amount) FILTER (
      WHERE amount_type = 'ItemFees' AND amount_description LIKE 'FBA%'
    ) AS fba_fee,
    sum(net_amount) FILTER (WHERE amount_type = 'ItemWithheldTax') AS withheld_vat,
    sum(net_amount) FILTER (
      WHERE amount_type = 'ItemFees' AND amount_description = 'RefundCommission'
    ) AS refund_commission,
    sum(net_amount) FILTER (WHERE amount_type = 'Promotion') AS promotions
  FROM public.account_transactions
  GROUP BY merchant_code, platform
)
SELECT
  merchant_code,
  platform,
  coalesce(principal_gross, 0) AS principal_gross,
  coalesce(commission, 0) AS commission,
  coalesce(fba_fee, 0) AS fba_fee,
  coalesce(withheld_vat, 0) AS withheld_vat,
  coalesce(refund_commission, 0) AS refund_commission,
  coalesce(promotions, 0) AS promotions,
  CASE WHEN coalesce(principal_gross, 0) > 0 THEN round(
    abs(
      coalesce(commission, 0) + coalesce(fba_fee, 0)
        + coalesce(withheld_vat, 0) + coalesce(refund_commission, 0)
        + coalesce(promotions, 0)
    ) / principal_gross,
    4
  ) END AS fee_rate
FROM principal;

CREATE OR REPLACE VIEW public.platform_return_profile
WITH (security_invoker = true)
AS
WITH gross AS (
  SELECT merchant_code, platform, sum(total_amount) AS total_sold
  FROM public.orders
  GROUP BY merchant_code, platform
),
ret AS (
  SELECT merchant_code, platform, sum(return_amount) AS total_returned
  FROM public.returns
  GROUP BY merchant_code, platform
)
SELECT
  coalesce(g.merchant_code, r.merchant_code) AS merchant_code,
  coalesce(g.platform, r.platform) AS platform,
  coalesce(g.total_sold, 0) AS total_sold,
  coalesce(r.total_returned, 0) AS total_returned,
  CASE WHEN coalesce(g.total_sold, 0) > 0
    THEN round(least(coalesce(r.total_returned, 0) / g.total_sold, 1), 4)
  END AS return_rate
FROM gross g
FULL JOIN ret r ON r.merchant_code = g.merchant_code AND r.platform = g.platform;

CREATE OR REPLACE VIEW public.ad_net_summary
WITH (security_invoker = true)
AS
SELECT
  am.merchant_code,
  am.platform,
  sum(am.spend) AS total_spend,
  sum(am.revenue) AS total_gross,
  round(sum(am.revenue) * (1 - coalesce(max(fp.fee_rate), 0) - coalesce(max(rp.return_rate), 0)), 2) AS total_net,
  round(sum(am.revenue) * coalesce(max(fp.fee_rate), 0), 2) AS total_fees,
  round(sum(am.revenue) * coalesce(max(rp.return_rate), 0), 2) AS total_returns,
  round(
    sum(am.revenue) * coalesce(max(fp.fee_rate), 0) * abs(max(fp.commission))
      / nullif(abs(max(fp.commission)) + abs(max(fp.fba_fee)) + abs(max(fp.withheld_vat)), 0),
    2
  ) AS total_commission,
  round(
    sum(am.revenue) * coalesce(max(fp.fee_rate), 0) * abs(max(fp.fba_fee))
      / nullif(abs(max(fp.commission)) + abs(max(fp.fba_fee)) + abs(max(fp.withheld_vat)), 0),
    2
  ) AS total_fba,
  round(
    sum(am.revenue) * coalesce(max(fp.fee_rate), 0) * abs(max(fp.withheld_vat))
      / nullif(abs(max(fp.commission)) + abs(max(fp.fba_fee)) + abs(max(fp.withheld_vat)), 0),
    2
  ) AS total_vat,
  CASE WHEN sum(am.spend) > 0 THEN round(sum(am.revenue) / sum(am.spend), 2) END AS gross_roas,
  CASE WHEN sum(am.spend) > 0 THEN round(
    sum(am.revenue) * (1 - coalesce(max(fp.fee_rate), 0) - coalesce(max(rp.return_rate), 0))
      / sum(am.spend),
    2
  ) END AS net_roas,
  max(fp.fee_rate) AS fee_rate,
  max(rp.return_rate) AS return_rate
FROM public.ad_metrics am
LEFT JOIN public.platform_fee_profile fp
  ON fp.merchant_code = am.merchant_code AND fp.platform = am.platform
LEFT JOIN public.platform_return_profile rp
  ON rp.merchant_code = am.merchant_code AND rp.platform = am.platform
WHERE am.spend > 0
GROUP BY am.merchant_code, am.platform;

REVOKE ALL ON public.platform_fee_profile, public.platform_return_profile,
  public.ad_net_summary FROM PUBLIC, anon;
GRANT SELECT ON public.platform_fee_profile, public.platform_return_profile,
  public.ad_net_summary TO authenticated, service_role;
