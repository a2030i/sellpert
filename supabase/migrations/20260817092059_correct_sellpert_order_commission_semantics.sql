-- Sellpert earns commission at the order grain only. The catalog may show a
-- single-product worst-case estimate, but billing and finance must use this
-- order-level rule.
CREATE OR REPLACE FUNCTION security.sellpert_order_commission(
  p_status text,
  p_order_total numeric,
  p_customer_shipping_amount numeric,
  p_fee_type text,
  p_fee_value numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT round(
    CASE
      WHEN lower(coalesce(p_status, '')) <> 'delivered' THEN 0
      WHEN p_fee_type = 'fixed' THEN greatest(coalesce(p_fee_value, 0), 0)
      WHEN p_fee_type = 'percentage' THEN
        (
          greatest(coalesce(p_order_total, 0), 0)
          + greatest(coalesce(p_customer_shipping_amount, 0), 0)
        ) * least(greatest(coalesce(p_fee_value, 0), 0), 100) / 100
      ELSE 0
    END,
    4
  )
$$;

REVOKE ALL ON FUNCTION security.sellpert_order_commission(text, numeric, numeric, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.sellpert_order_commission(text, numeric, numeric, text, numeric)
  TO service_role;

COMMENT ON FUNCTION security.sellpert_order_commission(text, numeric, numeric, text, numeric) IS
  'Authoritative Sellpert fee for one order: delivered only; fixed once per order; percentage of recorded order sales plus separately reported customer shipping.';

COMMENT ON TABLE public.merchant_contract_terms IS
  'Admin-managed Sellpert commercial terms applied at the successful-order grain for one merchant.';

COMMENT ON COLUMN public.merchant_contract_terms.sellpert_fee_type IS
  'Sellpert contract mode: none, percentage of successful order sales including customer shipping, or fixed amount once per successful order.';

COMMENT ON COLUMN public.merchant_contract_terms.sellpert_fee_value IS
  'Contractual Sellpert percentage or fixed amount. Cancelled and returned orders earn zero; no VAT is added automatically.';
