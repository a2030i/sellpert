-- Operational release state contains no credentials or customer records.
create table if not exists security.sellpert_release_control (
 singleton boolean primary key default true check (singleton),
 maintenance boolean not null default false,
 required_client text,
 paused_cron_ids bigint[] not null default '{}',
 baseline_counts jsonb not null default '{}',
 source_commit text,
 schema_verified boolean not null default false,
 handlers_verified boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table security.sellpert_release_control enable row level security;
revoke all on security.sellpert_release_control from public, anon, authenticated, service_role;
insert into security.sellpert_release_control(singleton) values(true) on conflict do nothing;

create or replace function security.require_current_release()
returns void language plpgsql security definer set search_path = '' as $$
declare gate security.sellpert_release_control%rowtype;
 request_role text := coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','anon');
 client_info text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-client-info','');
begin
 select * into strict gate from security.sellpert_release_control where singleton;
 if gate.maintenance then
   raise sqlstate 'PT503' using message='يجري تحديث النظام، يرجى إعادة المحاولة بعد قليل';
 end if;
 -- This compatibility check is only for browsers; server-side actor clients
 -- use the same JWT with no Origin header. It is not an authorization boundary.
 if request_role='authenticated'
    and coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'origin','') <> ''
    and gate.required_client is not null
    and client_info <> gate.required_client then
   raise sqlstate 'PT409' using message='تم تحديث النظام. حدّث الصفحة للمتابعة', detail='APP_RELOAD_REQUIRED';
 end if;
end $$;
revoke all on function security.require_current_release() from public;
grant execute on function security.require_current_release() to anon, authenticated, service_role;

create or replace function security.freeze_release_writes()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- SECURITY DEFINER business RPCs still have session_user=authenticator.
 -- Only the direct postgres deployment connection may change rows during cutover.
 if session_user <> 'postgres' and exists (
   select 1 from security.sellpert_release_control where singleton and maintenance
 ) then raise sqlstate 'PT503' using message='SELLPERT_RELEASE_MAINTENANCE'; end if;
 return null;
end $$;
revoke all on function security.freeze_release_writes() from public,anon,authenticated,service_role;
