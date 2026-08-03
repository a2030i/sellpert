-- Fee and commission catalogues are shared reference data used by merchant
-- profitability screens. RLS was enabled without policies, which made those
-- screens silently receive empty results.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'platform_commission_rates',
    'platform_fee_categories',
    'platform_fulfillment_models',
    'platform_other_fees',
    'platform_shipping_tiers'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_reference_read ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS finance_reference_insert ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS finance_reference_update ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS finance_reference_delete ON public.%I', table_name);

    EXECUTE format(
      'CREATE POLICY authenticated_reference_read ON public.%I FOR SELECT TO authenticated USING (true)',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY finance_reference_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT security.has_platform_permission(''edit_billing'')))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY finance_reference_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT security.has_platform_permission(''edit_billing''))) WITH CHECK ((SELECT security.has_platform_permission(''edit_billing'')))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY finance_reference_delete ON public.%I FOR DELETE TO authenticated USING ((SELECT security.has_platform_permission(''edit_billing'')))',
      table_name
    );

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
  END LOOP;
END
$$;

-- Product administrators also maintain the simplified commission table used
-- by product-margin previews.
DROP POLICY IF EXISTS finance_reference_insert ON public.platform_commission_rates;
DROP POLICY IF EXISTS finance_reference_update ON public.platform_commission_rates;
DROP POLICY IF EXISTS finance_reference_delete ON public.platform_commission_rates;
CREATE POLICY finance_reference_insert ON public.platform_commission_rates FOR INSERT TO authenticated
  WITH CHECK ((SELECT security.has_any_platform_permission(ARRAY['edit_billing','edit_merchants'])));
CREATE POLICY finance_reference_update ON public.platform_commission_rates FOR UPDATE TO authenticated
  USING ((SELECT security.has_any_platform_permission(ARRAY['edit_billing','edit_merchants'])))
  WITH CHECK ((SELECT security.has_any_platform_permission(ARRAY['edit_billing','edit_merchants'])));
CREATE POLICY finance_reference_delete ON public.platform_commission_rates FOR DELETE TO authenticated
  USING ((SELECT security.has_any_platform_permission(ARRAY['edit_billing','edit_merchants'])));
