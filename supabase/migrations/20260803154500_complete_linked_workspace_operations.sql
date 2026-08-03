-- Linked workspaces must be first-class targets for analytics and maintenance,
-- not only for table reads. Replace primary-workspace equality checks with the
-- same immutable identity scope used by tenant RLS.
DO $$
DECLARE
  function_name text;
  function_definition text;
  updated_definition text;
  old_guard text := E'and p_merchant_code is distinct from v_owner_code\n     and not security.can_access_all_merchants()';
  new_guard text := E'and not security.can_access_merchant(p_merchant_code)';
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'generate_proactive_alerts',
    'merchant_executive_brief',
    'merchant_health_score',
    'revenue_forecast'
  ]
  LOOP
    SELECT pg_get_functiondef(p.oid)
      INTO function_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = function_name
      AND pg_get_function_identity_arguments(p.oid) = 'p_merchant_code text';

    IF function_definition IS NULL THEN
      RAISE EXCEPTION 'expected authorization guard not found in %', function_name;
    ELSIF position(old_guard in function_definition) > 0 THEN
      updated_definition := replace(function_definition, old_guard, new_guard);
      EXECUTE updated_definition;
    ELSIF position(new_guard in function_definition) = 0 THEN
      RAISE EXCEPTION 'expected authorization guard not found in %', function_name;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  function_definition text;
  updated_definition text;
  old_guard text := E'IF p_merchant_code IS DISTINCT FROM v_effective_merchant\n           OR NOT security.has_merchant_permission(p_merchant_code, ''integrations'') THEN';
  new_guard text := E'IF NOT security.has_merchant_permission(p_merchant_code, ''integrations'') THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO function_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'rebuild_all_derived_data'
    AND pg_get_function_identity_arguments(p.oid) = 'p_merchant_code text';

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'expected rebuild authorization guard not found';
  ELSIF position(old_guard in function_definition) > 0 THEN
    updated_definition := replace(function_definition, old_guard, new_guard);
    EXECUTE updated_definition;
  ELSIF position(
    'security.has_merchant_permission(p_merchant_code, ''integrations'')'
    in function_definition
  ) = 0 THEN
    RAISE EXCEPTION 'expected rebuild authorization guard not found';
  END IF;
END
$$;

-- Cost imports explicitly target the active workspace. The default preserves
-- compatibility for clients that have not yet sent p_merchant_code.
DROP FUNCTION IF EXISTS public.bulk_update_product_costs(jsonb);
CREATE FUNCTION public.bulk_update_product_costs(
  p_updates jsonb,
  p_merchant_code text DEFAULT NULL
)
RETURNS TABLE(
  updated_count integer,
  unmatched_identifiers text[],
  ambiguous_identifiers text[],
  invalid_rows integer
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_merchant_code text := COALESCE(NULLIF(btrim(p_merchant_code), ''), public.current_merchant_code());
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL OR v_merchant_code IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;
  IF NOT security.has_merchant_permission(v_merchant_code, 'products') THEN
    RAISE EXCEPTION 'PRODUCT_PERMISSION_REQUIRED';
  END IF;
  IF jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_COST_UPDATE_PAYLOAD';
  END IF;

  v_rows := jsonb_array_length(p_updates);
  IF v_rows = 0 OR v_rows > 5000 THEN
    RAISE EXCEPTION 'COST_UPDATE_ROW_LIMIT';
  END IF;

  RETURN QUERY
  WITH raw_input AS (
    SELECT trim(COALESCE(row_data ->> 'identifier', '')) AS identifier,
           trim(COALESCE(row_data ->> 'cost_price', '')) AS cost_text,
           ordinality
    FROM jsonb_array_elements(p_updates) WITH ORDINALITY AS input(row_data, ordinality)
  ), parsed AS (
    SELECT identifier, lower(identifier) AS normalized_identifier,
           CASE WHEN replace(cost_text, ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
             THEN replace(cost_text, ',', '.')::numeric ELSE NULL END AS cost_price,
           ordinality
    FROM raw_input
  ), valid_input AS (
    SELECT DISTINCT ON (normalized_identifier) identifier, normalized_identifier, cost_price
    FROM parsed
    WHERE normalized_identifier <> '' AND cost_price > 0
    ORDER BY normalized_identifier, ordinality DESC
  ), matches AS (
    SELECT input.identifier, input.normalized_identifier, input.cost_price,
           product.id AS product_id,
           count(*) OVER (PARTITION BY input.normalized_identifier) AS match_count
    FROM valid_input input
    JOIN public.products product
      ON product.merchant_code = v_merchant_code
     AND input.normalized_identifier IN (
       lower(trim(COALESCE(product.sku, ''))), lower(trim(COALESCE(product.barcode, ''))),
       lower(trim(COALESCE(product.external_id, ''))), lower(trim(COALESCE(product.model_code, ''))),
       lower(trim(COALESCE(product.supplier_sku, ''))), lower(trim(COALESCE(product.psku_code, ''))),
       lower(trim(COALESCE(product.noon_sku_child, ''))), lower(trim(COALESCE(product.asin, '')))
     )
  ), updated AS (
    UPDATE public.products product
       SET cost_price = match.cost_price, updated_at = now()
      FROM matches match
     WHERE match.match_count = 1
       AND product.id = match.product_id
       AND product.merchant_code = v_merchant_code
    RETURNING product.id
  )
  SELECT
    (SELECT count(*)::integer FROM updated),
    COALESCE((SELECT array_agg(input.identifier ORDER BY input.identifier)
      FROM valid_input input WHERE NOT EXISTS (
        SELECT 1 FROM matches match WHERE match.normalized_identifier = input.normalized_identifier
      )), '{}'::text[]),
    COALESCE((SELECT array_agg(DISTINCT match.identifier ORDER BY match.identifier)
      FROM matches match WHERE match.match_count > 1), '{}'::text[]),
    (SELECT count(*)::integer FROM parsed
      WHERE normalized_identifier = '' OR cost_price IS NULL OR cost_price <= 0);
END
$$;

REVOKE ALL ON FUNCTION public.bulk_update_product_costs(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_update_product_costs(jsonb, text) TO authenticated, service_role;
