begin;

do $$
begin
  if to_regclass('public.mfa_recovery_codes') is null then
    raise exception 'mfa_recovery_codes table is missing';
  end if;
  if to_regclass('public.mfa_recovery_attempts') is null then
    raise exception 'mfa_recovery_attempts table is missing';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.mfa_recovery_codes'::regclass) then
    raise exception 'mfa_recovery_codes must use forced RLS';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.mfa_recovery_attempts'::regclass) then
    raise exception 'mfa_recovery_attempts must use forced RLS';
  end if;
  if has_table_privilege('authenticated', 'public.mfa_recovery_codes', 'SELECT') then
    raise exception 'authenticated can read MFA recovery hashes';
  end if;
  if has_table_privilege('authenticated', 'public.mfa_recovery_attempts', 'SELECT') then
    raise exception 'authenticated can read MFA recovery attempts';
  end if;
  if not has_table_privilege('service_role', 'public.mfa_recovery_codes', 'SELECT') then
    raise exception 'service recovery path cannot read MFA recovery hashes';
  end if;
end
$$;

rollback;
