-- Privacy-safe first-party incident reporting for authenticated workspaces.
-- Raw messages, stack traces, URLs with query strings, and arbitrary metadata
-- are intentionally not accepted by this boundary.

create table security.client_incidents (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null,
  user_id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  category text not null check (category in ('render', 'unhandled', 'network', 'api', 'journey')),
  severity text not null check (severity in ('warning', 'error', 'fatal')),
  page_path text not null check (length(page_path) between 1 and 160 and page_path like '/%' and page_path not like '%?%' and page_path not like '%#%'),
  component text not null check (length(component) between 1 and 80),
  action text check (action is null or length(action) between 1 and 80),
  error_code text not null check (length(error_code) between 1 and 80),
  http_status smallint check (http_status is null or http_status between 100 and 599),
  release text not null default 'web' check (length(release) between 1 and 64),
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

alter table security.client_incidents enable row level security;
revoke all on table security.client_incidents from public, anon, authenticated;
grant select, insert, update, delete on table security.client_incidents to service_role;

create unique index client_incidents_open_fingerprint_idx
  on security.client_incidents (merchant_code, fingerprint)
  where status = 'open';
create index client_incidents_status_seen_idx
  on security.client_incidents (status, last_seen_at desc);
create index client_incidents_merchant_seen_idx
  on security.client_incidents (merchant_code, last_seen_at desc);
create index client_incidents_user_rate_idx
  on security.client_incidents (user_id, first_seen_at desc);

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
  v_merchant_code text;
  v_category text;
  v_severity text;
  v_page_path text;
  v_component text;
  v_action text;
  v_error_code text;
  v_release text;
  v_fingerprint text;
  v_id uuid;
  v_occurrences integer;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_merchant_code := security.current_merchant_code();
  if v_merchant_code is null then
    raise exception 'workspace_not_found' using errcode = '42501';
  end if;

  v_category := lower(coalesce(nullif(btrim(p_category), ''), 'unhandled'));
  if v_category not in ('render', 'unhandled', 'network', 'api', 'journey') then
    v_category := 'unhandled';
  end if;

  v_severity := lower(coalesce(nullif(btrim(p_severity), ''), 'error'));
  if v_severity not in ('warning', 'error', 'fatal') then
    v_severity := 'error';
  end if;

  v_page_path := left(split_part(split_part(coalesce(nullif(btrim(p_page_path), ''), '/'), '?', 1), '#', 1), 160);
  v_page_path := regexp_replace(v_page_path, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}', ':id', 'g');
  v_page_path := regexp_replace(v_page_path, '/[0-9]{4,}(/|$)', '/:id\1', 'g');
  v_page_path := regexp_replace(v_page_path, '[^/a-zA-Z0-9_:\.-]', '', 'g');
  if v_page_path = '' or left(v_page_path, 1) <> '/' then
    v_page_path := '/';
  end if;

  v_component := left(lower(regexp_replace(coalesce(nullif(btrim(p_component), ''), 'application'), '[^a-zA-Z0-9._:-]', '', 'g')), 80);
  if v_component = '' then v_component := 'application'; end if;
  if v_component not in ('application', 'react', 'window', 'auth', 'orders', 'products', 'inventory', 'integrations', 'api', 'navigation') then
    v_component := 'application';
  end if;

  v_action := nullif(left(lower(regexp_replace(coalesce(btrim(p_action), ''), '[^a-zA-Z0-9._:-]', '', 'g')), 80), '');
  if v_action is not null and v_action not in ('render', 'error', 'promise_rejection', 'load', 'save', 'sync', 'upload', 'login', 'signup', 'logout', 'navigate', 'action') then
    v_action := 'action';
  end if;
  v_error_code := left(lower(regexp_replace(split_part(coalesce(nullif(btrim(p_error_code), ''), 'unknown_error'), ':', 1), '[^a-zA-Z0-9._-]', '', 'g')), 80);
  if v_error_code = '' then v_error_code := 'unknown_error'; end if;
  if v_error_code not in ('application_error', 'unknown_error', 'typeerror', 'error', 'network_failure', 'chunk_load_failure', 'request_timeout', 'authorization_failure', 'request_aborted', 'api_failure', 'validation_failure') then
    v_error_code := 'unknown_error';
  end if;

  if p_http_status is not null and (p_http_status < 100 or p_http_status > 599) then
    p_http_status := null;
  end if;

  v_release := left(regexp_replace(coalesce(nullif(btrim(p_release), ''), 'web'), '[^a-zA-Z0-9._:-]', '', 'g'), 64);
  if v_release = '' then v_release := 'web'; end if;

  v_fingerprint := encode(extensions.digest(
    convert_to(concat_ws('|', v_category, v_severity, v_page_path, v_component, coalesce(v_action, ''), v_error_code, coalesce(p_http_status::text, ''), v_release), 'UTF8'),
    'sha256'
  ), 'hex');

  select incident.id, incident.occurrence_count
    into v_id, v_occurrences
  from security.client_incidents incident
  where incident.merchant_code = v_merchant_code
    and incident.fingerprint = v_fingerprint
    and incident.status = 'open';

  if v_id is null and (
    select count(*) from security.client_incidents incident
    where incident.user_id = v_user_id
      and incident.first_seen_at > now() - interval '10 minutes'
  ) >= 30 then
    return jsonb_build_object('accepted', false, 'reason', 'rate_limited');
  end if;

  insert into security.client_incidents (
    merchant_code, user_id, fingerprint, category, severity, page_path,
    component, action, error_code, http_status, release
  ) values (
    v_merchant_code, v_user_id, v_fingerprint, v_category, v_severity, v_page_path,
    v_component, v_action, v_error_code, p_http_status, v_release
  )
  on conflict (merchant_code, fingerprint) where status = 'open'
  do update set
    occurrence_count = security.client_incidents.occurrence_count + 1,
    last_seen_at = now(),
    severity = case
      when excluded.severity = 'fatal' then 'fatal'
      when excluded.severity = 'error' and security.client_incidents.severity = 'warning' then 'error'
      else security.client_incidents.severity
    end,
    user_id = excluded.user_id,
    http_status = coalesce(excluded.http_status, security.client_incidents.http_status),
    release = excluded.release
  returning id, occurrence_count into v_id, v_occurrences;

  return jsonb_build_object('accepted', true, 'id', v_id, 'occurrences', v_occurrences);
end
$$;

create function public.report_client_incident(
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
    p_category, p_severity, p_page_path, p_component, p_action,
    p_error_code, p_http_status, p_release
  )
$$;

create function security.update_client_incident_status(
  p_incident_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
  v_status text := lower(coalesce(nullif(btrim(p_status), ''), ''));
begin
  if not security.has_platform_permission('view_db_health') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_status not in ('open', 'resolved', 'ignored') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  update security.client_incidents
  set status = v_status,
      resolved_at = case when v_status = 'open' then null else now() end,
      resolved_by = case when v_status = 'open' then null else (select auth.uid()) end
  where id = p_incident_id;
  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

create function public.update_client_incident_status(
  p_incident_id uuid,
  p_status text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$ select security.update_client_incident_status(p_incident_id, p_status) $$;

create function security.prune_client_incidents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  delete from security.client_incidents
  where (status in ('resolved', 'ignored') and last_seen_at < now() - interval '90 days')
     or last_seen_at < now() - interval '180 days';
  get diagnostics affected = row_count;
  return affected;
end
$$;

create or replace function security.get_db_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not security.has_platform_permission('view_db_health') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  result := security.get_db_health_internal();
  return result || jsonb_build_object(
    'client_incident_stats', (
      select jsonb_build_object(
        'open', count(*) filter (where status = 'open'),
        'fatal_open', count(*) filter (where status = 'open' and severity = 'fatal'),
        'new_24h', count(*) filter (where first_seen_at > now() - interval '24 hours'),
        'occurrences_24h', coalesce(sum(occurrence_count) filter (where last_seen_at > now() - interval '24 hours'), 0)
      ) from security.client_incidents
    ),
    'recent_client_incidents', (
      select coalesce(jsonb_agg(item order by incident_time desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', incident.id,
          'source', 'client',
          'merchant_code', incident.merchant_code,
          'platform', null,
          'occurred_at', incident.last_seen_at,
          'category', incident.category,
          'severity', incident.severity,
          'page_path', incident.page_path,
          'component', incident.component,
          'action', incident.action,
          'error_code', incident.error_code,
          'http_status', incident.http_status,
          'release', incident.release,
          'occurrence_count', incident.occurrence_count,
          'status', incident.status,
          'message', concat(incident.category, ': ', incident.component, ' · ', incident.error_code)
        ) as item,
        incident.last_seen_at as incident_time
        from security.client_incidents incident
        where incident.status = 'open'
        order by incident.last_seen_at desc
        limit 20
      ) recent
    )
  );
end
$$;

revoke all on function security.report_client_incident(text, text, text, text, text, text, integer, text) from public, anon;
revoke all on function public.report_client_incident(text, text, text, text, text, text, integer, text) from public, anon;
grant execute on function security.report_client_incident(text, text, text, text, text, text, integer, text) to authenticated, service_role;
grant execute on function public.report_client_incident(text, text, text, text, text, text, integer, text) to authenticated, service_role;

revoke all on function security.update_client_incident_status(uuid, text) from public, anon;
revoke all on function public.update_client_incident_status(uuid, text) from public, anon;
grant execute on function security.update_client_incident_status(uuid, text) to authenticated, service_role;
grant execute on function public.update_client_incident_status(uuid, text) to authenticated, service_role;

revoke all on function security.prune_client_incidents() from public, anon, authenticated;
grant execute on function security.prune_client_incidents() to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'client-incident-retention';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'client-incident-retention',
    '31 3 * * *',
    $cron$select security.prune_client_incidents()$cron$
  );
end
$$;

comment on table security.client_incidents is 'Privacy-safe, deduplicated application incidents. No raw messages, stacks, URLs with queries, or arbitrary metadata.';
comment on function public.report_client_incident(text, text, text, text, text, text, integer, text) is 'SECURITY INVOKER API wrapper for authenticated, tenant-derived incident reporting.';
comment on function public.update_client_incident_status(uuid, text) is 'SECURITY INVOKER API wrapper for privileged incident triage.';

notify pgrst, 'reload schema';
