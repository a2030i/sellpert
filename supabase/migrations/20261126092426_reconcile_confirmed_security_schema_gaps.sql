-- REVIEW DRAFT ONLY: confirmed schema gaps; not approved for production.
-- Exact private implementation/public wrapper from the rebuilt committed history.
-- Does not execute cost imports, clear names, replay baseline or repair history.
CREATE OR REPLACE FUNCTION security.bulk_update_product_costs(p_updates jsonb, p_merchant_code text DEFAULT NULL::text)
 RETURNS TABLE(updated_count integer, unmatched_identifiers text[], ambiguous_identifiers text[], invalid_rows integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.bulk_update_product_costs(p_updates jsonb, p_merchant_code text DEFAULT NULL::text)
 RETURNS TABLE(updated_count integer, unmatched_identifiers text[], ambiguous_identifiers text[], invalid_rows integer)
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT * FROM security.bulk_update_product_costs(p_updates, p_merchant_code) $function$
;

REVOKE ALL ON FUNCTION security.bulk_update_product_costs(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.bulk_update_product_costs(jsonb,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.bulk_update_product_costs(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_update_product_costs(jsonb,text) TO authenticated, service_role;

-- Restrictive tenant/permission boundaries do not grant access by themselves;
-- sales_targets also needs a permissive write policy for the merchant goal RPC.
-- The restrictive policies remain the final tenant and section guard.
DROP POLICY IF EXISTS merchant_sales_targets_insert ON public.sales_targets;
CREATE POLICY merchant_sales_targets_insert
ON public.sales_targets
FOR INSERT TO authenticated
WITH CHECK (security.has_merchant_permission(merchant_code, 'dashboard'));

DROP POLICY IF EXISTS merchant_sales_targets_update ON public.sales_targets;
CREATE POLICY merchant_sales_targets_update
ON public.sales_targets
FOR UPDATE TO authenticated
USING (security.has_merchant_permission(merchant_code, 'dashboard'))
WITH CHECK (security.has_merchant_permission(merchant_code, 'dashboard'));


-- Validate the original privacy predicate without rewriting any customer rows.
-- A bounded production aggregate found zero violations during review.
-- If a concurrent violation exists at application time this migration must abort;
-- no automatic cleanup is authorized.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.trendyol_customer_questions'::regclass
      AND conname='trendyol_customer_questions_hidden_name_check'
  ) THEN
    ALTER TABLE public.trendyol_customer_questions
      ADD CONSTRAINT trendyol_customer_questions_hidden_name_check
      CHECK (show_customer_name OR customer_name IS NULL);
  END IF;
END
$migration$;
