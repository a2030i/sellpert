-- Keep the opt-in MFA authorization boundary complete as new public RLS
-- tables are added. Users who enrolled MFA must present an aal2 session;
-- users who did not enroll MFA retain their normal aal1 access.

DROP POLICY IF EXISTS sellpert_require_mfa_if_enrolled
  ON public.product_channel_mappings;
CREATE POLICY sellpert_require_mfa_if_enrolled
  ON public.product_channel_mappings
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT security.mfa_access_allowed()))
  WITH CHECK ((SELECT security.mfa_access_allowed()));

DROP POLICY IF EXISTS sellpert_require_mfa_if_enrolled
  ON public.merchant_platform_finance_settings;
CREATE POLICY sellpert_require_mfa_if_enrolled
  ON public.merchant_platform_finance_settings
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT security.mfa_access_allowed()))
  WITH CHECK ((SELECT security.mfa_access_allowed()));

DROP POLICY IF EXISTS sellpert_require_mfa_if_enrolled
  ON public.merchant_contract_terms;
CREATE POLICY sellpert_require_mfa_if_enrolled
  ON public.merchant_contract_terms
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT security.mfa_access_allowed()))
  WITH CHECK ((SELECT security.mfa_access_allowed()));

COMMENT ON POLICY sellpert_require_mfa_if_enrolled
  ON public.product_channel_mappings IS
  'Restrictive opt-in MFA boundary layered over normal product catalogue tenant policies.';
COMMENT ON POLICY sellpert_require_mfa_if_enrolled
  ON public.merchant_platform_finance_settings IS
  'Restrictive opt-in MFA boundary layered over normal merchant finance policies.';
COMMENT ON POLICY sellpert_require_mfa_if_enrolled
  ON public.merchant_contract_terms IS
  'Restrictive opt-in MFA boundary layered over normal merchant contract policies.';
