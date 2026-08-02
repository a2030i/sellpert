-- Enforce merchant-team permissions in Postgres. UI visibility is only a
-- convenience; these restrictive policies are the authoritative boundary.

CREATE OR REPLACE FUNCTION security.has_merchant_permission(
  p_merchant_code text,
  p_permission text
)
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
        OR (m.role = 'merchant' AND m.merchant_code = p_merchant_code)
        OR (
          m.role = 'employee'
          AND m.owner_merchant_code = p_merchant_code
          AND CASE jsonb_typeof(COALESCE(m.permissions, '{}'::jsonb))
            WHEN 'object' THEN COALESCE(m.permissions ->> p_permission, 'false') = 'true'
            WHEN 'array' THEN COALESCE(m.permissions, '[]'::jsonb) ? p_permission
            ELSE false
          END
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION security.has_any_merchant_permission(
  p_merchant_code text,
  p_permissions text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(bool_or(security.has_merchant_permission(p_merchant_code, permission)), false)
  FROM unnest(p_permissions) permission
$$;

REVOKE ALL ON FUNCTION security.has_merchant_permission(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.has_any_merchant_permission(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.has_merchant_permission(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.has_any_merchant_permission(text, text[]) TO authenticated, service_role;

-- Remove the temporary broad employee read policy introduced while separating
-- platform staff from merchant employees.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass relation_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS employee_read_owner_tenant ON %s', r.relation_name);
  END LOOP;
END
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('orders',                         ARRAY['orders','dashboard']::text[],       'orders'),
      ('order_items',                    ARRAY['orders','dashboard']::text[],       'orders'),
      ('products',                       ARRAY['products','dashboard']::text[],     'products'),
      ('product_platform_listings',      ARRAY['products','dashboard']::text[],     'products'),
      ('product_platform_prices',        ARRAY['products','dashboard']::text[],     'products'),
      ('product_performance_snapshots',  ARRAY['products','dashboard']::text[],     'products'),
      ('price_change_log',               ARRAY['products']::text[],                 'products'),
      ('inventory',                      ARRAY['inventory','dashboard']::text[],    'inventory'),
      ('goods_received',                 ARRAY['inventory','dashboard']::text[],    'inventory'),
      ('inbound_shipments',              ARRAY['inventory','dashboard']::text[],    'inventory'),
      ('inbound_shipment_items',         ARRAY['inventory','dashboard']::text[],    'inventory'),
      ('performance_data',               ARRAY['dashboard','statement','marketing']::text[], 'dashboard'),
      ('ad_metrics',                     ARRAY['marketing','dashboard']::text[],    'marketing'),
      ('budget_alerts',                  ARRAY['marketing','dashboard']::text[],    'marketing'),
      ('returns',                        ARRAY['orders','statement','dashboard']::text[], 'orders'),
      ('account_transactions',           ARRAY['statement','dashboard']::text[],    'statement'),
      ('merchant_payout_schedule',       ARRAY['statement','dashboard']::text[],    'statement'),
      ('amazon_daily_sales',             ARRAY['statement','dashboard']::text[],    'statement'),
      ('platform_file_uploads',          ARRAY['integrations']::text[],             'integrations'),
      ('sync_queue',                     ARRAY['integrations']::text[],             'integrations'),
      ('sync_logs',                      ARRAY['integrations']::text[],             'integrations'),
      ('sync_requests',                  ARRAY['integrations']::text[],             'integrations'),
      ('import_diagnostics',             ARRAY['integrations']::text[],             'integrations'),
      ('marketplace_action_logs',        ARRAY['integrations']::text[],             'integrations'),
      ('platform_deals',                 ARRAY['products','integrations']::text[],  'products'),
      ('ai_insights',                    ARRAY['dashboard']::text[],                'dashboard'),
      ('notifications',                  ARRAY['dashboard']::text[],                'dashboard'),
      ('sales_targets',                  ARRAY['dashboard']::text[],                'dashboard')
    ) AS permissions_map(table_name, read_permissions, write_permission)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_read ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_select_boundary ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_insert_boundary ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_update_boundary ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_delete_boundary ON public.%I', r.table_name);

    -- Permissive read access for merchant employees. Tenant owners and platform
    -- admins also pass the helper and retain their existing behavior.
    EXECUTE format(
      'CREATE POLICY merchant_permission_read ON public.%I FOR SELECT TO authenticated USING (security.has_any_merchant_permission(merchant_code, %L::text[]))',
      r.table_name, r.read_permissions
    );

    -- Restrictive policies prevent any older permissive policy from bypassing
    -- the assigned section permission.
    EXECUTE format(
      'CREATE POLICY merchant_permission_select_boundary ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (security.has_any_merchant_permission(merchant_code, %L::text[]))',
      r.table_name, r.read_permissions
    );
    EXECUTE format(
      'CREATE POLICY merchant_permission_insert_boundary ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (security.has_merchant_permission(merchant_code, %L))',
      r.table_name, r.write_permission
    );
    EXECUTE format(
      'CREATE POLICY merchant_permission_update_boundary ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (security.has_merchant_permission(merchant_code, %L)) WITH CHECK (security.has_merchant_permission(merchant_code, %L))',
      r.table_name, r.write_permission, r.write_permission
    );
    EXECUTE format(
      'CREATE POLICY merchant_permission_delete_boundary ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (security.has_merchant_permission(merchant_code, %L))',
      r.table_name, r.write_permission
    );
  END LOOP;
END
$$;

