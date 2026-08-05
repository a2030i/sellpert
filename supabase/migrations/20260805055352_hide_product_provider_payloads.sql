-- Marketplace product payloads are an implementation detail used by the
-- service-role sync workers. Browser users work with the normalized catalog
-- columns only, even when they have product editing permission.

REVOKE SELECT, INSERT, UPDATE ON public.products FROM authenticated;

GRANT SELECT (
  id, merchant_code, name, sku, barcode, category, description, image_url,
  cost_price, target_net_price, status, created_at, updated_at, psku_code,
  noon_sku_child, asin, external_id, model_code, brand, msrp, sale_price,
  sale_start_date, sale_end_date, external_url, color, size, images,
  noon_price_min, noon_price_max, seller_price_min, seller_price_max,
  warranty, commission_rate, buybox_price, vat_rate, gender, supplier_sku,
  upload_id, platform_source, last_synced_at
) ON public.products TO authenticated;

GRANT INSERT (
  id, merchant_code, name, sku, barcode, category, description, image_url,
  cost_price, target_net_price, status, created_at, updated_at, psku_code,
  noon_sku_child, asin, external_id, model_code, brand, msrp, sale_price,
  sale_start_date, sale_end_date, external_url, color, size, images,
  noon_price_min, noon_price_max, seller_price_min, seller_price_max,
  warranty, commission_rate, buybox_price, vat_rate, gender, supplier_sku,
  upload_id, platform_source, last_synced_at
) ON public.products TO authenticated;

GRANT UPDATE (
  merchant_code, name, sku, barcode, category, description, image_url,
  cost_price, target_net_price, status, updated_at, psku_code,
  noon_sku_child, asin, external_id, model_code, brand, msrp, sale_price,
  sale_start_date, sale_end_date, external_url, color, size, images,
  noon_price_min, noon_price_max, seller_price_min, seller_price_max,
  warranty, commission_rate, buybox_price, vat_rate, gender, supplier_sku,
  upload_id, platform_source, last_synced_at
) ON public.products TO authenticated;

COMMENT ON COLUMN public.products.raw IS
  'Private marketplace provider payload. Accessible only to trusted backend roles; never exposed through browser product reads.';
