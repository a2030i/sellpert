-- Multi-workspace access must be granted to an immutable Auth identity, not
-- inferred from an email address that can change or be reused.
ALTER TABLE public.merchant_account_links
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.merchant_account_links link
SET user_id = users.id
FROM auth.users users
WHERE link.user_id IS NULL
  AND lower(link.email) = lower(users.email);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_account_links_user_merchant_uidx
  ON public.merchant_account_links (user_id, merchant_code)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS merchant_account_links_user_default_idx
  ON public.merchant_account_links (user_id, is_default DESC, merchant_code)
  WHERE user_id IS NOT NULL;

REVOKE ALL ON TABLE public.merchant_account_links FROM anon, authenticated;
GRANT ALL ON TABLE public.merchant_account_links TO service_role;

CREATE OR REPLACE FUNCTION security.current_accessible_merchant_codes()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(accessible.merchant_code ORDER BY accessible.merchant_code), ARRAY[]::text[])
  FROM (
    SELECT member.merchant_code
    FROM public.merchants member
    WHERE member.id = (SELECT auth.uid())
      AND COALESCE(member.is_active, true)
      AND member.role = 'merchant'

    UNION

    SELECT target.merchant_code
    FROM public.merchants member
    JOIN public.merchant_account_links link
      ON link.user_id = member.id
    JOIN public.merchants target
      ON target.merchant_code = link.merchant_code
     AND target.role = 'merchant'
     AND COALESCE(target.is_active, true)
    WHERE member.id = (SELECT auth.uid())
      AND member.role = 'merchant'
      AND COALESCE(member.is_active, true)

    UNION

    SELECT owner.merchant_code
    FROM public.merchants member
    JOIN public.merchants owner
      ON owner.merchant_code = member.owner_merchant_code
     AND owner.role = 'merchant'
     AND COALESCE(owner.is_active, true)
    WHERE member.id = (SELECT auth.uid())
      AND member.role = 'employee'
      AND COALESCE(member.is_active, true)
  ) accessible
$$;

