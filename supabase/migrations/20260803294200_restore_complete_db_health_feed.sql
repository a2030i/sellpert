-- A later operational migration refreshed the legacy public internal helper
-- after privileged implementations had moved to the private security schema.
-- Keep the Data API boundary thin and always delegate to the complete private
-- health implementation, including privacy-safe client incident summaries.
CREATE OR REPLACE FUNCTION public.get_db_health()
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT security.get_db_health() $$;

REVOKE ALL ON FUNCTION public.get_db_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_db_health() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_db_health() IS
  'SECURITY INVOKER API wrapper for the complete permission-guarded platform health feed.';
