-- Several later feature migrations refreshed privileged implementations in
-- the exposed public schema after the private RPC boundary was introduced.
-- Copy the newest implementations back into security, then leave only thin
-- SECURITY INVOKER API wrappers in public.
DO $$
DECLARE
  target record;
  function_definition text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('bulk_update_product_costs', 'p_updates jsonb, p_merchant_code text'),
      ('current_merchant_code', ''),
      ('delete_upload_cascade', 'p_upload_id uuid'),
      ('delete_upload_with_data', 'p_upload_id uuid'),
      ('get_db_health_internal', ''),
      ('is_staff', ''),
      ('merchant_payouts', 'p_merchant_code text'),
      ('rebuild_all_derived_data', 'p_merchant_code text'),
      ('rebuild_performance_data', 'p_merchant_code text'),
      ('team_dashboard_kpis', '')
    ) AS functions(function_name, identity_arguments)
  LOOP
    SELECT pg_get_functiondef(p.oid)
      INTO function_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = target.function_name
      AND pg_get_function_identity_arguments(p.oid) = target.identity_arguments;

    IF function_definition IS NULL THEN
      RAISE EXCEPTION 'missing privileged implementation %.%(%)',
        'public', target.function_name, target.identity_arguments;
    END IF;

    EXECUTE replace(function_definition, 'FUNCTION public.', 'FUNCTION security.');
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.current_merchant_code()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.current_merchant_code() $$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.is_staff() $$;

CREATE OR REPLACE FUNCTION public.delete_upload_cascade(p_upload_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.delete_upload_cascade(p_upload_id) $$;

CREATE OR REPLACE FUNCTION public.delete_upload_with_data(p_upload_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.delete_upload_with_data(p_upload_id) $$;

CREATE OR REPLACE FUNCTION public.get_db_health_internal()
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.get_db_health_internal() $$;

CREATE OR REPLACE FUNCTION public.merchant_payouts(p_merchant_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.merchant_payouts(p_merchant_code) $$;

CREATE OR REPLACE FUNCTION public.rebuild_all_derived_data(p_merchant_code text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.rebuild_all_derived_data(p_merchant_code) $$;

CREATE OR REPLACE FUNCTION public.rebuild_performance_data(p_merchant_code text)
RETURNS integer LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.rebuild_performance_data(p_merchant_code) $$;

CREATE OR REPLACE FUNCTION public.team_dashboard_kpis()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT security.team_dashboard_kpis() $$;

CREATE OR REPLACE FUNCTION public.bulk_update_product_costs(
  p_updates jsonb,
  p_merchant_code text DEFAULT NULL
)
RETURNS TABLE(
  updated_count integer,
  unmatched_identifiers text[],
  ambiguous_identifiers text[],
  invalid_rows integer
)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT * FROM security.bulk_update_product_costs(p_updates, p_merchant_code) $$;

-- This obsolete overload was reintroduced after the four-argument,
-- workspace-aware profile RPC. The application uses the scoped API only.
DROP FUNCTION IF EXISTS public.update_my_store_profile(text, text, text);

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA security FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION security.current_merchant_code() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.is_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.delete_upload_cascade(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.delete_upload_with_data(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.get_db_health_internal() TO service_role;
GRANT EXECUTE ON FUNCTION security.merchant_payouts(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.rebuild_all_derived_data(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.rebuild_performance_data(text) TO service_role;
GRANT EXECUTE ON FUNCTION security.team_dashboard_kpis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION security.bulk_update_product_costs(jsonb, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.current_merchant_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_upload_cascade(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_upload_with_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_db_health_internal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merchant_payouts(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rebuild_all_derived_data(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rebuild_performance_data(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_dashboard_kpis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bulk_update_product_costs(jsonb, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_merchant_code() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_upload_cascade(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_upload_with_data(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_db_health_internal() TO service_role;
GRANT EXECUTE ON FUNCTION public.merchant_payouts(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_all_derived_data(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_performance_data(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_dashboard_kpis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_update_product_costs(jsonb, text) TO authenticated, service_role;
