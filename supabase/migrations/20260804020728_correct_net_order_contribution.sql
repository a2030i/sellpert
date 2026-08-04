-- Marketplace order.total_amount is the net amount after discounts. Keep the
-- discount as an auditable disclosure, but do not subtract it a second time
-- from contribution before product cost.

CREATE OR REPLACE FUNCTION security.net_order_contribution(
  p_total_amount numeric,
  p_platform_fee numeric,
  p_shipping_cost numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT coalesce(p_total_amount, 0)
    - coalesce(p_platform_fee, 0)
    - coalesce(p_shipping_cost, 0)
$$;

REVOKE ALL ON FUNCTION security.net_order_contribution(numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.net_order_contribution(numeric, numeric, numeric) TO authenticated, service_role;

-- Preserve the complete, tenant-authorized brief implementation as an
-- internal base and publish a corrected wrapper under the existing API name.
ALTER FUNCTION public.merchant_executive_brief(text) SET SCHEMA security;
ALTER FUNCTION security.merchant_executive_brief(text) RENAME TO merchant_executive_brief_base;

REVOKE ALL ON FUNCTION security.merchant_executive_brief_base(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.merchant_executive_brief_base(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.merchant_executive_brief(p_merchant_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, security
AS $$
DECLARE
  v_result jsonb;
  v_period_start date;
  v_period_end date;
  v_previous_start date;
  v_previous_end date;
  v_contribution numeric := 0;
  v_previous_contribution numeric := 0;
  v_change_pct numeric;
BEGIN
  -- The base function retains the authoritative tenant and active-session
  -- checks. This wrapper only corrects derived financial fields.
  v_result := security.merchant_executive_brief_base(p_merchant_code);
  IF NOT coalesce((v_result->>'available')::boolean, false) THEN
    RETURN v_result;
  END IF;

  v_period_start := (v_result #>> '{period,start}')::date;
  v_period_end := (v_result #>> '{period,end}')::date;
  v_previous_start := (v_result #>> '{period,previous_start}')::date;
  v_previous_end := (v_result #>> '{period,previous_end}')::date;

  SELECT coalesce(sum(security.net_order_contribution(total_amount, platform_fee, shipping_cost)), 0)
    INTO v_contribution
  FROM public.orders
  WHERE merchant_code = p_merchant_code
    AND status NOT IN ('cancelled', 'returned')
    AND order_date::date BETWEEN v_period_start AND v_period_end;

  SELECT coalesce(sum(security.net_order_contribution(total_amount, platform_fee, shipping_cost)), 0)
    INTO v_previous_contribution
  FROM public.orders
  WHERE merchant_code = p_merchant_code
    AND status NOT IN ('cancelled', 'returned')
    AND order_date::date BETWEEN v_previous_start AND v_previous_end;

  v_change_pct := CASE WHEN v_previous_contribution > 0
    THEN round((v_contribution - v_previous_contribution) / v_previous_contribution * 100, 1)
    ELSE NULL END;

  v_result := jsonb_set(v_result, '{week,contribution_before_product_cost}', to_jsonb(round(v_contribution, 2)), true);
  v_result := jsonb_set(v_result, '{week,previous_contribution_before_product_cost}', to_jsonb(round(v_previous_contribution, 2)), true);
  v_result := jsonb_set(v_result, '{week,contribution_change_pct}', coalesce(to_jsonb(v_change_pct), 'null'::jsonb), true);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_executive_brief(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_executive_brief(text) TO authenticated, service_role;

COMMENT ON FUNCTION security.net_order_contribution(numeric, numeric, numeric) IS
  'Returns net marketplace order contribution before product cost without subtracting recorded discounts twice.';
COMMENT ON FUNCTION public.merchant_executive_brief(text) IS
  'Tenant-scoped executive brief with corrected net-order contribution; authorization remains enforced by the internal base function.';
