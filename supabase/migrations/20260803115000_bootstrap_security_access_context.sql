-- Security access helpers required by the first workspace-isolation migration.
-- Later migrations replace these definitions as the authorization model evolves.

CREATE OR REPLACE FUNCTION security.is_platform_staff_account()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.merchants
    WHERE id = (SELECT auth.uid()) AND role = 'staff' AND COALESCE(is_active, true)
  )
$function$;

CREATE OR REPLACE FUNCTION security.can_access_all_merchants()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.merchants
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin','super_admin','staff')
      AND COALESCE(is_active, true)
  )
$function$;

CREATE OR REPLACE FUNCTION security.current_accessible_merchant_codes()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION security.can_access_merchant(p_merchant_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT security.can_access_all_merchants()
      OR p_merchant_code = ANY(security.current_accessible_merchant_codes())
$function$;

CREATE OR REPLACE FUNCTION security.has_platform_permission(p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

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

CREATE OR REPLACE FUNCTION security.current_has_merchant_permission(p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION security.current_has_any_merchant_permission(p_permissions text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(bool_or(security.current_has_merchant_permission(permission)), false)
  FROM unnest(p_permissions) permission
$function$;

CREATE OR REPLACE FUNCTION security.has_merchant_permission(p_merchant_code text, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT security.can_access_merchant(p_merchant_code)
     AND (
       security.has_platform_permission(p_permission)
       OR security.current_has_merchant_permission(p_permission)
     )
$function$;
