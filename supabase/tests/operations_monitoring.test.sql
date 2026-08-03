BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

INSERT INTO public.platform_file_uploads (
  merchant_code, platform, file_type, file_name, status, uploaded_at
) SELECT merchant_code, 'noon', 'monitor_test', 'monitor-test.xlsx', 'processing', now() - interval '31 minutes'
FROM public.merchants WHERE role = 'merchant' LIMIT 1;

DO $$
DECLARE
  closed_count integer;
  remaining_count integer;
  health jsonb;
BEGIN
  SELECT security.close_stale_imports() INTO closed_count;
  IF closed_count < 1 THEN
    RAISE EXCEPTION 'stale import monitor did not close abandoned work';
  END IF;

  SELECT count(*) INTO remaining_count
  FROM public.platform_file_uploads
  WHERE file_name = 'monitor-test.xlsx' AND status = 'processing';
  IF remaining_count <> 0 THEN
    RAISE EXCEPTION 'stale import remains processing';
  END IF;

  SELECT public.get_db_health_internal() INTO health;
  IF NOT (health ? 'upload_stats' AND health ? 'sync_stats' AND health ? 'recent_incidents') THEN
    RAISE EXCEPTION 'operational health payload is incomplete';
  END IF;
END
$$;

ROLLBACK;
