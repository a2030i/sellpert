-- Restrictive tenant/permission boundaries do not grant access by themselves;
-- sales_targets also needs a permissive write policy for the merchant goal RPC.
-- The restrictive policies remain the final tenant and section guard.
DROP POLICY IF EXISTS merchant_sales_targets_insert ON public.sales_targets;
CREATE POLICY merchant_sales_targets_insert
ON public.sales_targets
FOR INSERT TO authenticated
WITH CHECK (security.has_merchant_permission(merchant_code, 'dashboard'));

DROP POLICY IF EXISTS merchant_sales_targets_update ON public.sales_targets;
CREATE POLICY merchant_sales_targets_update
ON public.sales_targets
FOR UPDATE TO authenticated
USING (security.has_merchant_permission(merchant_code, 'dashboard'))
WITH CHECK (security.has_merchant_permission(merchant_code, 'dashboard'));

