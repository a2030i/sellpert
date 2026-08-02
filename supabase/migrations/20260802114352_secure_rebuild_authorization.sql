-- Rebuilding derived data deletes and recreates merchant analytics. Keep the
-- orchestration RPC available to staff imports, but prevent merchants from
-- targeting another merchant code and prevent direct access to the inner RPC.
CREATE OR REPLACE FUNCTION public.rebuild_all_derived_data(p_merchant_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  amz_orders int; rets_snap int; rets_amz int; prices int; perf int; alerts int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
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
$function$;

REVOKE ALL ON FUNCTION public.rebuild_all_derived_data(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_all_derived_data(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rebuild_performance_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_performance_data(text) TO service_role;

COMMENT ON FUNCTION public.rebuild_all_derived_data(text) IS
  'Staff-only orchestration for rebuilding merchant derived data after an import.';
