BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a1400000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'operations-monitor@test.invalid', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

INSERT INTO public.merchants (
  id, merchant_code, name, email, role, is_active, permissions, onboarding_done
) VALUES (
  'a1400000-0000-4000-8000-000000000001',
  'OPS-MONITOR-QA', 'Operations Monitor', 'operations-monitor@test.invalid',
  'merchant', true, '{}'::jsonb, true
);

INSERT INTO public.platform_file_uploads (
  merchant_code, platform, file_type, file_name, status, uploaded_at
) VALUES (
  'OPS-MONITOR-QA', 'noon', 'monitor_test', 'monitor-test.xlsx', 'processing',
  now() - interval '31 minutes'
);

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
