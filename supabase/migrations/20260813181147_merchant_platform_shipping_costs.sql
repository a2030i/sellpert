CREATE TABLE public.merchant_platform_finance_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_code text NOT NULL REFERENCES public.merchants(merchant_code) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform = ANY (ARRAY['trendyol','noon','amazon','salla','zid','shopify'])),
  shipping_cost_tax_inclusive numeric(12,2) NOT NULL DEFAULT 0 CHECK (shipping_cost_tax_inclusive >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid(),
  UNIQUE (merchant_code, platform)
);

ALTER TABLE public.merchant_platform_finance_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.merchant_platform_finance_settings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.merchant_platform_finance_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.merchant_platform_finance_settings TO service_role;

CREATE POLICY merchant_platform_finance_settings_select
ON public.merchant_platform_finance_settings
FOR SELECT TO authenticated
USING (
  security.can_access_merchant(merchant_code)
  AND security.has_merchant_permission(merchant_code, 'products')
);

CREATE POLICY merchant_platform_finance_settings_insert
ON public.merchant_platform_finance_settings
FOR INSERT TO authenticated
WITH CHECK (
  security.can_access_merchant(merchant_code)
  AND security.has_merchant_permission(merchant_code, 'products')
);

CREATE POLICY merchant_platform_finance_settings_update
ON public.merchant_platform_finance_settings
FOR UPDATE TO authenticated
USING (
  security.can_access_merchant(merchant_code)
  AND security.has_merchant_permission(merchant_code, 'products')
)
WITH CHECK (
  security.can_access_merchant(merchant_code)
  AND security.has_merchant_permission(merchant_code, 'products')
);

CREATE POLICY merchant_platform_finance_settings_delete
ON public.merchant_platform_finance_settings
FOR DELETE TO authenticated
USING (
  security.can_access_merchant(merchant_code)
  AND security.has_merchant_permission(merchant_code, 'products')
);

COMMENT ON TABLE public.merchant_platform_finance_settings IS
  'Per-merchant marketplace operating costs used in product profitability. Shipping cost is stored tax-inclusive.';

COMMENT ON COLUMN public.merchant_platform_finance_settings.shipping_cost_tax_inclusive IS
  'Worst-case shipping cost for one product/order on this platform, including VAT.';
