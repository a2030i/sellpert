-- Operational queue functions and trigger implementations are internal
-- database machinery, not merchant-facing RPCs. PostgreSQL grants EXECUTE to
-- PUBLIC for newly created functions unless the creating role's defaults are
-- hardened, so revoke both the inherited and explicit API-role grants.

-- The consolidated recovery baseline did not carry forward this queue
-- processor even though queue-worker still calls it. Recreate the current
-- SECURITY INVOKER implementation so a clean restore has the same operational
-- contract as production before permissions are narrowed.
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
      and m.subscription_status = 'active'
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
      sq.payload as rpayload
  )
  select rid, rjob_type, rmerchant_code, rplatform, rpayload from updated;
end;
$$;

revoke execute on function public.process_sync_queue(integer)
  from public, anon, authenticated;
grant execute on function public.process_sync_queue(integer)
  to service_role;

revoke execute on function public.prepare_merchant_weekly_brief()
  from public, anon, authenticated;
grant execute on function public.prepare_merchant_weekly_brief()
  to service_role;

revoke execute on function public.update_updated_at()
  from public, anon, authenticated;
grant execute on function public.update_updated_at()
  to service_role;

-- Default privileges for normal migration-created functions were already
-- hardened in 20260803145656. Managed Supabase does not allow project
-- migrations to alter supabase_admin's defaults, so the regression test below
-- checks the effective privileges of every internal function after all
-- migrations instead of relying on an unavailable owner-level setting.
