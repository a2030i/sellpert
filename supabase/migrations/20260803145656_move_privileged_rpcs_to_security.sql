-- Keep PostgREST RPC names stable while moving privileged implementations out
-- of the exposed public schema. Public functions below are SECURITY INVOKER
-- wrappers; the existing authorization checks remain in security.*.

create schema if not exists security;
revoke all on schema security from public, anon;
grant usage on schema security to authenticated, service_role;

do $$
declare
  expected_count integer;
begin
  select count(*)
    into expected_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) in (
      ('current_merchant_code', ''),
      ('delete_employee', 'p_employee_code text'),
      ('delete_upload_cascade', 'p_upload_id uuid'),
      ('delete_upload_with_data', 'p_upload_id uuid'),
      ('get_db_health', ''),
      ('is_admin', ''),
      ('is_staff', ''),
      ('merchant_payouts', 'p_merchant_code text'),
      ('my_employees', ''),
      ('my_linked_merchants', ''),
      ('my_owner_merchant', ''),
      ('rebuild_all_derived_data', 'p_merchant_code text'),
      ('team_dashboard_kpis', ''),
      ('update_employee', 'p_employee_code text, p_permissions jsonb, p_is_active boolean, p_job_title text, p_name text'),
      ('update_my_store_profile', 'p_name text, p_whatsapp_phone text, p_logo_url text, p_merchant_code text'),
      ('wipe_merchant_data', 'p_merchant_code text')
    );

  if expected_count <> 16 then
    raise exception 'Expected 16 public privileged RPC implementations, found %', expected_count;
  end if;
end
$$;

alter function public.current_merchant_code() set schema security;
alter function public.delete_employee(text) set schema security;
alter function public.delete_upload_cascade(uuid) set schema security;
alter function public.delete_upload_with_data(uuid) set schema security;
alter function public.get_db_health() set schema security;
alter function public.is_admin() set schema security;
alter function public.is_staff() set schema security;
alter function public.merchant_payouts(text) set schema security;
alter function public.my_employees() set schema security;
alter function public.my_linked_merchants() set schema security;
alter function public.my_owner_merchant() set schema security;
alter function public.rebuild_all_derived_data(text) set schema security;
alter function public.team_dashboard_kpis() set schema security;
alter function public.update_employee(text, jsonb, boolean, text, text) set schema security;
alter function public.update_my_store_profile(text, text, text, text) set schema security;
alter function public.wipe_merchant_data(text) set schema security;

create function public.current_merchant_code()
returns text
language sql stable security invoker set search_path = ''
as $$ select security.current_merchant_code() $$;

create function public.delete_employee(p_employee_code text)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.delete_employee(p_employee_code) $$;

create function public.delete_upload_cascade(p_upload_id uuid)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.delete_upload_cascade(p_upload_id) $$;

create function public.delete_upload_with_data(p_upload_id uuid)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.delete_upload_with_data(p_upload_id) $$;

create function public.get_db_health()
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.get_db_health() $$;

create function public.is_admin()
returns boolean
language sql stable security invoker set search_path = ''
as $$ select security.is_admin() $$;

create function public.is_staff()
returns boolean
language sql stable security invoker set search_path = ''
as $$ select security.is_staff() $$;

create function public.merchant_payouts(p_merchant_code text)
returns jsonb
language sql stable security invoker set search_path = ''
as $$ select security.merchant_payouts(p_merchant_code) $$;

