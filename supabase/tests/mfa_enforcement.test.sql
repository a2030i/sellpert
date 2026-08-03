begin;

do $$
declare
  public_rls_tables integer;
  protected_public_tables integer;
begin
  if to_regprocedure('security.mfa_access_allowed()') is null then
    raise exception 'private MFA access helper is missing';
  end if;
  if not (select prosecdef from pg_proc where oid = 'security.mfa_access_allowed()'::regprocedure) then
    raise exception 'MFA access helper must protect auth.mfa_factors with SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'security.mfa_access_allowed()'::regprocedure, 'execute') then
    raise exception 'anon can execute the MFA access helper';
  end if;
  if not has_function_privilege('authenticated', 'security.mfa_access_allowed()'::regprocedure, 'execute') then
    raise exception 'authenticated cannot evaluate the MFA access helper';
  end if;

  select count(*) into public_rls_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity;

  select count(*) into protected_public_tables
  from pg_policies
  where schemaname = 'public'
    and policyname = 'sellpert_require_mfa_if_enrolled'
    and permissive = 'RESTRICTIVE'
    and 'authenticated' = any(roles);

  if protected_public_tables <> public_rls_tables then
    raise exception 'opt-in MFA protects % of % public RLS tables', protected_public_tables, public_rls_tables;
  end if;

  if exists (
    select 1
    from pg_policies
    where policyname = 'sellpert_require_mfa_if_enrolled'
      and (coalesce(qual, '') ilike '%auth.mfa_factors%'
        or coalesce(with_check, '') ilike '%auth.mfa_factors%')
  ) then
    raise exception 'an MFA policy still reads auth.mfa_factors directly';
  end if;

  if to_regclass('storage.objects') is not null and not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'sellpert_require_mfa_if_enrolled'
      and permissive = 'RESTRICTIVE'
      and 'authenticated' = any(roles)
  ) then
    raise exception 'storage.objects is missing the opt-in MFA restriction';
  end if;
end
$$;

rollback;
