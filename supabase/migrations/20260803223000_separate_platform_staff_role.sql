-- Platform staff and merchant employees are different security principals.
-- Merchant employees are tenant-bound and use object permissions; platform
-- staff use an allow-listed array of administration permissions.

CREATE OR REPLACE FUNCTION security.has_platform_permission(p_permission text)
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
        OR (
          m.role = 'staff'
          AND jsonb_typeof(COALESCE(m.permissions, '[]'::jsonb)) = 'array'
          AND COALESCE(m.permissions, '[]'::jsonb) ? p_permission
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION security.has_platform_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.has_platform_permission(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION security.has_any_platform_permission(p_permissions text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(bool_or(security.has_platform_permission(permission)), false)
  FROM unnest(p_permissions) permission
$$;

REVOKE ALL ON FUNCTION security.has_any_platform_permission(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.has_any_platform_permission(text[]) TO authenticated, service_role;

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
        OR m.role = 'staff'
        OR (m.role = 'employee' AND m.owner_merchant_code = p_merchant_code)
        OR (m.role = 'merchant' AND m.merchant_code = p_merchant_code)
      )
  )
$$;

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
        OR (
          m.role = 'staff'
          AND CASE p_permission
            WHEN 'dashboard' THEN security.has_platform_permission('upload_files')
            WHEN 'marketing' THEN security.has_any_platform_permission(ARRAY['manage_ads','upload_files'])
            WHEN 'statement' THEN security.has_any_platform_permission(ARRAY['view_finance','upload_files'])
            WHEN 'integrations' THEN security.has_any_platform_permission(ARRAY['view_files','upload_files','delete_files'])
            WHEN 'inventory' THEN security.has_any_platform_permission(ARRAY['view_merchants','upload_files','manage_inbound'])
            WHEN 'settings' THEN security.has_platform_permission('edit_merchants')
            WHEN 'team' THEN security.has_platform_permission('create_staff')
            ELSE security.has_any_platform_permission(ARRAY['view_merchants','upload_files'])
          END
        )
      )
  )
$$;

-- A staff account must always be able to load its own identity row. Broader
-- merchant access is granted only when a matching administration permission
-- exists.
DROP POLICY IF EXISTS platform_staff_select_own ON public.merchants;
CREATE POLICY platform_staff_select_own ON public.merchants
FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) AND role = 'staff');

DROP POLICY IF EXISTS platform_staff_read_merchants ON public.merchants;
CREATE POLICY platform_staff_read_merchants ON public.merchants
FOR SELECT TO authenticated
USING (security.has_any_platform_permission(ARRAY[
  'view_merchants','edit_merchants','create_merchants','delete_merchants',
  'impersonate','create_staff','tasks','crm'
]));

DROP POLICY IF EXISTS platform_staff_update_merchants ON public.merchants;
CREATE POLICY platform_staff_update_merchants ON public.merchants
FOR UPDATE TO authenticated
USING (
  (role = 'merchant' AND security.has_platform_permission('edit_merchants'))
  OR (role = 'staff' AND security.has_platform_permission('create_staff'))
)
WITH CHECK (
  (role = 'merchant' AND security.has_platform_permission('edit_merchants'))
  OR (role = 'staff' AND security.has_platform_permission('create_staff'))
);

DROP POLICY IF EXISTS platform_staff_delete_merchants ON public.merchants;
CREATE POLICY platform_staff_delete_merchants ON public.merchants
FOR DELETE TO authenticated
USING (
  (role = 'merchant' AND security.has_platform_permission('delete_merchants'))
  OR (role = 'staff' AND id <> (SELECT auth.uid()) AND security.has_platform_permission('create_staff'))
);