create function public.my_employees()
returns table(
  id uuid,
  merchant_code text,
  name text,
  email text,
  whatsapp_phone text,
  job_title text,
  permissions jsonb,
  is_active boolean,
  created_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from security.my_employees() $$;

create function public.my_linked_merchants()
returns table(merchant_code text, name text, role text, is_default boolean)
language sql stable security invoker set search_path = ''
as $$ select * from security.my_linked_merchants() $$;

create function public.my_owner_merchant()
returns text
language sql stable security invoker set search_path = ''
as $$ select security.my_owner_merchant() $$;

create function public.rebuild_all_derived_data(p_merchant_code text)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.rebuild_all_derived_data(p_merchant_code) $$;

create function public.team_dashboard_kpis()
returns jsonb
language sql stable security invoker set search_path = ''
as $$ select security.team_dashboard_kpis() $$;

create function public.update_employee(
  p_employee_code text,
  p_permissions jsonb default null::jsonb,
  p_is_active boolean default null::boolean,
  p_job_title text default null::text,
  p_name text default null::text
)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.update_employee(p_employee_code, p_permissions, p_is_active, p_job_title, p_name) $$;

create function public.update_my_store_profile(
  p_name text default null::text,
  p_whatsapp_phone text default null::text,
  p_logo_url text default null::text,
  p_merchant_code text default null::text
)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.update_my_store_profile(p_name, p_whatsapp_phone, p_logo_url, p_merchant_code) $$;

create function public.wipe_merchant_data(p_merchant_code text)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.wipe_merchant_data(p_merchant_code) $$;

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'security')
      and p.proname in (
        'current_merchant_code', 'delete_employee', 'delete_upload_cascade',
        'delete_upload_with_data', 'get_db_health', 'is_admin', 'is_staff',
        'merchant_payouts', 'my_employees', 'my_linked_merchants',
        'my_owner_merchant', 'rebuild_all_derived_data', 'team_dashboard_kpis',
        'update_employee', 'update_my_store_profile', 'wipe_merchant_data'
      )
  loop
    execute format('revoke execute on function %I.%I(%s) from public, anon', fn.nspname, fn.proname, fn.identity_args);
    execute format('grant execute on function %I.%I(%s) to authenticated, service_role', fn.nspname, fn.proname, fn.identity_args);
  end loop;
end
$$;

-- Move service-only and trigger implementations as well so the exposed public
-- schema contains no SECURITY DEFINER functions. Trigger dependencies follow
-- the moved function OID automatically; service jobs keep stable public RPCs.
do $$
declare
  expected_count integer;
begin
  select count(*)
    into expected_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) in (
      ('bulk_notify', 'p_merchant_codes text[], p_title text, p_body text, p_action_path text'),
      ('check_budget_alerts', ''),
      ('complete_queue_job', 'job_id bigint, success boolean, err_msg text'),
      ('delete_upload_cascade_internal', 'p_upload_id uuid'),
      ('delete_upload_with_data_internal', 'p_upload_id uuid'),
      ('derive_orders_from_account_tx', 'p_merchant_code text'),
      ('derive_product_platform_prices', 'p_merchant_code text'),
      ('derive_returns_from_account_tx', 'p_merchant_code text'),
      ('derive_returns_from_snapshots', 'p_merchant_code text'),
      ('enqueue_daily_salla_sync', ''),
      ('get_db_health_internal', ''),
      ('handle_self_service_merchant_signup', ''),
      ('notify_order_whatsapp', ''),
      ('reactivate_merchant', 'p_merchant_code text, p_period_end timestamp with time zone'),
      ('rebuild_performance_data', 'p_merchant_code text'),
      ('suspend_merchant', 'p_merchant_code text, p_reason text'),
      ('trigger_queue_worker', '')
    );

  if expected_count <> 17 then
    raise exception 'Expected 17 public service-only privileged implementations, found %', expected_count;
  end if;
end
$$;

alter function public.bulk_notify(text[], text, text, text) set schema security;
alter function public.check_budget_alerts() set schema security;
alter function public.complete_queue_job(bigint, boolean, text) set schema security;
alter function public.delete_upload_cascade_internal(uuid) set schema security;
alter function public.delete_upload_with_data_internal(uuid) set schema security;
alter function public.derive_orders_from_account_tx(text) set schema security;
alter function public.derive_product_platform_prices(text) set schema security;
alter function public.derive_returns_from_account_tx(text) set schema security;
alter function public.derive_returns_from_snapshots(text) set schema security;
alter function public.enqueue_daily_salla_sync() set schema security;
alter function public.get_db_health_internal() set schema security;
alter function public.handle_self_service_merchant_signup() set schema security;
alter function public.notify_order_whatsapp() set schema security;
alter function public.reactivate_merchant(text, timestamptz) set schema security;
alter function public.rebuild_performance_data(text) set schema security;
alter function public.suspend_merchant(text, text) set schema security;
alter function public.trigger_queue_worker() set schema security;

