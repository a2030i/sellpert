-- Provider order streams can lag behind wall-clock time. Keep the automatic
-- upper bound three minutes behind now so validation and provider APIs both
-- receive a stable, closed interval.

create or replace function security.enqueue_active_marketplace_syncs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_salla integer := 0;
begin
  insert into public.sync_queue (
    merchant_code,
    platform,
    marketplace_account_id,
    job_type,
    payload,
    priority,
    status,
    scheduled_at
  )
  select
    credentials.merchant_code,
    credentials.platform,
    credentials.marketplace_account_id,
    'sync_incremental',
    jsonb_build_object(
      'date_from', to_char(
        greatest(
          coalesce(credentials.last_sync_at, now() - interval '90 days') - interval '2 days',
          now() - interval '90 days'
        ) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      ),
      'date_to', to_char((now() - interval '3 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    4,
    'pending',
    now()
  from public.platform_credentials credentials
  join public.merchants merchant
    on merchant.merchant_code = credentials.merchant_code
  where credentials.is_active is true
    and credentials.marketplace_account_id is not null
    and credentials.platform in ('trendyol', 'amazon')
    and merchant.is_active is true
    and merchant.workspace_status = 'active'
    and coalesce(credentials.last_sync_at, '-infinity'::timestamptz) < now() - interval '20 minutes'
    and not exists (
      select 1
      from public.sync_queue queued
      where queued.merchant_code = credentials.merchant_code
        and queued.platform = credentials.platform
        and queued.marketplace_account_id = credentials.marketplace_account_id
        and queued.status in ('pending', 'processing', 'running')
    );

  get diagnostics v_inserted = row_count;
  insert into public.sync_queue(merchant_code,platform,marketplace_account_id,job_type,payload,priority,status,scheduled_at)
  select c.merchant_code,'salla',c.marketplace_account_id,'sync_all','{}'::jsonb,4,'pending',now()
  from public.salla_connections c join public.marketplace_accounts a on a.id=c.marketplace_account_id
  join public.merchants m on m.merchant_code=c.merchant_code
  where a.status='active' and c.sync_status='idle' and m.is_active and m.workspace_status='active'
    and coalesce(c.last_sync_at,'-infinity'::timestamptz)<now()-interval '20 minutes'
    and not exists(select 1 from public.sync_queue q where q.marketplace_account_id=c.marketplace_account_id and q.status in ('pending','processing','running'));
  get diagnostics v_salla = row_count;
  return v_inserted + v_salla;
end
$$;


revoke all on function security.enqueue_active_marketplace_syncs() from public,anon,authenticated;
grant execute on function security.enqueue_active_marketplace_syncs() to service_role;

create or replace function public.process_sync_queue(batch_size integer default 10)
returns table(id bigint, job_type text, merchant_code text, platform text, payload jsonb)
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select sq.id as cid
    from public.sync_queue sq
    join public.merchants m on m.merchant_code = sq.merchant_code
    where sq.status = 'pending'
      and sq.scheduled_at <= now()
      and m.workspace_status = 'active'
    order by sq.priority asc, sq.scheduled_at asc
    limit batch_size
    for update of sq skip locked
  ),
  updated as (
    update public.sync_queue sq
    set status = 'running',
        started_at = now(),
        attempts = sq.attempts + 1
    from candidates
    where sq.id = candidates.cid
    returning sq.id as rid,
      sq.job_type as rjob_type,
      sq.merchant_code as rmerchant_code,
      sq.platform as rplatform,
      coalesce(sq.payload,'{}'::jsonb) || jsonb_build_object('marketplace_account_id',sq.marketplace_account_id) as rpayload
  )
  select rid, rjob_type, rmerchant_code, rplatform, rpayload from updated;
end;
$$;

revoke execute on function public.process_sync_queue(integer)
  from public, anon, authenticated;
grant execute on function public.process_sync_queue(integer)
  to service_role;
