-- Prevent any imported row from referencing a file upload owned by another merchant.
CREATE OR REPLACE FUNCTION public.enforce_upload_merchant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_upload_merchant text;
BEGIN
  IF NEW.upload_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT merchant_code INTO v_upload_merchant
  FROM public.platform_file_uploads
  WHERE id = NEW.upload_id;

  IF v_upload_merchant IS NULL OR v_upload_merchant IS DISTINCT FROM NEW.merchant_code THEN
    RAISE EXCEPTION 'upload does not belong to merchant' USING errcode = '23514';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_upload_merchant_consistency() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_transactions', 'ad_metrics', 'amazon_daily_sales', 'goods_received',
    'inbound_shipment_items', 'inbound_shipments', 'inventory', 'orders',
    'platform_deals', 'product_performance_snapshots', 'products', 'returns'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_upload_merchant_consistency ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER enforce_upload_merchant_consistency BEFORE INSERT OR UPDATE OF upload_id, merchant_code ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_upload_merchant_consistency()',
      t
    );
  END LOOP;
END
$$;
