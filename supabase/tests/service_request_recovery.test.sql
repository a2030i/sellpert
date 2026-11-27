-- Local schema contract. No provider writes or customer fixtures.
begin;
do $$ declare t text; begin
 foreach t in array array['service_request_forms','service_request_questions','service_request_stages','service_request_submissions','service_request_activities'] loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=t and c.relrowsecurity and c.relforcerowsecurity) then raise exception 'Service table % is not protected',t; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='sellpert_require_mfa_if_enrolled' and permissive='RESTRICTIVE') then raise exception 'Service table % lacks MFA boundary',t; end if;
  if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('anon','public.'||t,'INSERT') then raise exception 'Anonymous direct service access exposed'; end if;
 end loop;
 if not exists(select 1 from storage.buckets where id='service-request-documents' and not public and file_size_limit=5242880) then raise exception 'Service document bucket missing/private boundary lost'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.service_request_submissions) then raise exception 'Unidentified browser can read service submissions'; end if;
 begin
  insert into public.service_request_forms(name,slug,title) values('Unauthorized fixture','unauthorized-fixture','Unauthorized fixture');
  raise exception 'Unidentified browser created service form';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
