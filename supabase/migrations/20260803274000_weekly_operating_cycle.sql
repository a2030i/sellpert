-- Persistent merchant operating cycle: monthly goals, immutable-calculation
-- weekly snapshots, and accountable action completion evidence.

alter table public.sales_targets
  drop constraint if exists sales_targets_month_check;
alter table public.sales_targets
  add constraint sales_targets_month_check check (month between 1 and 12);
alter table public.sales_targets
  drop constraint if exists sales_targets_amount_check;
alter table public.sales_targets
  add constraint sales_targets_amount_check check (target_amount > 0 and target_amount <= 1000000000);

alter table public.merchant_requests
  add column if not exists completion_result text,
  add column if not exists completion_note text,
  add column if not exists completion_recorded_at timestamptz;

alter table public.merchant_requests
  drop constraint if exists merchant_requests_completion_result_check;
alter table public.merchant_requests
  add constraint merchant_requests_completion_result_check
  check (completion_result is null or completion_result in ('achieved', 'partial', 'not_achieved', 'unknown'));

create table if not exists public.merchant_weekly_briefs (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code) on delete cascade,
  week_start date not null,
  week_end date not null,
  source_data_as_of date not null,
  brief jsonb not null,
  actual_sales numeric(16,2) not null default 0,
  monthly_target numeric(16,2),
  target_attainment_pct numeric(8,2),
  target_pace_pct numeric(8,2),
  target_status text not null default 'not_set'
    check (target_status in ('not_set', 'ahead', 'on_track', 'behind')),
  captured_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_code, week_start),
  check (week_end = week_start + 6),
  check (source_data_as_of between week_start and week_end),
  check (jsonb_typeof(brief) = 'object')
);

create index if not exists merchant_weekly_briefs_timeline_idx
  on public.merchant_weekly_briefs (merchant_code, week_start desc);
create index if not exists merchant_weekly_briefs_captured_by_idx
  on public.merchant_weekly_briefs (captured_by);

alter table public.merchant_weekly_briefs enable row level security;

drop policy if exists merchant_weekly_briefs_select on public.merchant_weekly_briefs;
create policy merchant_weekly_briefs_select
on public.merchant_weekly_briefs for select
to authenticated
using (
  (select security.can_access_all_merchants())
  or (
    merchant_code = (select public.current_merchant_code())
    and not (select security.is_platform_staff_account())
    and (select security.current_has_any_merchant_permission(array['dashboard']::text[]))
  )
);

drop policy if exists merchant_weekly_briefs_insert on public.merchant_weekly_briefs;
create policy merchant_weekly_briefs_insert
on public.merchant_weekly_briefs for insert
to authenticated
with check (
  merchant_code = (select public.current_merchant_code())
  and not (select security.is_platform_staff_account())
  and (select security.current_has_merchant_permission('dashboard'))
);

drop policy if exists merchant_weekly_briefs_update on public.merchant_weekly_briefs;
create policy merchant_weekly_briefs_update
on public.merchant_weekly_briefs for update
to authenticated
using (
  merchant_code = (select public.current_merchant_code())
  and not (select security.is_platform_staff_account())
  and (select security.current_has_merchant_permission('dashboard'))
)
with check (
  merchant_code = (select public.current_merchant_code())
  and not (select security.is_platform_staff_account())
  and (select security.current_has_merchant_permission('dashboard'))
);

revoke all on public.merchant_weekly_briefs from public, anon;
grant select, insert, update on public.merchant_weekly_briefs to authenticated;
grant all on public.merchant_weekly_briefs to service_role;

create or replace function public.prepare_merchant_weekly_brief()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, security
as $$
declare
  v_owner_code text := public.current_merchant_code();
  v_brief jsonb;
  v_as_of date;
  v_week_start date;
  v_month_start date;
  v_month_end date;
  v_target numeric;
  v_actual numeric := 0;
  v_attainment numeric;
  v_pace numeric;
