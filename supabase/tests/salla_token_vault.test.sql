begin;

do $$
begin
  if has_function_privilege('anon', 'public.get_salla_connection_tokens(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.get_salla_connection_tokens(uuid)', 'execute')
     or has_function_privilege('anon', 'public.store_salla_connection_tokens(uuid,text,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.store_salla_connection_tokens(uuid,text,text,timestamptz)', 'execute') then
    raise exception 'browser roles can execute Salla token Vault functions';
  end if;
  if not has_function_privilege('service_role', 'public.get_salla_connection_tokens(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.store_salla_connection_tokens(uuid,text,text,timestamptz)', 'execute') then
    raise exception 'service role cannot execute Salla token Vault functions';
  end if;
  if exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in ('get_salla_connection_tokens', 'store_salla_connection_tokens')
      and procedure.prosecdef
  ) then
    raise exception 'Salla token Vault exposed a SECURITY DEFINER function in public';
  end if;
end
$$;

insert into public.merchants (id, merchant_code, name, email, role)
values ('79000000-0000-0000-0000-000000000001', 'SALLA-VAULT-TEST', 'Vault Test', 'salla-vault@example.test', 'merchant');

insert into public.salla_connections (
  id, merchant_code, salla_store_id, access_token, refresh_token
) values (
  '79000000-0000-0000-0000-000000000002', 'SALLA-VAULT-TEST', 'vault-store-test', null, null
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.store_salla_connection_tokens(
  '79000000-0000-0000-0000-000000000002',
  'encrypted-access-test',
  'encrypted-refresh-test',
  '2026-08-05T00:00:00Z'
);

do $$
declare
  tokens record;
begin
  select * into tokens
  from public.get_salla_connection_tokens('79000000-0000-0000-0000-000000000002');
  if tokens.access_token <> 'encrypted-access-test' or tokens.refresh_token <> 'encrypted-refresh-test' then
    raise exception 'Vault token round-trip failed';
  end if;
end
$$;

reset role;

do $$
begin
  if exists (
    select 1 from public.salla_connections
    where id = '79000000-0000-0000-0000-000000000002'
      and (access_token is not null or refresh_token is not null)
  ) then
    raise exception 'Salla connection retained plaintext OAuth tokens';
  end if;
  if not exists (
    select 1 from public.salla_connections
    where id = '79000000-0000-0000-0000-000000000002'
      and access_token_secret_id is not null
      and refresh_token_secret_id is not null
  ) then
    raise exception 'Salla connection did not retain Vault references';
  end if;

  begin
    insert into public.salla_connections (
      id, merchant_code, salla_store_id, access_token
    ) values (
      '79000000-0000-0000-0000-000000000003', 'SALLA-VAULT-TEST', 'plaintext-store-test', 'must-be-rejected'
    );
    raise exception 'plaintext Salla token write unexpectedly succeeded';
  exception when check_violation then null;
  end;
end
$$;

rollback;
