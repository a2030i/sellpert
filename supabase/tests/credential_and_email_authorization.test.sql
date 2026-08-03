-- Static regression checks for immutable identity authorization and the
-- server-only credential vault surface.
BEGIN;

DO $$
DECLARE
  email_policy_count integer;
BEGIN
  IF has_table_privilege('authenticated', 'public.platform_credentials', 'SELECT')
     OR has_table_privilege('authenticated', 'public.platform_credentials', 'INSERT')
     OR has_table_privilege('authenticated', 'public.platform_credentials', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.platform_credentials', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated retains direct platform credential access';
  END IF;

  IF has_table_privilege('authenticated', 'public.merchant_platform_mappings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.merchant_account_links', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated retains direct integration metadata access';
  END IF;

  SELECT count(*) INTO email_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      COALESCE(qual, '') ILIKE '%auth.email%'
      OR COALESCE(with_check, '') ILIKE '%auth.email%'
      OR COALESCE(qual, '') ILIKE '%auth.jwt%email%'
      OR COALESCE(with_check, '') ILIKE '%auth.jwt%email%'
    );
  IF email_policy_count <> 0 THEN
    RAISE EXCEPTION 'email-derived authorization policies remain: %', email_policy_count;
  END IF;

  IF has_function_privilege('authenticated', 'security.write_audit_log()', 'EXECUTE') THEN
    RAISE EXCEPTION 'audit trigger function is directly executable';
  END IF;
END
$$;

ROLLBACK;
