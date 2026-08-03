-- Regression coverage for the boundary between exposed RPC wrappers and
-- privileged implementations. The public schema must never contain a
-- SECURITY DEFINER function.
begin;

do $$
declare
  public_definers integer;
  public_wrappers integer;
  private_implementations integer;
  auth_wrappers integer;
  service_wrappers integer;
begin
  select count(*) into public_definers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;

  if public_definers <> 0 then
    raise exception 'public schema still exposes % SECURITY DEFINER functions', public_definers;
  end if;

  select count(*) into public_wrappers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not p.prosecdef
    and p.proname in (
      'current_merchant_code', 'delete_employee', 'delete_upload_cascade',
      'delete_upload_with_data', 'get_db_health', 'is_admin', 'is_staff',
      'merchant_payouts', 'my_employees', 'my_linked_merchants',
      'my_owner_merchant', 'rebuild_all_derived_data', 'team_dashboard_kpis',
      'update_employee', 'update_my_store_profile', 'wipe_merchant_data',
      'bulk_notify', 'check_budget_alerts', 'complete_queue_job',
      'delete_upload_cascade_internal', 'delete_upload_with_data_internal',
      'derive_orders_from_account_tx', 'derive_product_platform_prices',
      'derive_returns_from_account_tx', 'derive_returns_from_snapshots',
      'enqueue_daily_salla_sync', 'get_db_health_internal',
      'reactivate_merchant', 'rebuild_performance_data', 'suspend_merchant',
      'trigger_queue_worker', 'report_client_incident',
      'update_client_incident_status'
    );

  if public_wrappers <> 33 then
    raise exception 'expected 33 public SECURITY INVOKER wrappers, found %', public_wrappers;
  end if;

  select count(*) into private_implementations
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'security'
    and p.prosecdef
    and p.proname in (
      'current_merchant_code', 'delete_employee', 'delete_upload_cascade',
      'delete_upload_with_data', 'get_db_health', 'is_admin', 'is_staff',
      'merchant_payouts', 'my_employees', 'my_linked_merchants',
      'my_owner_merchant', 'rebuild_all_derived_data', 'team_dashboard_kpis',
      'update_employee', 'update_my_store_profile', 'wipe_merchant_data',
      'bulk_notify', 'check_budget_alerts', 'complete_queue_job',
      'delete_upload_cascade_internal', 'delete_upload_with_data_internal',
      'derive_orders_from_account_tx', 'derive_product_platform_prices',
      'derive_returns_from_account_tx', 'derive_returns_from_snapshots',
      'enqueue_daily_salla_sync', 'get_db_health_internal',
      'handle_self_service_merchant_signup', 'notify_order_whatsapp',
      'reactivate_merchant', 'rebuild_performance_data', 'suspend_merchant',
      'trigger_queue_worker', 'report_client_incident',
      'update_client_incident_status', 'prune_client_incidents'
    );

  if private_implementations <> 36 then
    raise exception 'expected 36 private privileged implementations, found %', private_implementations;
  end if;

  select count(*) into auth_wrappers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'current_merchant_code', 'delete_employee', 'delete_upload_cascade',
      'delete_upload_with_data', 'get_db_health', 'is_admin', 'is_staff',
      'merchant_payouts', 'my_employees', 'my_linked_merchants',
      'my_owner_merchant', 'rebuild_all_derived_data', 'team_dashboard_kpis',
      'update_employee', 'update_my_store_profile', 'wipe_merchant_data',
      'report_client_incident', 'update_client_incident_status'
    )
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute');

  if auth_wrappers <> 18 then
    raise exception 'authenticated wrapper grants are incomplete: %', auth_wrappers;
  end if;

  select count(*) into service_wrappers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'bulk_notify', 'check_budget_alerts', 'complete_queue_job',
      'delete_upload_cascade_internal', 'delete_upload_with_data_internal',
      'derive_orders_from_account_tx', 'derive_product_platform_prices',
      'derive_returns_from_account_tx', 'derive_returns_from_snapshots',
      'enqueue_daily_salla_sync', 'get_db_health_internal',
      'reactivate_merchant', 'rebuild_performance_data', 'suspend_merchant',
      'trigger_queue_worker'
    )
    and has_function_privilege('service_role', p.oid, 'execute')
    and not has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute');

  if service_wrappers <> 15 then
    raise exception 'service-only wrapper grants are incomplete: %', service_wrappers;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'security'
      and p.proname in ('handle_self_service_merchant_signup', 'notify_order_whatsapp')
      and p.prorettype <> 'trigger'::regtype
  ) then
    raise exception 'moved trigger functions lost their trigger return type';
  end if;
end
$$;

set local role authenticated;

do $$
declare
  result jsonb;
begin
  if public.current_merchant_code() is not null then
    raise exception 'anonymous authenticated role resolved a merchant';
  end if;
  if public.is_admin() or public.is_staff() then
    raise exception 'anonymous authenticated role resolved platform privileges';
  end if;
  if public.my_owner_merchant() is not null then
    raise exception 'anonymous authenticated role resolved an owner';
  end if;
  if (select count(*) from public.my_employees()) <> 0 then
    raise exception 'anonymous authenticated role read employees';
  end if;
  if (select count(*) from public.my_linked_merchants()) <> 0 then
    raise exception 'anonymous authenticated role read linked merchants';
  end if;

  result := public.merchant_payouts('NO-AUTH');
  if result <> jsonb_build_object('scheduled', '[]'::jsonb, 'pending_sales', '[]'::jsonb) then
    raise exception 'unauthorized payout response disclosed data: %', result;
  end if;

  begin
    perform public.get_db_health();
    raise exception 'unauthorized health RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.update_my_store_profile(null, null, null, 'NO-AUTH');
    raise exception 'unauthorized profile RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.report_client_incident('render', 'fatal', '/', 'application', null, 'unknown_error', null, 'test');
    raise exception 'unauthenticated incident reporting unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.rebuild_all_derived_data('NO-AUTH');
    raise exception 'unauthorized rebuild RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.team_dashboard_kpis();
    raise exception 'unauthorized team KPI RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.wipe_merchant_data('NO-AUTH');
    raise exception 'unauthorized wipe RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.check_budget_alerts();
    raise exception 'authenticated role invoked service-only RPC';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
rollback;