CREATE OR REPLACE FUNCTION security.can_access_merchant(p_merchant_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT security.can_access_all_merchants()
      OR p_merchant_code = ANY(security.current_accessible_merchant_codes())
$$;

REVOKE ALL ON FUNCTION security.current_accessible_merchant_codes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.can_access_merchant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.current_accessible_merchant_codes() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.can_access_merchant(text) TO authenticated, service_role;

-- Rebuild the shared restrictive tenant boundary so explicit links are
-- honored consistently by every tenant table, while unlinked stores remain
-- inaccessible.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'tenant_boundary'
  LOOP
    EXECUTE format('DROP POLICY tenant_boundary ON %I.%I', target.schemaname, target.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_boundary ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (security.can_access_merchant(merchant_code)) WITH CHECK (security.can_access_merchant(merchant_code))',
      target.schemaname,
      target.tablename
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.my_linked_merchants()
RETURNS TABLE(
  merchant_code text,
  name text,
  role text,
  is_default boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH member AS (
    SELECT identity.id, identity.merchant_code
    FROM public.merchants identity
    WHERE identity.id = (SELECT auth.uid())
      AND identity.role = 'merchant'
      AND COALESCE(identity.is_active, true)
  ),
  accessible AS (
    SELECT own.merchant_code, own.name, own.role, true AS is_default
    FROM member
    JOIN public.merchants own ON own.merchant_code = member.merchant_code

    UNION ALL

    SELECT target.merchant_code, target.name, target.role, COALESCE(link.is_default, false)
    FROM member
    JOIN public.merchant_account_links link ON link.user_id = member.id
    JOIN public.merchants target
      ON target.merchant_code = link.merchant_code
     AND target.role = 'merchant'
     AND COALESCE(target.is_active, true)
    WHERE target.merchant_code <> member.merchant_code
  )
  SELECT accessible.merchant_code, accessible.name, accessible.role, accessible.is_default
  FROM accessible
  ORDER BY accessible.is_default DESC, accessible.name
$$;

CREATE OR REPLACE FUNCTION public.my_owner_merchant()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT owner.merchant_code
  FROM public.merchants employee
  JOIN public.merchants owner
    ON owner.merchant_code = employee.owner_merchant_code
   AND owner.role = 'merchant'
   AND COALESCE(owner.is_active, true)
  WHERE employee.id = (SELECT auth.uid())
    AND employee.role = 'employee'
    AND COALESCE(employee.is_active, true)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.my_linked_merchants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_owner_merchant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_linked_merchants() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_owner_merchant() TO authenticated, service_role;

-- Direct UPDATE remains available for existing admin screens and onboarding,
-- but this trigger blocks identity, role, ownership and billing escalation.
CREATE OR REPLACE FUNCTION security.guard_merchant_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor public.merchants%ROWTYPE;
  safe_profile_columns text[] := ARRAY[
    'name', 'whatsapp_phone', 'logo_url', 'onboarding_done',
    'currency', 'sector', 'sub_sector'
  ];
  staff_columns text[] := ARRAY[
    'name', 'whatsapp_phone', 'logo_url', 'department',
    'permissions', 'is_active', 'job_title'
  ];
  employee_columns text[] := ARRAY[
    'name', 'whatsapp_phone', 'permissions', 'is_active', 'job_title'
  ];
BEGIN
  IF COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO actor
  FROM public.merchants
  WHERE id = (SELECT auth.uid())
    AND COALESCE(is_active, true);

  IF actor.id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF actor.role IN ('admin', 'super_admin') THEN
    IF actor.role <> 'super_admin'
       AND (OLD.role = 'super_admin' OR NEW.role = 'super_admin') THEN
      RAISE EXCEPTION 'forbidden' USING errcode = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF actor.role = 'staff' THEN
    IF OLD.role = 'merchant'
       AND security.has_platform_permission('edit_merchants')
       AND (to_jsonb(NEW) - staff_columns) = (to_jsonb(OLD) - staff_columns) THEN
      RETURN NEW;
    END IF;
    IF OLD.role IN ('staff', 'employee')
       AND security.has_platform_permission('create_staff')
       AND NEW.role = OLD.role
       AND (to_jsonb(NEW) - staff_columns) = (to_jsonb(OLD) - staff_columns) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF actor.role = 'merchant'
     AND OLD.role = 'employee'
     AND NEW.role = 'employee'
     AND OLD.owner_merchant_code = actor.merchant_code
     AND NEW.owner_merchant_code = OLD.owner_merchant_code
     AND (to_jsonb(NEW) - employee_columns) = (to_jsonb(OLD) - employee_columns) THEN
    RETURN NEW;
  END IF;

  IF security.has_merchant_permission(OLD.merchant_code, 'settings')
     AND NEW.merchant_code = OLD.merchant_code
     AND (to_jsonb(NEW) - safe_profile_columns) = (to_jsonb(OLD) - safe_profile_columns) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'forbidden' USING errcode = '42501';
END
$$;

DROP TRIGGER IF EXISTS guard_merchant_update_trigger ON public.merchants;
CREATE TRIGGER guard_merchant_update_trigger
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION security.guard_merchant_update();

REVOKE ALL ON FUNCTION security.guard_merchant_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.guard_merchant_update() TO service_role;

DROP POLICY IF EXISTS sellpert_select_access ON public.merchants;
CREATE POLICY sellpert_select_access
ON public.merchants
FOR SELECT
TO authenticated
USING (
  id = (SELECT auth.uid())
  OR security.can_access_merchant(merchant_code)
  OR public.is_admin()
  OR public.is_staff()
  OR security.has_any_platform_permission(ARRAY[
    'view_merchants', 'edit_merchants', 'create_merchants',
    'delete_merchants', 'impersonate', 'create_staff', 'tasks', 'crm'
  ])
);

DROP POLICY IF EXISTS sellpert_update_access ON public.merchants;
CREATE POLICY sellpert_update_access
ON public.merchants
FOR UPDATE
TO authenticated
USING (
  security.can_access_merchant(merchant_code)
  OR public.is_admin()
  OR security.has_platform_permission('edit_merchants')
  OR security.has_platform_permission('create_staff')
)
WITH CHECK (
  security.can_access_merchant(merchant_code)
  OR public.is_admin()
  OR security.has_platform_permission('edit_merchants')
  OR security.has_platform_permission('create_staff')
);

DROP FUNCTION IF EXISTS public.update_my_store_profile(text, text, text);
CREATE FUNCTION public.update_my_store_profile(
  p_name text DEFAULT NULL,
  p_whatsapp_phone text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_merchant_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_code text;
  v_result jsonb;
BEGIN
  v_merchant_code := COALESCE(NULLIF(btrim(p_merchant_code), ''), public.current_merchant_code());
  IF v_merchant_code IS NULL
     OR NOT security.has_merchant_permission(v_merchant_code, 'settings') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_name IS NOT NULL AND (length(btrim(p_name)) < 2 OR length(btrim(p_name)) > 120) THEN
    RAISE EXCEPTION 'invalid store name' USING errcode = '22023';
  END IF;
  IF p_whatsapp_phone IS NOT NULL AND length(btrim(p_whatsapp_phone)) > 32 THEN
    RAISE EXCEPTION 'invalid phone' USING errcode = '22023';
  END IF;
  IF p_logo_url IS NOT NULL AND (
    length(p_logo_url) > 2048 OR p_logo_url !~ '^https://'
  ) THEN
    RAISE EXCEPTION 'invalid logo url' USING errcode = '22023';
  END IF;

  UPDATE public.merchants
  SET name = COALESCE(NULLIF(btrim(p_name), ''), name),
      whatsapp_phone = CASE
        WHEN p_whatsapp_phone IS NULL THEN whatsapp_phone
        ELSE NULLIF(btrim(p_whatsapp_phone), '')
      END,
      logo_url = COALESCE(p_logo_url, logo_url)
  WHERE merchant_code = v_merchant_code
    AND role = 'merchant'
  RETURNING jsonb_build_object(
    'id', id,
    'merchant_code', merchant_code,
    'name', name,
    'email', email,
    'whatsapp_phone', whatsapp_phone,
    'logo_url', logo_url
  ) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'merchant not found' USING errcode = 'P0002';
  END IF;
  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION public.update_my_store_profile(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_store_profile(text, text, text, text) TO authenticated, service_role;
