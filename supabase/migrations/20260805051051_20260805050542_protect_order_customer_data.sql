-- Dashboard, product and finance users need order facts, not customer PII or
-- provider payloads. Keep the base table for the operational orders role and
-- expose a deliberately narrow, tenant-checked projection for analytics.

CREATE OR REPLACE FUNCTION security.list_order_operating_facts(
  p_merchant_code text,
  p_sku text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  merchant_code text,
  platform text,
  status text,
  product_name text,
  sku text,
  quantity integer,
  unit_price numeric,
  total_amount numeric,
  gross_amount numeric,
  platform_fee numeric,
  shipping_cost numeric,
  discount_amount numeric,
  currency text,
  order_date timestamptz,
  created_at timestamptz,
  upload_id uuid,
  last_synced_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    o.id, o.merchant_code, o.platform, o.status, o.product_name, o.sku,
    o.quantity, o.unit_price, o.total_amount, o.gross_amount,
    o.platform_fee, o.shipping_cost, o.discount_amount, o.currency,
    o.order_date, o.created_at, o.upload_id, o.last_synced_at
  FROM public.orders o
  WHERE o.merchant_code = p_merchant_code
    AND security.can_access_merchant(p_merchant_code)
    AND (
      (
        NOT security.is_platform_staff_account()
        AND security.current_has_any_merchant_permission(
          ARRAY['dashboard', 'orders', 'products', 'statement']::text[]
        )
      )
      OR security.has_any_platform_permission(
        ARRAY['view_merchants', 'view_files', 'view_finance']::text[]
      )
    )
    AND (p_sku IS NULL OR o.sku = p_sku)
  ORDER BY o.order_date DESC, o.id
$$;

CREATE OR REPLACE FUNCTION public.list_order_operating_facts(
  p_merchant_code text,
  p_sku text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  merchant_code text,
  platform text,
  status text,
  product_name text,
  sku text,
  quantity integer,
  unit_price numeric,
  total_amount numeric,
  gross_amount numeric,
  platform_fee numeric,
  shipping_cost numeric,
  discount_amount numeric,
  currency text,
  order_date timestamptz,
  created_at timestamptz,
  upload_id uuid,
  last_synced_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT *
  FROM security.list_order_operating_facts(p_merchant_code, p_sku)
$$;

REVOKE ALL ON FUNCTION security.list_order_operating_facts(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_order_operating_facts(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.list_order_operating_facts(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_order_operating_facts(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_order_operating_facts(text, text) IS
  'Tenant-checked order facts without customer addresses, provider JSON, order references or tracking identifiers.';

DROP POLICY IF EXISTS merchant_permission_read ON public.orders;
DROP POLICY IF EXISTS merchant_permission_select_boundary ON public.orders;

CREATE POLICY merchant_permission_read ON public.orders
FOR SELECT TO authenticated
USING (
  NOT (SELECT security.is_platform_staff_account())
  AND (SELECT security.current_has_merchant_permission('orders'))
);

CREATE POLICY merchant_permission_select_boundary ON public.orders
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  NOT (SELECT security.is_platform_staff_account())
  AND (SELECT security.current_has_merchant_permission('orders'))
);
