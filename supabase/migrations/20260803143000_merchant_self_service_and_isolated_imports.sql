-- Merchant self-registration and strictly tenant-scoped file imports.

CREATE OR REPLACE FUNCTION public.current_merchant_code()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT merchant_code
  FROM public.merchants
  WHERE id = (SELECT auth.uid())
     OR email = (SELECT auth.email())
  ORDER BY (id = (SELECT auth.uid())) DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_merchant_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_merchant_code() TO authenticated, service_role;

-- Auth trigger is deliberately limited to sign-ups carrying the internal
-- self_service marker. Admin-created users continue through create-merchant.
CREATE OR REPLACE FUNCTION public.handle_self_service_merchant_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  IF COALESCE(NEW.raw_user_meta_data->>'signup_source', '') <> 'self_service' THEN
    RETURN NEW;
  END IF;

  LOOP
    v_code := 'M-' || floor(1000 + random() * 9000)::int::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.merchants WHERE merchant_code = v_code);
  END LOOP;

  INSERT INTO public.merchants (
    id, merchant_code, name, email, currency, role,
    subscription_plan, subscription_status, signup_source, whatsapp_phone
  ) VALUES (
    NEW.id,
    v_code,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''), split_part(NEW.email, '@', 1)),
    lower(NEW.email),
    'SAR',
    'merchant',
    'free',
    'active',
    'self_service',
    NULLIF(trim(NEW.raw_user_meta_data->>'whatsapp_phone'), '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.handle_self_service_merchant_signup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_create_merchant ON auth.users;
CREATE TRIGGER on_auth_user_created_create_merchant
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_self_service_merchant_signup();

-- Every imported row must belong to the signed-in merchant. Staff retain
-- their existing policies; these policies only add tenant-scoped writes.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'platform_file_uploads', 'orders', 'products', 'inventory',
    'account_transactions', 'ad_metrics', 'returns', 'goods_received',
    'product_performance_snapshots', 'platform_deals', 'amazon_daily_sales',
    'inbound_shipments', 'inbound_shipment_items', 'import_diagnostics'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS merchant_file_import_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS merchant_file_import_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY merchant_file_import_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (merchant_code = (SELECT public.current_merchant_code()))',
      t
    );
    EXECUTE format(
      'CREATE POLICY merchant_file_import_update ON public.%I FOR UPDATE TO authenticated USING (merchant_code = (SELECT public.current_merchant_code())) WITH CHECK (merchant_code = (SELECT public.current_merchant_code()))',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
  END LOOP;
END
$$;

CREATE INDEX IF NOT EXISTS platform_file_uploads_merchant_uploaded_idx
  ON public.platform_file_uploads (merchant_code, uploaded_at DESC);

-- Merchants may rebuild only their own derived data after a successful import.
CREATE OR REPLACE FUNCTION public.rebuild_all_derived_data(p_merchant_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  amz_orders int; rets_snap int; rets_amz int; prices int; perf int; alerts int;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_staff()
     AND p_merchant_code IS DISTINCT FROM public.current_merchant_code() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  amz_orders := public.derive_orders_from_account_tx(p_merchant_code);
  rets_snap  := public.derive_returns_from_snapshots(p_merchant_code);
  rets_amz   := public.derive_returns_from_account_tx(p_merchant_code);
  prices     := public.derive_product_platform_prices(p_merchant_code);
  perf       := public.rebuild_performance_data(p_merchant_code);
  alerts     := public.generate_proactive_alerts(p_merchant_code);
  RETURN jsonb_build_object(
    'amazon_orders_derived', amz_orders,
    'returns_derived', rets_snap + rets_amz,
    'platform_prices_derived', prices,
    'performance_rows', perf,
    'alerts_generated', alerts
  );
END
$$;

REVOKE ALL ON FUNCTION public.rebuild_all_derived_data(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_all_derived_data(text) TO authenticated, service_role;
