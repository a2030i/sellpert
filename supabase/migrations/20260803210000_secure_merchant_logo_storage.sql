-- Prevent one authenticated tenant from overwriting another merchant's logo.
DROP POLICY IF EXISTS "merchants upload own logo" ON storage.objects;
DROP POLICY IF EXISTS "merchants update own logo" ON storage.objects;
DROP POLICY IF EXISTS "merchants select own logo" ON storage.objects;

CREATE POLICY "merchants select own logo"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'merchant-assets'
  AND name LIKE 'logos/' || public.current_merchant_code() || '.%'
  AND security.has_merchant_permission(public.current_merchant_code(), 'settings')
);

CREATE POLICY "merchants upload own logo"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'merchant-assets'
  AND name LIKE 'logos/' || public.current_merchant_code() || '.%'
  AND lower(storage.extension(name)) = ANY (ARRAY['png','jpg','jpeg','webp'])
  AND security.has_merchant_permission(public.current_merchant_code(), 'settings')
);

CREATE POLICY "merchants update own logo"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'merchant-assets'
  AND name LIKE 'logos/' || public.current_merchant_code() || '.%'
  AND security.has_merchant_permission(public.current_merchant_code(), 'settings')
)
WITH CHECK (
  bucket_id = 'merchant-assets'
  AND name LIKE 'logos/' || public.current_merchant_code() || '.%'
  AND lower(storage.extension(name)) = ANY (ARRAY['png','jpg','jpeg','webp'])
  AND security.has_merchant_permission(public.current_merchant_code(), 'settings')
);

