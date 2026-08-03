-- Sellpert is an authenticated SaaS. Registration is handled by Supabase Auth
-- and the merchant profile is created by a protected auth trigger, so browser
-- visitors do not need direct access to any public application table or RPC.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE USAGE ON SCHEMA public FROM anon;

-- Keep future database objects closed by default as well. Explicit public
-- endpoints must be exposed deliberately through an authenticated Edge
-- Function instead of widening the database data plane.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Several legacy policies were declared TO public. Narrow them to signed-in
-- users; service_role bypasses RLS and does not need to be named here.
DO $secure_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (roles @> ARRAY['public']::name[] OR roles @> ARRAY['anon']::name[])
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I TO authenticated',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END
$secure_policies$;
