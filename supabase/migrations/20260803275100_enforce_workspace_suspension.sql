-- Suspending a merchant workspace must suspend every employee session attached
-- to it.  Previously, an active employee could continue resolving the owner's
-- merchant code even after the owner workspace had been disabled.

CREATE OR REPLACE FUNCTION public.current_merchant_code()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN member.role = 'employee' THEN member.owner_merchant_code
    ELSE member.merchant_code
  END
  FROM public.merchants member
  LEFT JOIN public.merchants owner
    ON member.role = 'employee'
   AND owner.merchant_code = member.owner_merchant_code
   AND owner.role = 'merchant'
  WHERE member.id = (SELECT auth.uid())
    AND COALESCE(member.is_active, true)
    AND (
      member.role <> 'employee'
      OR (owner.id IS NOT NULL AND COALESCE(owner.is_active, true))
    )
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
    FROM public.merchants member
    WHERE member.id = (SELECT auth.uid())
      AND COALESCE(member.is_active, true)
      AND (
        member.role IN ('admin', 'super_admin', 'staff')
        OR (member.role = 'merchant' AND member.merchant_code = p_merchant_code)
        OR (
          member.role = 'employee'
          AND member.owner_merchant_code = p_merchant_code
          AND EXISTS (
            SELECT 1
            FROM public.merchants owner
            WHERE owner.merchant_code = member.owner_merchant_code
              AND owner.role = 'merchant'
              AND COALESCE(owner.is_active, true)
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.current_merchant_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION security.can_access_merchant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_merchant_code() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.can_access_merchant(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.current_merchant_code() IS
  'Returns the active workspace for the signed-in member; suspended owners disable their employees.';
