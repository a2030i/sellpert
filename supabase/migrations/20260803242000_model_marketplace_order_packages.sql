-- Preserve every marketplace shipment package separately from its parent
-- order. Trendyol may split or recreate packages while keeping orderNumber.

CREATE TABLE IF NOT EXISTS public.order_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_code text NOT NULL,
  platform text NOT NULL,
  order_id text NOT NULL,
  shipment_package_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  cargo_tracking_number text,
  cargo_tracking_link text,
  cargo_sender_number text,
  cargo_provider text,
  delivery_type text,
  delivery_address_type text,
  invoice_number text,
  invoice_status text,
  invoice_rejected_reasons jsonb,
  line_count integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  total_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SAR',
  modified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb,
  CONSTRAINT order_packages_platform_check CHECK (platform IN ('trendyol','noon','amazon','salla','zid','shopify','other')),
  CONSTRAINT order_packages_tenant_unique UNIQUE (merchant_code, platform, shipment_package_id),
  CONSTRAINT order_packages_order_fkey FOREIGN KEY (merchant_code, platform, order_id)
    REFERENCES public.orders (merchant_code, platform, order_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS order_packages_order_lookup_idx
  ON public.order_packages (merchant_code, platform, order_id, modified_at DESC);
CREATE INDEX IF NOT EXISTS order_packages_open_status_idx
  ON public.order_packages (merchant_code, status, modified_at DESC)
  WHERE status NOT IN ('delivered','cancelled','returned');

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS shipment_package_id text;
CREATE INDEX IF NOT EXISTS order_items_package_lookup_idx
  ON public.order_items (merchant_code, platform, shipment_package_id)
  WHERE shipment_package_id IS NOT NULL;

ALTER TABLE public.order_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_boundary ON public.order_packages;
CREATE POLICY tenant_boundary ON public.order_packages
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    (SELECT security.can_access_all_merchants())
    OR merchant_code = (SELECT public.current_merchant_code())
  )
  WITH CHECK (
    (SELECT security.can_access_all_merchants())
    OR merchant_code = (SELECT public.current_merchant_code())
  );

DROP POLICY IF EXISTS merchant_permission_read ON public.order_packages;
CREATE POLICY merchant_permission_read ON public.order_packages
  FOR SELECT TO authenticated
  USING (
    (SELECT security.has_any_platform_permission(ARRAY['view_merchants','view_files']::text[]))
    OR (
      NOT (SELECT security.is_platform_staff_account())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['orders','dashboard']::text[]))
    )
  );

DROP POLICY IF EXISTS merchant_permission_select_boundary ON public.order_packages;
CREATE POLICY merchant_permission_select_boundary ON public.order_packages
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT security.has_any_platform_permission(ARRAY['view_merchants','view_files']::text[]))
    OR (
      NOT (SELECT security.is_platform_staff_account())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['orders','dashboard']::text[]))
    )
  );

REVOKE ALL ON public.order_packages FROM anon, authenticated;
GRANT SELECT ON public.order_packages TO authenticated;
GRANT ALL ON public.order_packages TO service_role;

COMMENT ON TABLE public.order_packages IS
  'One row per marketplace shipment package. A parent order may have multiple packages after split or cancellation.';
COMMENT ON COLUMN public.order_packages.shipment_package_id IS
  'Marketplace package identifier; distinct from the customer-facing order number.';

