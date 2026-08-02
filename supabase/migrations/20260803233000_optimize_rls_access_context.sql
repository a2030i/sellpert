-- Evaluate the signed-in account context once per statement instead of once
-- per row. This keeps the same tenant/permission guarantees while avoiding
-- repeated lookups in merchants on large order and finance tables.

CREATE OR REPLACE FUNCTION security.is_platform_staff_account()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchants
    WHERE id = (SELECT auth.uid()) AND role = 'staff' AND COALESCE(is_active, true)
  )
$$;

CREATE OR REPLACE FUNCTION security.can_access_all_merchants()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchants
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin','super_admin','staff')
      AND COALESCE(is_active, true)
  )
$$;

CREATE OR REPLACE FUNCTION security.current_has_merchant_permission(p_permission text)
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
        m.role IN ('merchant','admin','super_admin')
        OR (
          m.role = 'employee'
          AND CASE jsonb_typeof(COALESCE(m.permissions, '{}'::jsonb))
            WHEN 'object' THEN COALESCE(m.permissions ->> p_permission, 'false') = 'true'
            WHEN 'array' THEN COALESCE(m.permissions, '[]'::jsonb) ? p_permission
            ELSE false
          END
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION security.current_has_any_merchant_permission(p_permissions text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(bool_or(security.current_has_merchant_permission(permission)), false)
  FROM unnest(p_permissions) permission
$$;

REVOKE ALL ON FUNCTION security.is_platform_staff_account() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.can_access_all_merchants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.current_has_merchant_permission(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.current_has_any_merchant_permission(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.is_platform_staff_account() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.can_access_all_merchants() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.current_has_merchant_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.current_has_any_merchant_permission(text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION security.has_merchant_permission(p_merchant_code text, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT security.can_access_merchant(p_merchant_code)
     AND (
       security.has_platform_permission(p_permission)
       OR security.current_has_merchant_permission(p_permission)
     )
$$;

-- Tenant boundary: the two no-argument helpers become Postgres init plans
-- because each is wrapped in SELECT, so they are evaluated once per query.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass relation_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND c.relname <> 'merchants'
      AND a.attname = 'merchant_code'
      AND NOT a.attisdropped
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_boundary ON %s', r.relation_name);
    EXECUTE format(
      'CREATE POLICY tenant_boundary ON %s AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT security.can_access_all_merchants()) OR merchant_code = (SELECT public.current_merchant_code())) WITH CHECK ((SELECT security.can_access_all_merchants()) OR merchant_code = (SELECT public.current_merchant_code()))',
      r.relation_name
    );
  END LOOP;
END
$$;

-- Exact merchant-team and platform-staff mappings. Platform staff are checked
-- against their administration permission array; merchants/employees are
-- checked against the store-section permission namespace.
DO $$
DECLARE
  r record;
  read_expr text;
  write_expr text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('orders', ARRAY['orders','dashboard']::text[], 'orders', ARRAY['view_merchants','view_files']::text[], ARRAY['upload_files']::text[]),
    ('order_items', ARRAY['orders','dashboard']::text[], 'orders', ARRAY['view_merchants','view_files']::text[], ARRAY['upload_files']::text[]),
    ('products', ARRAY['products','dashboard']::text[], 'products', ARRAY['view_merchants','view_files']::text[], ARRAY['upload_files','edit_merchants']::text[]),
    ('product_platform_listings', ARRAY['products','dashboard']::text[], 'products', ARRAY['view_merchants','view_files']::text[], ARRAY['upload_files','edit_merchants']::text[]),
    ('product_platform_prices', ARRAY['products','dashboard']::text[], 'products', ARRAY['view_merchants','view_finance']::text[], ARRAY['upload_files','edit_merchants']::text[]),
    ('product_performance_snapshots', ARRAY['products','dashboard']::text[], 'products', ARRAY['view_merchants','view_files']::text[], ARRAY['upload_files']::text[]),
    ('price_change_log', ARRAY['products']::text[], 'products', ARRAY['view_merchants']::text[], ARRAY['edit_merchants']::text[]),
    ('inventory', ARRAY['inventory','dashboard']::text[], 'inventory', ARRAY['view_merchants','view_files','manage_inbound']::text[], ARRAY['upload_files','manage_inbound']::text[]),
    ('goods_received', ARRAY['inventory','dashboard']::text[], 'inventory', ARRAY['view_files','manage_inbound']::text[], ARRAY['upload_files','manage_inbound']::text[]),
    ('inbound_shipments', ARRAY['inventory','dashboard']::text[], 'inventory', ARRAY['view_files','manage_inbound']::text[], ARRAY['upload_files','manage_inbound']::text[]),
    ('inbound_shipment_items', ARRAY['inventory','dashboard']::text[], 'inventory', ARRAY['view_files','manage_inbound']::text[], ARRAY['upload_files','manage_inbound']::text[]),
    ('performance_data', ARRAY['dashboard','statement','marketing']::text[], 'dashboard', ARRAY['view_merchants','view_finance','manage_ads','view_files']::text[], ARRAY['upload_files']::text[]),
    ('ad_metrics', ARRAY['marketing','dashboard']::text[], 'marketing', ARRAY['manage_ads']::text[], ARRAY['manage_ads','upload_files']::text[]),
    ('budget_alerts', ARRAY['marketing','dashboard']::text[], 'marketing', ARRAY['manage_ads']::text[], ARRAY['manage_ads','upload_files']::text[]),
    ('returns', ARRAY['orders','statement','dashboard']::text[], 'orders', ARRAY['view_merchants','view_finance','view_files']::text[], ARRAY['upload_files']::text[]),
    ('account_transactions', ARRAY['statement','dashboard']::text[], 'statement', ARRAY['view_finance','upload_files']::text[], ARRAY['upload_files','edit_billing']::text[]),
    ('merchant_payout_schedule', ARRAY['statement','dashboard']::text[], 'statement', ARRAY['view_finance']::text[], ARRAY['edit_billing']::text[]),
    ('amazon_daily_sales', ARRAY['statement','dashboard']::text[], 'statement', ARRAY['view_finance','view_files']::text[], ARRAY['upload_files']::text[]),
    ('platform_file_uploads', ARRAY['integrations']::text[], 'integrations', ARRAY['view_files','upload_files','delete_files']::text[], ARRAY['upload_files','delete_files']::text[]),
    ('sync_queue', ARRAY['integrations']::text[], 'integrations', ARRAY['view_files','upload_files']::text[], ARRAY['upload_files']::text[]),
    ('sync_logs', ARRAY['integrations']::text[], 'integrations', ARRAY['view_files']::text[], ARRAY['upload_files']::text[]),
    ('sync_requests', ARRAY['integrations']::text[], 'integrations', ARRAY['view_files','upload_files']::text[], ARRAY['upload_files']::text[]),
    ('import_diagnostics', ARRAY['integrations']::text[], 'integrations', ARRAY['view_files','upload_files']::text[], ARRAY['upload_files']::text[]),
    ('marketplace_action_logs', ARRAY['integrations']::text[], 'integrations', ARRAY['view_files','view_audit']::text[], ARRAY['upload_files']::text[]),
    ('platform_deals', ARRAY['products','integrations']::text[], 'products', ARRAY['view_merchants','view_files']::text[], ARRAY['upload_files','edit_merchants']::text[]),
    ('ai_insights', ARRAY['dashboard']::text[], 'dashboard', ARRAY[]::text[], ARRAY[]::text[]),
    ('notifications', ARRAY['dashboard']::text[], 'dashboard', ARRAY[]::text[], ARRAY[]::text[]),
    ('sales_targets', ARRAY['dashboard']::text[], 'dashboard', ARRAY['view_merchants']::text[], ARRAY['edit_merchants']::text[])
  ) AS map(table_name, merchant_read, merchant_write, staff_read, staff_write)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN CONTINUE; END IF;

    read_expr := format(
      '((SELECT security.has_any_platform_permission(%L::text[])) OR ((NOT (SELECT security.is_platform_staff_account())) AND (SELECT security.current_has_any_merchant_permission(%L::text[]))))',
      r.staff_read, r.merchant_read
    );
    write_expr := format(
      '((SELECT security.has_any_platform_permission(%L::text[])) OR ((NOT (SELECT security.is_platform_staff_account())) AND (SELECT security.current_has_merchant_permission(%L))))',
      r.staff_write, r.merchant_write
    );

    EXECUTE format('DROP POLICY IF EXISTS platform_staff_permission_select ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_read ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_select_boundary ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_insert_boundary ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_update_boundary ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS merchant_permission_delete_boundary ON public.%I', r.table_name);

    EXECUTE format('CREATE POLICY merchant_permission_read ON public.%I FOR SELECT TO authenticated USING (%s)', r.table_name, read_expr);
    EXECUTE format('CREATE POLICY merchant_permission_select_boundary ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', r.table_name, read_expr);
    EXECUTE format('CREATE POLICY merchant_permission_insert_boundary ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', r.table_name, write_expr);
    EXECUTE format('CREATE POLICY merchant_permission_update_boundary ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.table_name, write_expr, write_expr);
    EXECUTE format('CREATE POLICY merchant_permission_delete_boundary ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', r.table_name, write_expr);
  END LOOP;
END
$$;

-- No-argument platform helpers in non-row-dependent policies are init plans.
DROP POLICY IF EXISTS platform_staff_read_merchants ON public.merchants;
CREATE POLICY platform_staff_read_merchants ON public.merchants FOR SELECT TO authenticated
USING ((SELECT security.has_any_platform_permission(ARRAY[
  'view_merchants','edit_merchants','create_merchants','delete_merchants',
  'impersonate','create_staff','tasks','crm'
])));

DROP POLICY IF EXISTS platform_staff_update_merchants ON public.merchants;
CREATE POLICY platform_staff_update_merchants ON public.merchants FOR UPDATE TO authenticated
USING (
  (role = 'merchant' AND (SELECT security.has_platform_permission('edit_merchants')))
  OR (role = 'staff' AND (SELECT security.has_platform_permission('create_staff')))
)
WITH CHECK (
  (role = 'merchant' AND (SELECT security.has_platform_permission('edit_merchants')))
  OR (role = 'staff' AND (SELECT security.has_platform_permission('create_staff')))
);
