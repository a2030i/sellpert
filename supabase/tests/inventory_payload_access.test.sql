BEGIN;

DO $$
BEGIN
  IF has_column_privilege('authenticated','public.inventory','raw','SELECT') THEN
    RAISE EXCEPTION 'browser role can read private inventory provider payloads';
  END IF;
  IF NOT has_column_privilege('authenticated','public.inventory','quantity','SELECT') THEN
    RAISE EXCEPTION 'merchant lost normalized inventory quantity access';
  END IF;
  IF NOT has_column_privilege('authenticated','public.inventory','quantity','UPDATE') THEN
    RAISE EXCEPTION 'merchant lost normalized inventory quantity update access';
  END IF;
  IF NOT has_column_privilege('service_role','public.inventory','raw','SELECT') THEN
    RAISE EXCEPTION 'trusted sync worker lost inventory provider payload access';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='product_platform_listings'
      AND column_name='delivery_duration'
  ) THEN
    RAISE EXCEPTION 'normalized Trendyol delivery state is missing';
  END IF;
END
$$;

ROLLBACK;
