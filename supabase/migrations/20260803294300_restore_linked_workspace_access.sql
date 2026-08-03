-- Preserve explicit multi-workspace links while retaining suspension checks.
-- A link is bound to the immutable Auth user id; email never authorizes access.
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
      AND coalesce(member.is_active, true)
      AND (
        member.role IN ('admin', 'super_admin', 'staff')
        OR (member.role = 'merchant' AND member.merchant_code = p_merchant_code)
        OR (
          member.role = 'merchant'
          AND EXISTS (
            SELECT 1
            FROM public.merchant_account_links link
            JOIN public.merchants target
              ON target.merchant_code = link.merchant_code
             AND target.role = 'merchant'
             AND coalesce(target.is_active, true)
            WHERE link.user_id = member.id
              AND link.merchant_code = p_merchant_code
          )
        )
        OR (
          member.role = 'employee'
          AND member.owner_merchant_code = p_merchant_code
          AND EXISTS (
            SELECT 1
            FROM public.merchants owner
            WHERE owner.merchant_code = member.owner_merchant_code
              AND owner.role = 'merchant'
              AND coalesce(owner.is_active, true)
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION security.can_access_merchant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.can_access_merchant(text) TO authenticated, service_role;

COMMENT ON FUNCTION security.can_access_merchant(text) IS
  'Authorizes active platform staff, own workspaces, immutable explicit links, or active employee-owner relationships.';
