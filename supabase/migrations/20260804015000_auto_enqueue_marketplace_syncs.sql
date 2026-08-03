-- Keep direct marketplace connections fresh without requiring merchants to
-- press the sync button. Each run overlaps two days so delayed status,
-- shipment and settlement changes are reconciled idempotently.

create or replace function security.enqueue_active_marketplace_syncs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.sync_queue (
    merchant_code,
    platform,
    job_type,
    payload,
    priority,
    status,
    scheduled_at
  )
  select
    credentials.merchant_code,
    credentials.platform,
    'sync_incremental',
    jsonb_build_object(
      'date_from', to_char(
        greatest(
          coalesce(credentials.last_sync_at, now() - interval '90 days') - interval '2 days',
          now() - interval '90 days'
        ) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      ),
      'date_to', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    4,
    'pending',
    now()
  from public.platform_credentials credentials
  join public.merchants merchant
    on merchant.merchant_code = credentials.merchant_code
  where credentials.is_active is true
    and credentials.platform in ('trendyol', 'amazon', 'noon')
    and merchant.is_active is true
    and merchant.subscription_status = 'active'
    and coalesce(credentials.last_sync_at, '-infinity'::timestamptz) < now() - interval '20 minutes'
    and not exists (
      select 1
      from public.sync_queue queued
      where queued.merchant_code = credentials.merchant_code
        and queued.platform = credentials.platform
        and queued.status in ('pending', 'processing', 'running')
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$$;

revoke all on function security.enqueue_active_marketplace_syncs() from public, anon, authenticated;
grant execute on function security.enqueue_active_marketplace_syncs() to service_role;

do $$
declare
  v_existing_job bigint;
begin
  select jobid into v_existing_job
  from cron.job
  where jobname = 'enqueue-active-marketplace-syncs';

  if v_existing_job is not null then
    perform cron.unschedule(v_existing_job);
  end if;

  perform cron.schedule(
    'enqueue-active-marketplace-syncs',
    '*/30 * * * *',
    $cron$select security.enqueue_active_marketplace_syncs()$cron$
  );
end
$$;

comment on function security.enqueue_active_marketplace_syncs() is
  'Queues tenant-scoped incremental marketplace synchronization every 30 minutes without duplicate active jobs.';
