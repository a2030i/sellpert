-- Repeated reports of the same fingerprint previously bypassed the incident
-- rate limit because only newly inserted rows were counted. Keep an atomic,
-- per-user acceptance window in the private security schema and place it in
-- front of the existing privacy normalization/deduplication implementation.

create table if not exists security.client_incident_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default clock_timestamp(),
  accepted_count integer not null default 0 check (accepted_count between 0 and 30),
  updated_at timestamptz not null default clock_timestamp()
);

alter table security.client_incident_rate_limits enable row level security;
revoke all on table security.client_incident_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table security.client_incident_rate_limits to service_role;

alter function security.report_client_incident(text, text, text, text, text, text, integer, text)
  rename to report_client_incident_unbounded;

revoke all on function security.report_client_incident_unbounded(text, text, text, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function security.report_client_incident_unbounded(text, text, text, text, text, text, integer, text)
  to service_role;

create function security.report_client_incident(
  p_category text,
  p_severity text,
  p_page_path text,
  p_component text,
  p_action text default null::text,
  p_error_code text default null::text,
  p_http_status integer default null::integer,
  p_release text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_window_started_at timestamptz;
  v_accepted_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  -- Serialize quota changes for one caller. A hash collision only serializes
  -- unrelated callers; it cannot grant or bypass quota.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select limiter.window_started_at, limiter.accepted_count
    into v_window_started_at, v_accepted_count
  from security.client_incident_rate_limits limiter
  where limiter.user_id = v_user_id
  for update;

  if not found then
    insert into security.client_incident_rate_limits (
      user_id, window_started_at, accepted_count, updated_at
    ) values (
      v_user_id, v_now, 1, v_now
    );
  elsif v_window_started_at <= v_now - interval '10 minutes' then
    update security.client_incident_rate_limits
    set window_started_at = v_now,
        accepted_count = 1,
        updated_at = v_now
    where user_id = v_user_id;
  elsif v_accepted_count >= 30 then
    -- Do not update the limiter or incident row after the quota is exhausted.
    return jsonb_build_object('accepted', false, 'reason', 'rate_limited');
  else
    update security.client_incident_rate_limits
    set accepted_count = accepted_count + 1,
        updated_at = v_now
    where user_id = v_user_id;
  end if;

  return security.report_client_incident_unbounded(
    p_category,
    p_severity,
    p_page_path,
    p_component,
    p_action,
    p_error_code,
    p_http_status,
    p_release
  );
end
$$;

revoke all on function security.report_client_incident(text, text, text, text, text, text, integer, text)
  from public, anon;
grant execute on function security.report_client_incident(text, text, text, text, text, text, integer, text)
  to authenticated, service_role;

create or replace function public.report_client_incident(
  p_category text,
  p_severity text,
  p_page_path text,
  p_component text,
  p_action text default null::text,
  p_error_code text default null::text,
  p_http_status integer default null::integer,
  p_release text default null::text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select security.report_client_incident(
    p_category, p_severity, p_page_path, p_component,
    p_action, p_error_code, p_http_status, p_release
  )
$$;

revoke all on function public.report_client_incident(text, text, text, text, text, text, integer, text)
  from public, anon;
grant execute on function public.report_client_incident(text, text, text, text, text, text, integer, text)
  to authenticated, service_role;

comment on table security.client_incident_rate_limits is
  'Private atomic acceptance windows for bounded client incident reporting.';
comment on function security.report_client_incident(text, text, text, text, text, text, integer, text) is
  'Atomically limits each authenticated user to 30 accepted client incidents per ten minutes.';
