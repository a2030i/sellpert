-- Separate platform administrators from merchant employees and enforce a
-- tenant boundary on every public table carrying a merchant_code column.

CREATE SCHEMA IF NOT EXISTS security;
REVOKE ALL ON SCHEMA security FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA security TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.merchants
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
      AND COALESCE(is_active, true)
  )
$$;

-- The effective tenant is the owner's merchant for a merchant employee and
-- the account's own merchant code for a merchant owner.
CREATE OR REPLACE FUNCTION public.current_merchant_code()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN role = 'employee' THEN owner_merchant_code
    ELSE merchant_code
  END
  FROM public.merchants
  WHERE id = (SELECT auth.uid())
    AND COALESCE(is_active, true)
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION security.can_access_merchant(p_merchant_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.merchants m
    WHERE m.id = (SELECT auth.uid())
      AND COALESCE(m.is_active, true)
      AND (
        m.role IN ('admin', 'super_admin')
        OR (m.role = 'employee' AND m.owner_merchant_code = p_merchant_code)
        OR (m.role = 'merchant' AND m.merchant_code = p_merchant_code)
      )
  )
$$;

REVOKE ALL ON FUNCTION security.can_access_merchant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.can_access_merchant(text) TO authenticated, service_role;

-- A restrictive policy is AND-ed with every existing permissive policy. This
-- closes legacy policies that accidentally treated merchant employees as
-- platform staff without expanding the write permissions of any table.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS relation_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> 'merchants'
      AND a.attname = 'merchant_code'
      AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.relation_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_boundary ON %s', r.relation_name);
    EXECUTE format(
      'CREATE POLICY tenant_boundary ON %s AS RESTRICTIVE FOR ALL TO authenticated USING (security.can_access_merchant(merchant_code)) WITH CHECK (security.can_access_merchant(merchant_code))',
      r.relation_name
    );
  END LOOP;
END
$$;

-- Read-only analytics must run as the signed-in user so the tenant RLS above
-- remains authoritative even when a caller supplies another merchant code.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS function_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'ad_kpi_summary', 'cash_flow_forecast', 'data_freshness',
        'inventory_turnover', 'merchant_activation', 'merchant_health_score',
        'period_comparison', 'pnl_statement', 'restock_recommendations',
        'return_reasons_breakdown', 'revenue_forecast', 'sales_heatmap',
        'shipping_analytics', 'weekly_digest'
      ])
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', r.function_name);
  END LOOP;
END
$$;

-- These functions are background/admin mutation endpoints. They continue to
-- work for service_role jobs, but are no longer callable directly by a normal
-- signed-in merchant through PostgREST.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS function_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'auto_suspend_expired_subscriptions', 'bulk_notify',
        'check_budget_alerts', 'complete_queue_job',
        'confirm_manual_payment', 'reject_payment_request',
        'request_plan_upgrade', 'enqueue_daily_salla_sync',
        'trigger_queue_worker', 'suspend_merchant', 'reactivate_merchant',
        'derive_orders_from_account_tx', 'derive_product_platform_prices',
        'derive_returns_from_account_tx', 'derive_returns_from_snapshots',
        'rebuild_performance_data'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated, anon, PUBLIC', r.function_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.function_name);
  END LOOP;
END
$$;

-- OAuth state is service-side transient data, not a client-facing table.
REVOKE ALL ON TABLE public.marketplace_oauth_states FROM anon, authenticated;