begin
  if auth.uid() is null or v_owner_code is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if new.merchant_code is distinct from v_owner_code then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  v_brief := public.merchant_executive_brief(v_owner_code);
  if not coalesce((v_brief->>'available')::boolean, false) then
    raise exception 'NO_EXECUTIVE_DATA';
  end if;

  v_as_of := (v_brief->>'data_as_of')::date;
  v_week_start := (date_trunc('week', v_as_of::timestamp + interval '1 day') - interval '1 day')::date;
  v_month_start := date_trunc('month', v_as_of)::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  select target_amount into v_target
  from public.sales_targets
  where merchant_code = v_owner_code
    and year = extract(year from v_as_of)::integer
    and month = extract(month from v_as_of)::integer
    and platform = 'all';

  select coalesce(sum(total_amount), 0)
    into v_actual
  from public.orders
  where merchant_code = v_owner_code
    and status not in ('cancelled', 'returned')
    and order_date::date between v_month_start and v_as_of;

  v_attainment := case when v_target > 0 then round(v_actual / v_target * 100, 2) end;
  v_pace := round(extract(day from v_as_of)::numeric / extract(day from v_month_end)::numeric * 100, 2);

  new.week_start := v_week_start;
  new.week_end := v_week_start + 6;
  new.source_data_as_of := v_as_of;
  new.brief := v_brief;
  new.actual_sales := round(v_actual, 2);
  new.monthly_target := v_target;
  new.target_attainment_pct := v_attainment;
  new.target_pace_pct := case when v_target is null then null else v_pace end;
  new.target_status := case
    when v_target is null then 'not_set'
    when v_attainment >= v_pace + 5 then 'ahead'
    when v_attainment >= v_pace - 5 then 'on_track'
    else 'behind' end;
  new.captured_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists prepare_merchant_weekly_brief_trigger on public.merchant_weekly_briefs;
create trigger prepare_merchant_weekly_brief_trigger
before insert or update on public.merchant_weekly_briefs
for each row execute function public.prepare_merchant_weekly_brief();

create or replace function public.capture_my_weekly_brief()
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, security
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_brief jsonb;
  v_as_of date;
  v_week_start date;
  v_row public.merchant_weekly_briefs%rowtype;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_brief := public.merchant_executive_brief(v_merchant_code);
  if not coalesce((v_brief->>'available')::boolean, false) then
    return jsonb_build_object('captured', false, 'reason', 'no_data');
  end if;
  v_as_of := (v_brief->>'data_as_of')::date;
  v_week_start := (date_trunc('week', v_as_of::timestamp + interval '1 day') - interval '1 day')::date;

  insert into public.merchant_weekly_briefs (
    merchant_code, week_start, week_end, source_data_as_of, brief
  ) values (
    v_merchant_code, v_week_start, v_week_start + 6, v_as_of, v_brief
  )
  on conflict (merchant_code, week_start) do update
    set source_data_as_of = excluded.source_data_as_of,
        brief = excluded.brief,
        updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'captured', true,
    'id', v_row.id,
    'week_start', v_row.week_start,
    'week_end', v_row.week_end,
    'source_data_as_of', v_row.source_data_as_of,
    'target_status', v_row.target_status
  );
end;
$$;

