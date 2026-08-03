-- Direct SQL maintenance and migrations run without an Auth JWT. Permit only
-- trusted database login roles; API callers still require the actor checks.
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
  IF session_user IN ('postgres', 'supabase_admin')
     OR COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role' THEN
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

REVOKE ALL ON FUNCTION security.guard_merchant_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.guard_merchant_update() TO service_role;
