CREATE TABLE public.merchant_contract_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_code text NOT NULL UNIQUE REFERENCES public.merchants(merchant_code) ON DELETE CASCADE,
  sellpert_fee_type text NOT NULL DEFAULT 'none'
    CHECK (sellpert_fee_type IN ('none', 'percentage', 'fixed')),
  sellpert_fee_value numeric(12,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid(),
  CONSTRAINT merchant_contract_terms_valid_fee CHECK (
    (sellpert_fee_type = 'none' AND sellpert_fee_value = 0)
    OR (sellpert_fee_type = 'percentage' AND sellpert_fee_value >= 0 AND sellpert_fee_value <= 100)
    OR (sellpert_fee_type = 'fixed' AND sellpert_fee_value >= 0)
  )
);

ALTER TABLE public.merchant_contract_terms ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.merchant_contract_terms FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.merchant_contract_terms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.merchant_contract_terms TO service_role;

CREATE POLICY merchant_contract_terms_select
ON public.merchant_contract_terms
FOR SELECT TO authenticated
USING (
  (
    security.can_access_merchant(merchant_code)
    AND security.has_merchant_permission(merchant_code, 'products')
  )
  OR (SELECT security.has_platform_permission('view_merchants'))
  OR (SELECT security.has_platform_permission('edit_merchants'))
);

CREATE POLICY merchant_contract_terms_insert
ON public.merchant_contract_terms
FOR INSERT TO authenticated
WITH CHECK ((SELECT security.has_platform_permission('edit_merchants')));

CREATE POLICY merchant_contract_terms_update
ON public.merchant_contract_terms
FOR UPDATE TO authenticated
USING ((SELECT security.has_platform_permission('edit_merchants')))
WITH CHECK ((SELECT security.has_platform_permission('edit_merchants')));

CREATE POLICY merchant_contract_terms_delete
ON public.merchant_contract_terms
FOR DELETE TO authenticated
USING ((SELECT security.has_platform_permission('edit_merchants')));

COMMENT ON TABLE public.merchant_contract_terms IS
  'Admin-managed commercial terms applied uniformly to every product belonging to one merchant.';

COMMENT ON COLUMN public.merchant_contract_terms.sellpert_fee_type IS
  'Sellpert contract commission mode: none, percentage of selling price, or fixed amount per product.';

COMMENT ON COLUMN public.merchant_contract_terms.sellpert_fee_value IS
  'Exact contractual Sellpert commission value. No VAT is added automatically by the application.';
