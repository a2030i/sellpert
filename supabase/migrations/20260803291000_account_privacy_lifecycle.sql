-- Self-service account lifecycle. Requests are intentionally inaccessible
-- through the Data API and are mediated by the authenticated Edge Function.
create table if not exists public.account_closure_requests (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code) on update cascade on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'cancelled', 'closed')),
  reason text,
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null default (now() + interval '30 days'),
  cancelled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_closure_schedule_check check (scheduled_for >= requested_at + interval '30 days'),
  constraint account_closure_state_check check (
    (status = 'pending' and cancelled_at is null and closed_at is null)
    or (status = 'cancelled' and cancelled_at is not null and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

create unique index if not exists account_closure_one_pending_per_merchant
  on public.account_closure_requests (merchant_code)
  where status = 'pending';

create index if not exists account_closure_due_idx
  on public.account_closure_requests (scheduled_for)
  where status = 'pending';

alter table public.account_closure_requests enable row level security;
revoke all on table public.account_closure_requests from public, anon, authenticated;

comment on table public.account_closure_requests is
  'Recoverable merchant account closure requests. Access is mediated by account-lifecycle Edge Function.';

create or replace function security.process_due_account_closures()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
  v_count integer := 0;
begin
  for v_request in
    update public.account_closure_requests
       set status = 'closed', closed_at = now(), updated_at = now()
     where status = 'pending' and scheduled_for <= now()
     returning id, merchant_code, requested_by, scheduled_for
  loop
    update public.merchants
       set is_active = false, subscription_status = 'suspended'
     where merchant_code = v_request.merchant_code
        or owner_merchant_code = v_request.merchant_code;

    insert into public.audit_log (
      merchant_code, action, table_name, record_id, new_values, performed_by
    ) values (
      v_request.merchant_code,
      'account_closure_completed',
      'account_closure_requests',
      v_request.id::text,
      jsonb_build_object('scheduled_for', v_request.scheduled_for, 'closed_at', now()),
      v_request.requested_by::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

revoke all on function security.process_due_account_closures() from public, anon, authenticated;

do $$
declare
  v_existing_job bigint;
begin
  select jobid into v_existing_job from cron.job where jobname = 'process-account-closures';
  if v_existing_job is not null then perform cron.unschedule(v_existing_job); end if;
  perform cron.schedule(
    'process-account-closures',
    '23 * * * *',
    $cron$select security.process_due_account_closures()$cron$
  );
end
$$;
