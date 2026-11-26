-- Tables added after the shared boundary migrations need the same restrictive
-- guards. This migration grants no access and preserves every existing
-- permissive policy, server-only grant boundary, and provider write path.
-- Requires the Omniful and 20260828083527_pricing_requests migrations first.

DO $remaining_mfa_boundaries$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'omniful_account_credentials',
    'omniful_channel_assignments',
    'omniful_channels',
    'omniful_provider_accounts',
    'service_request_activities',
    'service_request_forms',
    'service_request_questions',
    'service_request_stages',
    'service_request_submissions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name
        AND c.relkind IN ('r', 'p') AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'Required RLS table public.% is missing or unprotected', table_name;
    END IF;

    EXECUTE format(
      'CREATE POLICY sellpert_require_mfa_if_enrolled ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT security.mfa_access_allowed())) WITH CHECK ((SELECT security.mfa_access_allowed()))',
      table_name
    );
  END LOOP;
END
$remaining_mfa_boundaries$;

DO $remaining_tenant_boundaries$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'omniful_account_credentials',
    'omniful_channel_assignments'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT security.can_access_merchant(merchant_code))) WITH CHECK ((SELECT security.can_access_merchant(merchant_code)))',
      table_name
    );
  END LOOP;
END
$remaining_tenant_boundaries$;
