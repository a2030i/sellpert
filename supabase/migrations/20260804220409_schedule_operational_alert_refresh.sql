-- Refresh durable merchant alerts even when no browser session is open. The
-- scheduled worker exposes aggregate counts only and isolates a failing
-- workspace so one bad source cannot stop every other merchant check.

create or replace function security.refresh_all_merchant_operational_alerts()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rec record;
  v_checked integer := 0;
  v_created integer := 0;
  v_failed integer := 0;
  v_merchant_created integer := 0;
begin
  -- Internal functions authorize service calls through the JWT role. Cron
  -- runs as a database-owned job without an HTTP JWT, so establish the same
  -- scoped service context only inside this non-exposed worker transaction.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  for rec in
    select merchant_code
    from public.merchants
    where role = 'merchant'
      and coalesce(is_active, false)
      and subscription_status = 'active'
    order by merchant_code
  loop
    begin
      v_merchant_created := security.generate_merchant_operational_alerts(rec.merchant_code);
      v_created := v_created + coalesce(v_merchant_created, 0);
      v_checked := v_checked + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'checked', v_checked,
    'alerts_created', v_created,
    'failed', v_failed,
    'checked_at', now()
  );
end
$$;

revoke all on function security.refresh_all_merchant_operational_alerts() from public, anon, authenticated;
grant execute on function security.refresh_all_merchant_operational_alerts() to service_role;

do $$
declare
  v_existing_job bigint;
begin
  select jobid into v_existing_job
  from cron.job
  where jobname = 'merchant-operational-alert-refresh';

  if v_existing_job is not null then
    perform cron.unschedule(v_existing_job);
  end if;

  perform cron.schedule(
    'merchant-operational-alert-refresh',
    '7 * * * *',
    $cron$select security.refresh_all_merchant_operational_alerts()$cron$
  );
end
$$;

comment on function security.refresh_all_merchant_operational_alerts() is
  'Hourly tenant-isolated operational alert refresh returning aggregate health counts only.';
