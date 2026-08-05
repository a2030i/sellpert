-- Provider payloads can contain customer and shipping data. Keep the raw
-- tables for the operational orders role, while finance/product/dashboard
-- readers consume a fixed projection that never returns `raw`.

CREATE OR REPLACE FUNCTION security.list_return_facts(
  p_merchant_code text,
  p_sku text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  merchant_code text,
  platform text,
  order_id text,
  product_name text,
  sku text,
  quantity integer,
  return_amount numeric,
  reason text,
  return_date date,
  status text,
  created_at timestamptz,
  upload_id uuid,
  claim_id text,
  claim_line_id text,
  last_synced_at timestamptz,
  provider_claim_item_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    r.id, r.merchant_code, r.platform, r.order_id, r.product_name, r.sku,
    r.quantity, r.return_amount, r.reason, r.return_date, r.status,
    r.created_at, r.upload_id, r.claim_id, r.claim_line_id,
    r.last_synced_at, r.provider_claim_item_id
  FROM public.returns r
  WHERE r.merchant_code = p_merchant_code
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
    AND (p_sku IS NULL OR r.sku = p_sku)
  ORDER BY r.return_date DESC NULLS LAST, r.created_at DESC, r.id
$$;

CREATE OR REPLACE FUNCTION public.list_return_facts(
  p_merchant_code text,
  p_sku text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  merchant_code text,
  platform text,
  order_id text,
  product_name text,
  sku text,
  quantity integer,
  return_amount numeric,
  reason text,
  return_date date,
  status text,
  created_at timestamptz,
  upload_id uuid,
  claim_id text,
  claim_line_id text,
  last_synced_at timestamptz,
  provider_claim_item_id text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM security.list_return_facts(p_merchant_code, p_sku)
$$;

REVOKE ALL ON FUNCTION security.list_return_facts(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_return_facts(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION security.list_return_facts(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_return_facts(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_return_facts(text, text) IS
  'Tenant-checked return facts that never expose the marketplace raw payload.';

DROP POLICY IF EXISTS merchant_permission_read ON public.returns;
DROP POLICY IF EXISTS merchant_permission_select_boundary ON public.returns;

CREATE POLICY merchant_permission_read ON public.returns
FOR SELECT TO authenticated
USING (
  NOT (SELECT security.is_platform_staff_account())
  AND (SELECT security.current_has_merchant_permission('orders'))
);

CREATE POLICY merchant_permission_select_boundary ON public.returns
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  NOT (SELECT security.is_platform_staff_account())
  AND (SELECT security.current_has_merchant_permission('orders'))
);

DROP POLICY IF EXISTS merchant_permission_read ON public.order_packages;
DROP POLICY IF EXISTS merchant_permission_select_boundary ON public.order_packages;

CREATE POLICY merchant_permission_read ON public.order_packages
FOR SELECT TO authenticated
USING (
  NOT (SELECT security.is_platform_staff_account())
  AND (SELECT security.current_has_merchant_permission('orders'))
);

CREATE POLICY merchant_permission_select_boundary ON public.order_packages
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  NOT (SELECT security.is_platform_staff_account())
  AND (SELECT security.current_has_merchant_permission('orders'))
);
