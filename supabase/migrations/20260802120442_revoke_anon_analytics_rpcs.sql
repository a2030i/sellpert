-- These analytics RPCs operate on merchant-scoped data and are only consumed
-- after authentication. Remove the legacy anonymous grants while preserving
-- access for signed-in clients and backend jobs.
REVOKE ALL ON FUNCTION public.ad_kpi_summary(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_kpi_summary(text, integer, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.data_freshness(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.data_freshness(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.merchant_payouts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_payouts(text) TO authenticated, service_role;