create or replace function public.set_my_monthly_sales_target(
  p_year integer,
  p_month integer,
  p_target_amount numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, security
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_target_month date;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_month not between 1 and 12 or p_target_amount <= 0 or p_target_amount > 1000000000 then
    raise exception 'INVALID_SALES_TARGET';
  end if;
  v_target_month := make_date(p_year, p_month, 1);
  if v_target_month < date_trunc('month', current_date)::date - interval '12 months'
     or v_target_month > date_trunc('month', current_date)::date + interval '12 months' then
    raise exception 'TARGET_MONTH_OUT_OF_RANGE';
  end if;

  insert into public.sales_targets (merchant_code, year, month, platform, target_amount, updated_at)
  values (v_merchant_code, p_year, p_month, 'all', round(p_target_amount, 2), now())
  on conflict (merchant_code, year, month, platform) do update
    set target_amount = excluded.target_amount, updated_at = now();

  return jsonb_build_object(
    'year', p_year, 'month', p_month,
    'target_amount', round(p_target_amount, 2)
  );
end;
$$;

create or replace function public.my_monthly_goal_progress()
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, security
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_year integer := extract(year from current_date)::integer;
  v_month integer := extract(month from current_date)::integer;
  v_month_start date := date_trunc('month', current_date)::date;
  v_month_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_target numeric;
  v_actual numeric := 0;
  v_order_days integer := 0;
  v_attainment numeric;
  v_pace numeric;
  v_projected numeric;
  v_gap numeric;
  v_days_remaining integer;
  v_required_daily numeric;
  v_status text := 'not_set';
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select target_amount into v_target
  from public.sales_targets
  where merchant_code = v_merchant_code and year = v_year and month = v_month and platform = 'all';

  select coalesce(sum(total_amount), 0), count(distinct order_date::date)::integer
    into v_actual, v_order_days
  from public.orders
  where merchant_code = v_merchant_code
    and status not in ('cancelled', 'returned')
    and order_date::date between v_month_start and current_date;

  v_days_remaining := greatest(0, v_month_end - current_date);
  v_pace := round(extract(day from current_date)::numeric / extract(day from v_month_end)::numeric * 100, 2);
  v_attainment := case when v_target > 0 then round(v_actual / v_target * 100, 2) end;
  v_projected := case when extract(day from current_date) > 0
    then round(v_actual / extract(day from current_date)::numeric * extract(day from v_month_end)::numeric, 2) else 0 end;
  v_gap := case when v_target > 0 then greatest(0, v_target - v_actual) end;
  v_required_daily := case when v_target > 0 and v_days_remaining > 0 then round(v_gap / v_days_remaining, 2) end;
  v_status := case
    when v_target is null then 'not_set'
    when v_attainment >= v_pace + 5 then 'ahead'
    when v_attainment >= v_pace - 5 then 'on_track'
    else 'behind' end;

  return jsonb_build_object(
    'year', v_year, 'month', v_month,
    'month_start', v_month_start, 'month_end', v_month_end,
    'target_amount', v_target, 'actual_sales', round(v_actual, 2),
    'attainment_pct', v_attainment, 'calendar_pace_pct', v_pace,
    'projected_sales', v_projected, 'gap_amount', v_gap,
    'days_remaining', v_days_remaining, 'required_daily_sales', v_required_daily,
    'active_order_days', v_order_days, 'status', v_status,
    'is_reliable', v_order_days >= 5
  );
end;
$$;

create or replace function public.complete_my_action(
  p_action_id uuid,
  p_result text,
  p_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_updated integer;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_result not in ('achieved', 'partial', 'not_achieved') then
    raise exception 'INVALID_ACTION_RESULT';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'COMPLETION_NOTE_REQUIRED';
  end if;

  update public.merchant_requests
  set status = 'done',
      completion_result = p_result,
      completion_note = left(btrim(p_note), 1000),
      completion_recorded_at = now(),
      updated_at = now(),
      resolved_at = now(),
      resolved_by = auth.jwt() ->> 'email'
  where id = p_action_id
    and merchant_code = v_merchant_code
    and request_kind = 'action';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'ACTION_NOT_FOUND'; end if;

  return jsonb_build_object('id', p_action_id, 'status', 'done', 'result', p_result);
end;
$$;

create or replace function public.update_my_action_status(p_action_id uuid, p_status text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_merchant_code text := public.current_merchant_code();
  v_updated integer;
begin
  if auth.uid() is null or v_merchant_code is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'in_progress', 'done') then
    raise exception 'INVALID_ACTION_STATUS';
  end if;

  update public.merchant_requests
  set status = p_status,
      updated_at = now(),
      resolved_at = case when p_status = 'done' then now() else null end,
      resolved_by = case when p_status = 'done' then auth.jwt() ->> 'email' else null end,
      completion_result = case when p_status = 'done' then coalesce(completion_result, 'unknown') else null end,
      completion_note = case when p_status = 'done' then completion_note else null end,
      completion_recorded_at = case when p_status = 'done' then coalesce(completion_recorded_at, now()) else null end
  where id = p_action_id
    and merchant_code = v_merchant_code
    and request_kind = 'action';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'ACTION_NOT_FOUND'; end if;
  return jsonb_build_object('id', p_action_id, 'status', p_status);
end;
$$;

revoke all on function public.capture_my_weekly_brief() from public, anon;
revoke all on function public.set_my_monthly_sales_target(integer,integer,numeric) from public, anon;
revoke all on function public.my_monthly_goal_progress() from public, anon;
revoke all on function public.complete_my_action(uuid,text,text) from public, anon;
revoke all on function public.update_my_action_status(uuid,text) from public, anon;
grant execute on function public.capture_my_weekly_brief() to authenticated, service_role;
grant execute on function public.set_my_monthly_sales_target(integer,integer,numeric) to authenticated, service_role;
grant execute on function public.my_monthly_goal_progress() to authenticated, service_role;
grant execute on function public.complete_my_action(uuid,text,text) to authenticated, service_role;
grant execute on function public.update_my_action_status(uuid,text) to authenticated;

comment on table public.merchant_weekly_briefs is
  'Tenant-isolated, server-recalculated weekly operating snapshots. Client input cannot forge calculated values.';
comment on function public.capture_my_weekly_brief() is
  'Idempotently captures the authenticated merchant current week using server-calculated evidence.';
comment on function public.complete_my_action(uuid,text,text) is
  'Completes one tenant-owned action with a required merchant outcome and note.';
