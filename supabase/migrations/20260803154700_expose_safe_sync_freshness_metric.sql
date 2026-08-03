-- Analytics may consume sync freshness without receiving table access to the
-- credential vault or any credential payload.
CREATE OR REPLACE FUNCTION security.latest_platform_sync_at(p_merchant_code text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result timestamptz;
  is_service boolean := COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role';
BEGIN
  IF NOT is_service AND NOT security.can_access_merchant(p_merchant_code) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT max(last_sync_at) INTO result
  FROM public.platform_credentials
  WHERE merchant_code = p_merchant_code;
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION security.latest_platform_sync_at(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.latest_platform_sync_at(text) TO authenticated, service_role;

DO $$
DECLARE
  function_definition text;
  updated_definition text;
  old_expression text := '(select max(last_sync_at) from public.platform_credentials where merchant_code = p_merchant_code)';
  new_expression text := '(select security.latest_platform_sync_at(p_merchant_code))';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO function_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'merchant_health_score'
    AND pg_get_function_identity_arguments(p.oid) = 'p_merchant_code text';

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'expected credential freshness expression not found';
  ELSIF position(old_expression in function_definition) > 0 THEN
    updated_definition := replace(function_definition, old_expression, new_expression);
    EXECUTE updated_definition;
  ELSIF position(new_expression in function_definition) > 0 THEN
    NULL;
  ELSIF position('public.platform_credentials' in function_definition) = 0 THEN
    -- A compatibility implementation can precede the complete analytics RPC
    -- on a clean rebuild. It does not read the credential vault, so no rewrite
    -- is necessary; the complete implementation below uses the safe helper.
    NULL;
  ELSE
    RAISE EXCEPTION 'expected credential freshness expression not found';
  END IF;
END
$$;
