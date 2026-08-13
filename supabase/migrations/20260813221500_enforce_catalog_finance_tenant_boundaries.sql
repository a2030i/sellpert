-- Keep every merchant-owned catalog and finance row inside the authenticated
-- user's accessible workspace. Permissive feature policies still decide which
-- operations are allowed, while this restrictive policy is the shared tenant
-- isolation backstop used across the Sellpert data API.

DROP POLICY IF EXISTS tenant_boundary
  ON public.product_channel_mappings;
CREATE POLICY tenant_boundary
  ON public.product_channel_mappings
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT security.can_access_merchant(merchant_code)))
  WITH CHECK ((SELECT security.can_access_merchant(merchant_code)));

DROP POLICY IF EXISTS tenant_boundary
  ON public.merchant_platform_finance_settings;
CREATE POLICY tenant_boundary
  ON public.merchant_platform_finance_settings
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT security.can_access_merchant(merchant_code)))
  WITH CHECK ((SELECT security.can_access_merchant(merchant_code)));

DROP POLICY IF EXISTS tenant_boundary
  ON public.merchant_contract_terms;
CREATE POLICY tenant_boundary
  ON public.merchant_contract_terms
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT security.can_access_merchant(merchant_code)))
  WITH CHECK ((SELECT security.can_access_merchant(merchant_code)));

COMMENT ON POLICY tenant_boundary
  ON public.product_channel_mappings IS
  'Restrictive workspace boundary shared by all merchant-owned data.';
COMMENT ON POLICY tenant_boundary
  ON public.merchant_platform_finance_settings IS
  'Restrictive workspace boundary shared by all merchant-owned data.';
COMMENT ON POLICY tenant_boundary
  ON public.merchant_contract_terms IS
  'Restrictive workspace boundary shared by all merchant-owned data.';
