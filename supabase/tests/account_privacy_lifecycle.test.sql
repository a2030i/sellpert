-- Account closure is owner initiated through the Edge Function, hidden from
-- the Data API, recoverable for 30 days, and closes the entire workspace.
BEGIN;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.account_closure_requests'::regclass) THEN
    RAISE EXCEPTION 'account_closure_requests must have RLS enabled';
  END IF;
  IF has_table_privilege('authenticated', 'public.account_closure_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.account_closure_requests', 'INSERT')
     OR has_table_privilege('authenticated', 'public.account_closure_requests', 'UPDATE') THEN
    RAISE EXCEPTION 'account closure table is exposed directly to authenticated clients';
  END IF;
  IF has_function_privilege('authenticated', 'security.process_due_account_closures()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated users can execute the closure processor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-account-closures') THEN
    RAISE EXCEPTION 'account closure cron is missing';
  END IF;
END
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) VALUES
(
  '00000000-0000-4000-8000-000000009981', 'authenticated', 'authenticated',
  'closure-owner@test.invalid', '', '{"provider":"email","providers":["email"]}',
  '{"signup_source":"self_service","name":"Closure Workspace"}', now(), now(), now(), false, false
),
(
  '00000000-0000-4000-8000-000000009982', 'authenticated', 'authenticated',
  'closure-employee@test.invalid', '', '{"provider":"email","providers":["email"]}',
  '{}'::jsonb, now(), now(), now(), false, false
);

DO $$
DECLARE
  v_code text := (SELECT merchant_code FROM public.merchants WHERE id = '00000000-0000-4000-8000-000000009981');
BEGIN
  INSERT INTO public.merchants (
    id, merchant_code, name, email, role, owner_merchant_code,
    permissions, workspace_status, is_active
  ) VALUES (
    '00000000-0000-4000-8000-000000009982', 'E-CLOSURE', 'Closure Employee',
    'closure-employee@test.invalid', 'employee', v_code, '{}', 'active', true
  );

  INSERT INTO public.account_closure_requests (
    merchant_code, requested_by, requested_at, scheduled_for
  ) VALUES (
    v_code, '00000000-0000-4000-8000-000000009981', now() - interval '31 days', now() - interval '1 day'
  );

  IF security.process_due_account_closures() <> 1 THEN
    RAISE EXCEPTION 'due closure was not processed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchants WHERE (merchant_code = v_code OR owner_merchant_code = v_code) AND is_active) THEN
    RAISE EXCEPTION 'workspace members remained active after closure';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE merchant_code = v_code AND action = 'account_closure_completed') THEN
    RAISE EXCEPTION 'closure was not recorded in audit log';
  END IF;
END
$$;

ROLLBACK;
