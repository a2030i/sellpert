-- RLS policies execute as the calling role. Reading auth.mfa_factors directly
-- from a policy therefore fails for authenticated users. Keep the Auth table
-- private and expose only the boolean decision through a hardened helper.

create or replace function security.mfa_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from auth.mfa_factors factor
      where factor.user_id = (select auth.uid())
        and factor.status = 'verified'::auth.factor_status
    )
      then coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    else coalesce((select auth.jwt() ->> 'aal'), 'aal1') in ('aal1', 'aal2')
  end
$$;

revoke execute on function security.mfa_access_allowed() from public, anon;
grant execute on function security.mfa_access_allowed() to authenticated, service_role;

do $$
declare
  target record;
begin
  for target in
    select schemaname, tablename
    from pg_catalog.pg_policies
    where policyname = 'sellpert_require_mfa_if_enrolled'
      and schemaname in ('public', 'storage')
  loop
    execute format(
      'drop policy %I on %I.%I',
      'sellpert_require_mfa_if_enrolled', target.schemaname, target.tablename
    );
    execute format(
      'create policy %I on %I.%I as restrictive for all to authenticated using ((select security.mfa_access_allowed())) with check ((select security.mfa_access_allowed()))',
      'sellpert_require_mfa_if_enrolled', target.schemaname, target.tablename
    );
  end loop;
end
$$;

comment on function security.mfa_access_allowed() is
  'Returns whether the current session satisfies opt-in MFA without exposing auth.mfa_factors.';

notify pgrst, 'reload schema';
