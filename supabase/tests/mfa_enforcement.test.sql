begin;

do $$
declare
  public_rls_tables integer;
  protected_public_tables integer;
begin
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
