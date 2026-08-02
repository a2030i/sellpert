-- The merchants table stores both login identities and tenant owners, so it
-- needs an identity-aware policy instead of the generic merchant_code fence.
DROP POLICY IF EXISTS tenant_boundary ON public.merchants;

DROP POLICY IF EXISTS employee_select_owner_merchant ON public.merchants;
CREATE POLICY employee_select_owner_merchant
ON public.merchants
FOR SELECT
TO authenticated
USING (
  merchant_code = (SELECT public.current_merchant_code())
);

