-- merchants intentionally has no updated_at column. Keep the hardened
-- authorization and validation from the previous migration while matching
-- the deployed table contract exactly.
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
      name = CASE WHEN p_name IS NULL THEN name ELSE trim(p_name) END
  WHERE merchant_code = p_employee_code
    AND role = 'employee'
    AND owner_merchant_code = v_owner_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'employee not found' USING errcode = 'P0002';
  END IF;

  RETURN jsonb_build_object('ok', true);
END
$$;
