-- Analytics and rebuild RPCs historically compared the target only with the
-- primary workspace. Use the centralized immutable-link authorization helper
-- so a deliberately linked workspace receives the same scoped operations.
DO $$
DECLARE
  function_name text;
  function_definition text;
  updated_definition text;
  old_guard text := E'if auth.uid() is not null\n     and p_merchant_code is distinct from v_owner_code\n     and not security.can_access_all_merchants() then';
  new_guard text := E'if auth.uid() is not null\n     and not security.can_access_merchant(p_merchant_code) then';
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'merchant_health_score',
    'revenue_forecast',
    'generate_proactive_alerts',
    'merchant_executive_brief'
  ] LOOP
    SELECT pg_get_functiondef(p.oid)
      INTO function_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = function_name
      AND pg_get_function_identity_arguments(p.oid) = 'p_merchant_code text';

    updated_definition := replace(function_definition, old_guard, new_guard);
    IF function_definition IS NULL OR updated_definition = function_definition THEN
      RAISE EXCEPTION 'linked workspace authorization patch did not match %', function_name;
    END IF;
    EXECUTE updated_definition;
  END LOOP;
END
$$;

DO $$
DECLARE
  function_definition text;
  updated_definition text;
  old_guard text := E'IF p_merchant_code IS DISTINCT FROM v_effective_merchant\n           OR NOT security.has_merchant_permission(p_merchant_code, ''integrations'') THEN';
  new_guard text := E'IF NOT security.can_access_merchant(p_merchant_code)\n           OR NOT security.has_merchant_permission(p_merchant_code, ''integrations'') THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO function_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'rebuild_all_derived_data'
    AND pg_get_function_identity_arguments(p.oid) = 'p_merchant_code text';

  updated_definition := replace(function_definition, old_guard, new_guard);
  IF function_definition IS NULL OR updated_definition = function_definition THEN
    RAISE EXCEPTION 'linked workspace rebuild authorization patch did not match';
  END IF;
  EXECUTE updated_definition;
END
$$;
