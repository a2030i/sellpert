-- MFA is optional, but once a user opts in it must be a real authorization
-- boundary. This restrictive policy composes with every existing tenant policy:
-- users without a verified factor may use aal1 or aal2, while opted-in users
-- must present an aal2 JWT. Service-role workers are not targeted.
do $migration$
declare
  target record;
  predicate constant text := $policy$
    array[coalesce((select auth.jwt()->>'aal'), 'aal1')] <@ (
      select case
        when count(id) > 0 then array['aal2']::text[]
        else array['aal1', 'aal2']::text[]
      end
      from auth.mfa_factors
      where user_id = (select auth.uid())
        and status = 'verified'
    )
  $policy$;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists sellpert_require_mfa_if_enrolled on %I.%I', target.schema_name, target.table_name);
    execute format(
      'create policy sellpert_require_mfa_if_enrolled on %I.%I as restrictive for all to authenticated using (%s) with check (%s)',
      target.schema_name, target.table_name, predicate, predicate
    );
  end loop;

  if to_regclass('storage.objects') is not null then
    drop policy if exists sellpert_require_mfa_if_enrolled on storage.objects;
    execute format(
      'create policy sellpert_require_mfa_if_enrolled on storage.objects as restrictive for all to authenticated using (%s) with check (%s)',
      predicate, predicate
    );
  end if;
end
$migration$;

comment on policy sellpert_require_mfa_if_enrolled on public.merchants is
  'Restrictive opt-in MFA boundary: verified-factor users must present an aal2 JWT in addition to normal tenant policies.';
