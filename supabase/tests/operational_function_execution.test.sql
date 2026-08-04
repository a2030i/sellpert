-- Internal queue processors and trigger implementations must never become
-- callable RPCs for browser roles, including through PostgreSQL PUBLIC grants.
begin;

do $$
declare
  function_name text;
begin
  if exists (
    select 1
    from pg_catalog.pg_proc fn
    join pg_catalog.pg_namespace namespace on namespace.oid = fn.pronamespace
    where namespace.nspname = 'public'
      and has_function_privilege('anon', fn.oid, 'execute')
  ) then
    raise exception 'public schema exposes one or more functions to anon';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc fn
    join pg_catalog.pg_namespace namespace on namespace.oid = fn.pronamespace
    where namespace.nspname = 'public'
      and fn.prorettype = 'trigger'::regtype
      and has_function_privilege('authenticated', fn.oid, 'execute')
  ) then
    raise exception 'authenticated role can execute a public trigger implementation';
  end if;

  foreach function_name in array array[
    'public.process_sync_queue(integer)',
    'public.prepare_merchant_weekly_brief()',
    'public.update_updated_at()'
  ] loop
    if has_function_privilege('anon', function_name, 'execute')
       or has_function_privilege('authenticated', function_name, 'execute') then
      raise exception 'browser role can execute internal function %', function_name;
    end if;
    if not has_function_privilege('service_role', function_name, 'execute') then
      raise exception 'service role lost internal function %', function_name;
    end if;
  end loop;

end
$$;

set local role authenticated;

do $$
begin
  begin
    perform public.process_sync_queue(0);
    raise exception 'authenticated role invoked the internal queue processor';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
set local role service_role;

do $$
begin
  perform public.process_sync_queue(0);
end
$$;

reset role;
rollback;
