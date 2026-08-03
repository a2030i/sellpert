-- Reject invalid or cross-tenant callers before any derived-data function can
-- perform work.  The previous implementation eventually failed in a nested
-- function, which rolled the transaction back, but authorization belongs at
-- the public RPC boundary so no earlier step is ever reached.

CREATE OR REPLACE FUNCTION public.rebuild_all_derived_data(p_merchant_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_is_active boolean;
  v_effective_merchant text;
  v_is_service_role boolean := COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role';
  amz_orders int;
  rets_snap int;
  rets_amz int;
  prices int;
  perf int;
  alerts int;
BEGIN
  IF p_merchant_code IS NULL OR btrim(p_merchant_code) = '' THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;

    SELECT role, COALESCE(is_active, true)
      INTO v_role, v_is_active
    FROM public.merchants
    WHERE id = (SELECT auth.uid());

    IF v_role IS NULL OR NOT COALESCE(v_is_active, false) THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;

    CASE v_role
      WHEN 'staff' THEN
        IF NOT security.has_platform_permission('upload_files') THEN
          RAISE EXCEPTION 'forbidden' USING errcode = '42501';
        END IF;
      WHEN 'admin', 'super_admin' THEN
        NULL;
      WHEN 'merchant', 'employee' THEN
        v_effective_merchant := public.current_merchant_code();
        IF p_merchant_code IS DISTINCT FROM v_effective_merchant
           OR NOT security.has_merchant_permission(p_merchant_code, 'integrations') THEN
          RAISE EXCEPTION 'forbidden' USING errcode = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END CASE;
  END IF;

  amz_orders := public.derive_orders_from_account_tx(p_merchant_code);
  rets_snap  := public.derive_returns_from_snapshots(p_merchant_code);
  rets_amz   := public.derive_returns_from_account_tx(p_merchant_code);
  prices     := public.derive_product_platform_prices(p_merchant_code);
  perf       := public.rebuild_performance_data(p_merchant_code);
  alerts     := public.generate_proactive_alerts(p_merchant_code);

  RETURN jsonb_build_object(
    'amazon_orders_derived', amz_orders,
    'returns_derived', rets_snap + rets_amz,
    'platform_prices_derived', prices,
    'performance_rows', perf,
    'alerts_generated', alerts
  );
END
$$;

REVOKE ALL ON FUNCTION public.rebuild_all_derived_data(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_all_derived_data(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.rebuild_all_derived_data(text) IS
  'Rebuilds tenant-derived data after explicit caller, role, permission, and merchant-boundary authorization.';
