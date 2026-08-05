-- pg_net creates runtime objects in `net`, but its extension metadata was
-- attached to the exposed `public` schema. Recreate it under `extensions`
-- and remove the default PUBLIC network/queue privileges that would allow a
-- browser JWT to issue arbitrary outbound requests or inspect responses.

create schema if not exists extensions;

lock table net.http_request_queue in access exclusive mode;

do $$
begin
  if exists (select 1 from net.http_request_queue) then
    raise exception 'pg_net has pending requests; retry the migration after the queue drains';
  end if;
end
$$;

create temporary table pg_net_response_backup on commit drop as
select id, status_code, content_type, headers, content, timed_out, error_msg, created
from net._http_response;

drop extension pg_net;
create extension pg_net with schema extensions;

insert into net._http_response (
  id, status_code, content_type, headers, content, timed_out, error_msg, created
)
select id, status_code, content_type, headers, content, timed_out, error_msg, created
from pg_net_response_backup;

revoke all on schema net from public, anon, authenticated;
revoke all on all functions in schema net from public, anon, authenticated;
revoke all on all tables in schema net from public, anon, authenticated;
revoke all on all sequences in schema net from public, anon, authenticated;

grant usage on schema net to postgres, service_role, supabase_functions_admin;
grant execute on all functions in schema net to postgres, service_role, supabase_functions_admin;
grant select, insert, update, delete on all tables in schema net to postgres, service_role, supabase_functions_admin;
grant usage, select, update on all sequences in schema net to postgres, service_role, supabase_functions_admin;

-- Supabase's extension event trigger intentionally restores broad pg_net
-- defaults after CREATE/ALTER EXTENSION. Run last (event triggers are ordered
-- by name) and re-apply Sellpert's trusted-role boundary after future upgrades.
create or replace function security.restrict_pg_net_access()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from pg_event_trigger_ddl_commands() ev
    join pg_extension ext on ext.oid = ev.objid
    where ext.extname = 'pg_net'
  ) then
    execute 'revoke all on schema net from public, anon, authenticated';
    execute 'revoke all on all functions in schema net from public, anon, authenticated';
    execute 'revoke all on all tables in schema net from public, anon, authenticated';
    execute 'revoke all on all sequences in schema net from public, anon, authenticated';
    execute 'grant usage on schema net to postgres, service_role, supabase_functions_admin';
    execute 'grant execute on all functions in schema net to postgres, service_role, supabase_functions_admin';
    execute 'grant select, insert, update, delete on all tables in schema net to postgres, service_role, supabase_functions_admin';
    execute 'grant usage, select, update on all sequences in schema net to postgres, service_role, supabase_functions_admin';
  end if;
end
$$;

revoke all on function security.restrict_pg_net_access() from public, anon, authenticated;
grant execute on function security.restrict_pg_net_access() to postgres;

drop event trigger if exists zz_sellpert_restrict_pg_net_access;
create event trigger zz_sellpert_restrict_pg_net_access
on ddl_command_end
when tag in ('CREATE EXTENSION', 'ALTER EXTENSION')
execute function security.restrict_pg_net_access();

do $$
begin
  if not exists (
    select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='pg_net' and n.nspname='extensions'
  ) then
    raise exception 'pg_net extension was not relocated to extensions';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'net.http_post is unavailable after relocation';
  end if;
end
$$;
