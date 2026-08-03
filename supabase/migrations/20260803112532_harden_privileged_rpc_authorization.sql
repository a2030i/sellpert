-- Privileged RPCs must authorize by the immutable auth user id, require an
-- active account, and enforce the same permission vocabulary as the UI.

CREATE OR REPLACE FUNCTION public.is_admin()
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

CREATE OR REPLACE FUNCTION public.get_db_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT security.has_platform_permission('view_db_health') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  RETURN public.get_db_health_internal();
END
$$;

CREATE OR REPLACE FUNCTION public.my_employees()
RETURNS TABLE(
  id uuid,
  merchant_code text,
  name text,
  email text,
  whatsapp_phone text,
  job_title text,
  permissions jsonb,
  is_active boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT employee.id, employee.merchant_code, employee.name, employee.email,
         employee.whatsapp_phone, employee.job_title, employee.permissions,
         employee.is_active, employee.created_at
  FROM public.merchants employee
  JOIN public.merchants owner
    ON owner.id = (SELECT auth.uid())
   AND owner.role = 'merchant'
   AND COALESCE(owner.is_active, true)
   AND employee.owner_merchant_code = owner.merchant_code
  WHERE employee.role = 'employee'
  ORDER BY employee.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.update_employee(
  p_employee_code text,
  p_permissions jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_job_title text DEFAULT NULL,
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_code text;
BEGIN
  SELECT merchant_code INTO v_owner_code
  FROM public.merchants
  WHERE id = (SELECT auth.uid())
    AND role = 'merchant'
    AND COALESCE(is_active, true);

  IF v_owner_code IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_permissions IS NOT NULL AND (
    jsonb_typeof(p_permissions) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM jsonb_each(p_permissions) permission(key, value)
      WHERE permission.key NOT IN (
        'dashboard', 'orders', 'products', 'inventory', 'marketing',
        'statement', 'integrations', 'settings'
      )
      OR jsonb_typeof(permission.value) <> 'boolean'
    )
  ) THEN
    RAISE EXCEPTION 'invalid permissions' USING errcode = '22023';
  END IF;

  IF p_job_title IS NOT NULL AND length(trim(p_job_title)) > 100 THEN
    RAISE EXCEPTION 'invalid job title' USING errcode = '22023';
  END IF;
  IF p_name IS NOT NULL AND (length(trim(p_name)) < 2 OR length(trim(p_name)) > 120) THEN
    RAISE EXCEPTION 'invalid employee name' USING errcode = '22023';
  END IF;

  UPDATE public.merchants
  SET permissions = COALESCE(p_permissions, permissions),
      is_active = COALESCE(p_is_active, is_active),
      job_title = CASE WHEN p_job_title IS NULL THEN job_title ELSE NULLIF(trim(p_job_title), '') END,
      name = CASE WHEN p_name IS NULL THEN name ELSE trim(p_name) END,
      updated_at = now()
  WHERE merchant_code = p_employee_code
    AND role = 'employee'
    AND owner_merchant_code = v_owner_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'employee not found' USING errcode = 'P0002';
  END IF;

  RETURN jsonb_build_object('ok', true);
END
$$;

CREATE OR REPLACE FUNCTION public.delete_employee(p_employee_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_code text;
  v_employee_id uuid;
BEGIN
  SELECT merchant_code INTO v_owner_code
  FROM public.merchants
  WHERE id = (SELECT auth.uid())
    AND role = 'merchant'
    AND COALESCE(is_active, true);

  IF v_owner_code IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT id INTO v_employee_id
  FROM public.merchants
  WHERE merchant_code = p_employee_code
    AND role = 'employee'
    AND owner_merchant_code = v_owner_code;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'employee not found' USING errcode = 'P0002';
  END IF;

  DELETE FROM public.merchants WHERE id = v_employee_id;
  RETURN jsonb_build_object('ok', true, 'auth_id', v_employee_id);
END
$$;

CREATE OR REPLACE FUNCTION public.wipe_merchant_data(p_merchant_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  IF NOT security.has_platform_permission('delete_merchants') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchants
    WHERE merchant_code = p_merchant_code AND role = 'merchant'
  ) THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.platform_file_uploads
  WHERE merchant_code = p_merchant_code;
  v_deleted := v_deleted || jsonb_build_object('uploads', v_count);

  DELETE FROM public.platform_file_uploads WHERE merchant_code = p_merchant_code;
  DELETE FROM public.orders WHERE merchant_code = p_merchant_code;
  DELETE FROM public.products WHERE merchant_code = p_merchant_code;
  DELETE FROM public.inventory WHERE merchant_code = p_merchant_code;
  DELETE FROM public.account_transactions WHERE merchant_code = p_merchant_code;
  DELETE FROM public.ad_metrics WHERE merchant_code = p_merchant_code;
  DELETE FROM public.returns WHERE merchant_code = p_merchant_code;
  DELETE FROM public.goods_received WHERE merchant_code = p_merchant_code;
  DELETE FROM public.platform_deals WHERE merchant_code = p_merchant_code;
  DELETE FROM public.product_performance_snapshots WHERE merchant_code = p_merchant_code;
  DELETE FROM public.inbound_shipment_items
  WHERE upload_id IS NULL
    AND shipment_id IN (
      SELECT id FROM public.inbound_shipments WHERE merchant_code = p_merchant_code
    );
  DELETE FROM public.inbound_shipments WHERE merchant_code = p_merchant_code;
  DELETE FROM public.performance_data WHERE merchant_code = p_merchant_code;

  RETURN v_deleted;
END
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_db_health() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_employees() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_employee(text, jsonb, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_employee(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wipe_merchant_data(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_db_health() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_employees() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_employee(text, jsonb, boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_employee(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wipe_merchant_data(text) TO authenticated, service_role;