create function public.bulk_notify(
  p_merchant_codes text[],
  p_title text,
  p_body text,
  p_action_path text default null::text
)
returns integer
language sql volatile security invoker set search_path = ''
as $$ select security.bulk_notify(p_merchant_codes, p_title, p_body, p_action_path) $$;

create function public.check_budget_alerts()
returns integer
language sql volatile security invoker set search_path = ''
as $$ select security.check_budget_alerts() $$;

create function public.complete_queue_job(job_id bigint, success boolean, err_msg text default null::text)
returns void
language sql volatile security invoker set search_path = ''
as $$ select security.complete_queue_job(job_id, success, err_msg) $$;

create function public.delete_upload_cascade_internal(p_upload_id uuid)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.delete_upload_cascade_internal(p_upload_id) $$;

create function public.delete_upload_with_data_internal(p_upload_id uuid)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.delete_upload_with_data_internal(p_upload_id) $$;

create function public.derive_orders_from_account_tx(p_merchant_code text)
returns integer
language sql volatile security invoker set search_path = ''
as $$ select security.derive_orders_from_account_tx(p_merchant_code) $$;

create function public.derive_product_platform_prices(p_merchant_code text)
returns integer
language sql volatile security invoker set search_path = ''
as $$ select security.derive_product_platform_prices(p_merchant_code) $$;

create function public.derive_returns_from_account_tx(p_merchant_code text)
returns integer
language sql volatile security invoker set search_path = ''
as $$ select security.derive_returns_from_account_tx(p_merchant_code) $$;

create function public.derive_returns_from_snapshots(p_merchant_code text)
returns integer
language sql volatile security invoker set search_path = ''
as $$ select security.derive_returns_from_snapshots(p_merchant_code) $$;

create function public.enqueue_daily_salla_sync()
returns void
language sql volatile security invoker set search_path = ''
as $$ select security.enqueue_daily_salla_sync() $$;

create function public.get_db_health_internal()
returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select security.get_db_health_internal() $$;

create function public.reactivate_merchant(p_merchant_code text, p_period_end timestamptz default null::timestamptz)
returns void
language sql volatile security invoker set search_path = ''
as $$ select security.reactivate_merchant(p_merchant_code, p_period_end) $$;

create function public.rebuild_performance_data(p_merchant_code text)
returns integer
language sql volatile security invoker set search_path = ''
as $$ select security.rebuild_performance_data(p_merchant_code) $$;

create function public.suspend_merchant(p_merchant_code text, p_reason text default null::text)
returns void
language sql volatile security invoker set search_path = ''
as $$ select security.suspend_merchant(p_merchant_code, p_reason) $$;

create function public.trigger_queue_worker()
returns void
language sql volatile security invoker set search_path = ''
as $$ select security.trigger_queue_worker() $$;

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'security')
      and p.proname in (
        'bulk_notify', 'check_budget_alerts', 'complete_queue_job',
        'delete_upload_cascade_internal', 'delete_upload_with_data_internal',
        'derive_orders_from_account_tx', 'derive_product_platform_prices',
        'derive_returns_from_account_tx', 'derive_returns_from_snapshots',
        'enqueue_daily_salla_sync', 'get_db_health_internal',
        'handle_self_service_merchant_signup', 'notify_order_whatsapp',
        'reactivate_merchant', 'rebuild_performance_data', 'suspend_merchant',
        'trigger_queue_worker'
      )
  loop
    execute format('revoke execute on function %I.%I(%s) from public, anon, authenticated', fn.nspname, fn.proname, fn.identity_args);
    execute format('grant execute on function %I.%I(%s) to service_role', fn.nspname, fn.proname, fn.identity_args);
  end loop;
end
$$;

