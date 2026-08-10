-- Platform staff import into a merchant workspace through the admin importer.
-- Access is limited to an existing upload audit row whose UUID and merchant
-- code match the private object path: <merchant_code>/<upload_id>/<filename>.

DROP POLICY IF EXISTS merchant_imports_insert_own ON storage.objects;
CREATE POLICY merchant_imports_insert_own
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'merchant-imports'
  AND split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND lower(storage.extension(name)) = ANY (ARRAY['csv', 'tsv', 'txt', 'xls', 'xlsx', 'xlsm'])
  AND (
    (
      split_part(name, '/', 1) = (SELECT security.current_merchant_code())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['integrations', 'statement']))
    )
    OR (
      (SELECT security.has_platform_permission('upload_files'))
      AND EXISTS (
        SELECT 1
        FROM public.platform_file_uploads upload
        WHERE upload.id::text = split_part(name, '/', 2)
          AND upload.merchant_code = split_part(name, '/', 1)
          AND upload.status = 'processing'
      )
    )
  )
);

DROP POLICY IF EXISTS merchant_imports_select_own ON storage.objects;
CREATE POLICY merchant_imports_select_own
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'merchant-imports'
  AND (
    (
      split_part(name, '/', 1) = (SELECT security.current_merchant_code())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['integrations', 'statement']))
    )
    OR (
      (SELECT security.has_any_platform_permission(ARRAY['upload_files', 'view_files']))
      AND EXISTS (
        SELECT 1
        FROM public.platform_file_uploads upload
        WHERE upload.id::text = split_part(name, '/', 2)
          AND upload.merchant_code = split_part(name, '/', 1)
      )
    )
  )
);

DROP POLICY IF EXISTS merchant_imports_delete_own ON storage.objects;
CREATE POLICY merchant_imports_delete_own
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'merchant-imports'
  AND (
    (
      split_part(name, '/', 1) = (SELECT security.current_merchant_code())
      AND (SELECT security.current_has_any_merchant_permission(ARRAY['integrations', 'statement']))
    )
    OR (
      (SELECT security.has_platform_permission('delete_files'))
      AND EXISTS (
        SELECT 1
        FROM public.platform_file_uploads upload
        WHERE upload.id::text = split_part(name, '/', 2)
          AND upload.merchant_code = split_part(name, '/', 1)
      )
    )
  )
);
