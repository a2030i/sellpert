BEGIN;

DO $$
DECLARE
  table_name text;
  policy_count integer;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'platform_commission_rates',
    'platform_fee_categories',
    'platform_fulfillment_models',
    'platform_other_fees',
    'platform_shipping_tiers'
  ]
  LOOP
    SELECT count(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = table_name;

    IF policy_count < 4 THEN
      RAISE EXCEPTION 'fee reference table % is missing RLS policies', table_name;
    END IF;
    IF NOT has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') THEN
      RAISE EXCEPTION 'authenticated cannot read fee reference table %', table_name;
    END IF;
  END LOOP;
END
$$;

ROLLBACK;