comment on function public.bulk_notify(text[], text, text, text) is 'Service-only SECURITY INVOKER wrapper for security.bulk_notify(...).';
comment on function public.check_budget_alerts() is 'Service-only SECURITY INVOKER wrapper for security.check_budget_alerts().';
comment on function public.complete_queue_job(bigint, boolean, text) is 'Service-only SECURITY INVOKER wrapper for security.complete_queue_job(...).';
comment on function public.delete_upload_cascade_internal(uuid) is 'Service-only SECURITY INVOKER wrapper for security.delete_upload_cascade_internal(uuid).';
comment on function public.delete_upload_with_data_internal(uuid) is 'Service-only SECURITY INVOKER wrapper for security.delete_upload_with_data_internal(uuid).';
comment on function public.derive_orders_from_account_tx(text) is 'Service-only SECURITY INVOKER wrapper for security.derive_orders_from_account_tx(text).';
comment on function public.derive_product_platform_prices(text) is 'Service-only SECURITY INVOKER wrapper for security.derive_product_platform_prices(text).';
comment on function public.derive_returns_from_account_tx(text) is 'Service-only SECURITY INVOKER wrapper for security.derive_returns_from_account_tx(text).';
comment on function public.derive_returns_from_snapshots(text) is 'Service-only SECURITY INVOKER wrapper for security.derive_returns_from_snapshots(text).';
comment on function public.enqueue_daily_salla_sync() is 'Service-only SECURITY INVOKER wrapper for security.enqueue_daily_salla_sync().';
comment on function public.get_db_health_internal() is 'Service-only SECURITY INVOKER wrapper for security.get_db_health_internal().';
comment on function public.reactivate_merchant(text, timestamptz) is 'Service-only SECURITY INVOKER wrapper for security.reactivate_merchant(...).';
comment on function public.rebuild_performance_data(text) is 'Service-only SECURITY INVOKER wrapper for security.rebuild_performance_data(text).';
comment on function public.suspend_merchant(text, text) is 'Service-only SECURITY INVOKER wrapper for security.suspend_merchant(...).';
comment on function public.trigger_queue_worker() is 'Service-only SECURITY INVOKER wrapper for security.trigger_queue_worker().';

comment on schema security is 'Private implementation schema; not exposed through the Data API.';
comment on function public.current_merchant_code() is 'SECURITY INVOKER API wrapper for security.current_merchant_code().';
comment on function public.delete_employee(text) is 'SECURITY INVOKER API wrapper for security.delete_employee(text).';
comment on function public.delete_upload_cascade(uuid) is 'SECURITY INVOKER API wrapper for security.delete_upload_cascade(uuid).';
comment on function public.delete_upload_with_data(uuid) is 'SECURITY INVOKER API wrapper for security.delete_upload_with_data(uuid).';
comment on function public.get_db_health() is 'SECURITY INVOKER API wrapper for security.get_db_health().';
comment on function public.is_admin() is 'SECURITY INVOKER API wrapper for security.is_admin().';
comment on function public.is_staff() is 'SECURITY INVOKER API wrapper for security.is_staff().';
comment on function public.merchant_payouts(text) is 'SECURITY INVOKER API wrapper for security.merchant_payouts(text).';
comment on function public.my_employees() is 'SECURITY INVOKER API wrapper for security.my_employees().';
comment on function public.my_linked_merchants() is 'SECURITY INVOKER API wrapper for security.my_linked_merchants().';
comment on function public.my_owner_merchant() is 'SECURITY INVOKER API wrapper for security.my_owner_merchant().';
comment on function public.rebuild_all_derived_data(text) is 'SECURITY INVOKER API wrapper for security.rebuild_all_derived_data(text).';
comment on function public.team_dashboard_kpis() is 'SECURITY INVOKER API wrapper for security.team_dashboard_kpis().';
comment on function public.update_employee(text, jsonb, boolean, text, text) is 'SECURITY INVOKER API wrapper for security.update_employee(...).';
comment on function public.update_my_store_profile(text, text, text, text) is 'SECURITY INVOKER API wrapper for security.update_my_store_profile(...).';
comment on function public.wipe_merchant_data(text) is 'SECURITY INVOKER API wrapper for security.wipe_merchant_data(text).';

-- Prevent newly created public functions from silently inheriting EXECUTE for
-- untrusted API roles. Future RPCs must be granted deliberately.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

notify pgrst, 'reload schema';