-- Read policies used by the administration console. Each table is explicitly
-- mapped to its smallest useful permission; an unknown table receives no
-- platform-staff access.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('performance_data', ARRAY['view_merchants','view_finance','manage_ads','view_files']::text[]),
    ('orders', ARRAY['view_merchants','view_files']::text[]),
    ('order_items', ARRAY['view_merchants','view_files']::text[]),
    ('products', ARRAY['view_merchants','view_files']::text[]),
    ('product_platform_prices', ARRAY['view_merchants','view_finance']::text[]),
    ('product_platform_listings', ARRAY['view_merchants']::text[]),
    ('inventory', ARRAY['view_merchants','view_files','manage_inbound']::text[]),
    ('returns', ARRAY['view_merchants','view_finance','view_files']::text[]),
    ('account_transactions', ARRAY['view_finance','view_files']::text[]),
    ('merchant_payout_schedule', ARRAY['view_finance']::text[]),
    ('platform_file_uploads', ARRAY['view_files','upload_files','delete_files']::text[]),
    ('import_diagnostics', ARRAY['view_files','upload_files']::text[]),
    ('inbound_shipments', ARRAY['manage_inbound','view_files']::text[]),
    ('inbound_shipment_items', ARRAY['manage_inbound','view_files']::text[]),
    ('goods_received', ARRAY['manage_inbound','view_files']::text[]),
    ('ad_metrics', ARRAY['manage_ads']::text[]),
    ('budget_alerts', ARRAY['manage_ads']::text[]),
    ('merchant_requests', ARRAY['tasks','crm','whatsapp_send','whatsapp_bulk']::text[]),
    ('task_comments', ARRAY['tasks','crm']::text[]),
    ('merchant_notes', ARRAY['crm']::text[]),
    ('nps_responses', ARRAY['crm','tasks']::text[]),
    ('audit_log', ARRAY['view_audit']::text[]),
    ('payment_requests', ARRAY['view_finance','edit_billing']::text[]),
    ('subscriptions', ARRAY['view_finance','manage_subscriptions']::text[]),
    ('sync_queue', ARRAY['view_files','upload_files']::text[]),
    ('sync_logs', ARRAY['view_files']::text[]),
    ('sync_requests', ARRAY['view_files','upload_files']::text[]),
    ('marketplace_action_logs', ARRAY['view_files','view_audit']::text[])
  ) AS map(table_name, permissions)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS platform_staff_permission_select ON public.%I', r.table_name);
    EXECUTE format(
      'CREATE POLICY platform_staff_permission_select ON public.%I FOR SELECT TO authenticated USING (security.has_any_platform_permission(%L::text[]))',
      r.table_name, r.permissions
    );
  END LOOP;
END
$$;

-- Explicit mutation grants. Restrictive tenant/section policies continue to
-- apply on tables that carry merchant_code.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('platform_file_uploads', 'upload_files'),
    ('import_diagnostics', 'upload_files'),
    ('orders', 'upload_files'),
    ('order_items', 'upload_files'),
    ('products', 'upload_files'),
    ('inventory', 'upload_files'),
    ('returns', 'upload_files'),
    ('performance_data', 'upload_files'),
    ('account_transactions', 'upload_files'),
    ('inbound_shipments', 'manage_inbound'),
    ('inbound_shipment_items', 'manage_inbound'),
    ('goods_received', 'manage_inbound'),
    ('ad_metrics', 'manage_ads'),
    ('budget_alerts', 'manage_ads'),
    ('merchant_requests', 'tasks'),
    ('task_comments', 'tasks'),
    ('merchant_notes', 'crm'),
    ('payment_requests', 'edit_billing'),
    ('merchant_payout_schedule', 'edit_billing'),
    ('product_platform_prices', 'edit_merchants')
  ) AS map(table_name, permission)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS platform_staff_permission_insert ON public.%I', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS platform_staff_permission_update ON public.%I', r.table_name);
    EXECUTE format(
      'CREATE POLICY platform_staff_permission_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (security.has_platform_permission(%L))',
      r.table_name, r.permission
    );
    EXECUTE format(
      'CREATE POLICY platform_staff_permission_update ON public.%I FOR UPDATE TO authenticated USING (security.has_platform_permission(%L)) WITH CHECK (security.has_platform_permission(%L))',
      r.table_name, r.permission, r.permission
    );
  END LOOP;

  IF to_regclass('public.platform_file_uploads') IS NOT NULL THEN
    DROP POLICY IF EXISTS platform_staff_permission_delete ON public.platform_file_uploads;
    CREATE POLICY platform_staff_permission_delete ON public.platform_file_uploads
    FOR DELETE TO authenticated USING (security.has_platform_permission('delete_files'));
  END IF;
END
$$;
