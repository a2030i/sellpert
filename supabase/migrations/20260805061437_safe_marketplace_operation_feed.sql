-- Marketplace requests and responses are provider implementation details.
-- Resolve their useful target inside the database and expose only a compact,
-- tenant-checked operation feed to browser clients.

CREATE OR REPLACE FUNCTION security.list_marketplace_operation_facts(
  p_merchant_code text,
  p_platform text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_order_id text DEFAULT NULL,
  p_package_id text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  merchant_code text,
  platform text,
  action text,
  risk_level text,
  status text,
  reference text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  target_type text,
  target_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH authorized_logs AS (
    SELECT l.*
    FROM public.marketplace_action_logs l
    WHERE l.merchant_code = p_merchant_code
      AND security.can_access_merchant(p_merchant_code)
      AND (
        (
          NOT security.is_platform_staff_account()
          AND security.current_has_any_merchant_permission(
            ARRAY['dashboard', 'integrations', 'orders', 'products', 'customer_service', 'statement']::text[]
          )
        )
        OR security.has_any_platform_permission(
          ARRAY['view_merchants', 'view_files', 'view_audit']::text[]
        )
      )
      AND (p_platform IS NULL OR l.platform = p_platform)
  ), resolved AS (
    SELECT
      l.*,
      matched_product.id AS matched_product_id,
      matched_package.order_id AS matched_order_id,
      NULLIF(BTRIM(l.request #>> '{path,packageId}'), '') AS requested_package_id
    FROM authorized_logs l
    LEFT JOIN LATERAL (
      SELECT product.id
      FROM public.products product
      WHERE product.merchant_code = l.merchant_code
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(l.request #> '{payload,items}') = 'array'
                THEN l.request #> '{payload,items}'
              ELSE '[]'::jsonb
            END
          ) item
          WHERE (
            NULLIF(BTRIM(item ->> 'contentId'), '') IS NOT NULL
            AND (
              product.external_id = item ->> 'contentId'
              OR product.raw ->> 'contentId' = item ->> 'contentId'
              OR product.raw ->> 'id' = item ->> 'contentId'
            )
          ) OR (
            NULLIF(BTRIM(item ->> 'barcode'), '') IS NOT NULL
            AND product.barcode = item ->> 'barcode'
          )
        )
      ORDER BY product.id
      LIMIT 1
    ) matched_product ON l.action LIKE 'products.%'
    LEFT JOIN LATERAL (
      SELECT package.order_id
      FROM public.order_packages package
      WHERE package.merchant_code = l.merchant_code
        AND package.platform = l.platform
        AND (
          (
            NULLIF(BTRIM(l.request #>> '{path,packageId}'), '') IS NOT NULL
            AND package.shipment_package_id = l.request #>> '{path,packageId}'
          ) OR (
            NULLIF(BTRIM(l.request #>> '{path,cargoTrackingNumber}'), '') IS NOT NULL
            AND package.cargo_tracking_number = l.request #>> '{path,cargoTrackingNumber}'
          )
        )
      ORDER BY package.modified_at DESC NULLS LAST, package.id
      LIMIT 1
    ) matched_package ON l.action LIKE 'packages.%' OR l.action LIKE 'invoices.%'
  )
  SELECT
    r.id,
    r.merchant_code,
    r.platform,
    r.action,
    r.risk_level,
    r.status,
    CASE
      WHEN NULLIF(regexp_replace(COALESCE(r.external_batch_id, ''), '[^a-zA-Z0-9]', '', 'g'), '') IS NULL THEN NULL
      ELSE 'TY-' || RIGHT(UPPER(regexp_replace(r.external_batch_id, '[^a-zA-Z0-9]', '', 'g')), 8)
    END AS reference,
    CASE
      WHEN r.error_message IS NULL THEN NULL
      WHEN r.error_message ~* '(bearer[[:space:]]+[a-z0-9._-]+|api[_ -]?(key|secret)[[:space:]]*[:=]|token[[:space:]]*[:=]|password[[:space:]]*[:=])'
        THEN 'تعذر إكمال العملية بسبب إعدادات الربط. حدّث بيانات الربط ثم أعد المحاولة.'
      ELSE LEFT(r.error_message, 1000)
    END AS error_message,
    r.started_at,
    r.finished_at,
    CASE
      WHEN r.action LIKE 'products.%' THEN CASE WHEN r.matched_product_id IS NULL THEN 'products' ELSE 'product' END
      WHEN r.action LIKE 'packages.%' OR r.action LIKE 'invoices.%' THEN CASE WHEN r.matched_order_id IS NULL THEN 'orders' ELSE 'order' END
      WHEN r.action = 'questions.answer' THEN 'questions'
      WHEN r.action LIKE 'claims.%' OR r.action LIKE 'returns.%' THEN 'returns'
      ELSE 'integration'
    END AS target_type,
    CASE
      WHEN r.action LIKE 'products.%' THEN r.matched_product_id::text
      WHEN r.action LIKE 'packages.%' OR r.action LIKE 'invoices.%' THEN r.matched_order_id
      ELSE NULL
    END AS target_id
  FROM resolved r
  WHERE (p_product_id IS NULL OR r.matched_product_id = p_product_id)
    AND (p_order_id IS NULL OR r.matched_order_id = p_order_id)
    AND (p_package_id IS NULL OR r.requested_package_id = p_package_id)
  ORDER BY r.started_at DESC, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
$$;

CREATE OR REPLACE FUNCTION public.list_marketplace_operation_facts(
  p_merchant_code text,
  p_platform text DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_order_id text DEFAULT NULL,
  p_package_id text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  merchant_code text,
  platform text,
  action text,
  risk_level text,
  status text,
  reference text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  target_type text,
  target_id text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT *
  FROM security.list_marketplace_operation_facts(
    p_merchant_code, p_platform, p_product_id, p_order_id, p_package_id, p_limit
  )
$$;

REVOKE ALL ON FUNCTION security.list_marketplace_operation_facts(text, text, uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_marketplace_operation_facts(text, text, uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.list_marketplace_operation_facts(text, text, uuid, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_marketplace_operation_facts(text, text, uuid, text, text, integer) TO authenticated, service_role;

REVOKE SELECT ON public.marketplace_action_logs FROM authenticated;

COMMENT ON FUNCTION public.list_marketplace_operation_facts(text, text, uuid, text, text, integer) IS
  'Tenant-checked marketplace operation feed without provider request/response JSON, idempotency keys or actor identifiers.';
