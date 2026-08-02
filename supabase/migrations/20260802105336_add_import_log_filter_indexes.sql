-- Support the admin import-history page without full scans as the audit trail grows.
CREATE INDEX IF NOT EXISTS platform_file_uploads_uploaded_at_idx
  ON public.platform_file_uploads (uploaded_at DESC);

CREATE INDEX IF NOT EXISTS platform_file_uploads_platform_date_idx
  ON public.platform_file_uploads (platform, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS platform_file_uploads_type_date_idx
  ON public.platform_file_uploads (file_type, uploaded_at DESC)
  WHERE file_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS platform_file_uploads_uploader_date_idx
  ON public.platform_file_uploads (uploaded_by, uploaded_at DESC)
  WHERE uploaded_by IS NOT NULL;
