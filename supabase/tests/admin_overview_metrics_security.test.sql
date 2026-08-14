begin;

do $$
declare
  wrapper_is_definer boolean;
begin
  select p.prosecdef into wrapper_is_definer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_overview_metrics';

  if wrapper_is_definer is distinct from false then
    raise exception 'admin overview public wrapper must be SECURITY INVOKER';
  end if;
  if has_function_privilege('anon', 'public.admin_overview_metrics(date,date,text[],text)', 'execute') then
    raise exception 'anon can execute admin overview metrics';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_overview_metrics(date,date,text[],text)', 'execute') then
    raise exception 'authenticated administration users cannot reach overview wrapper';
  end if;
  -- The private implementation must be executable by the invoker wrapper,
  -- while the security schema itself remains outside the exposed API schemas.
  if not has_function_privilege('authenticated', 'security.admin_overview_metrics(date,date,text[],text)', 'execute') then
    raise exception 'authenticated wrapper cannot reach private overview implementation';
  end if;
end
$$;

set local role authenticated;
do $$
begin
  begin
    perform public.admin_overview_metrics(current_date - 6, current_date, null, null);
    raise exception 'unauthorized overview request unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
rollback;
