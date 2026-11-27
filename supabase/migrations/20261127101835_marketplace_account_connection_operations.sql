create function security.save_marketplace_credential(p_account_id uuid,p_merchant_code text,p_platform text,p_seller_id text,p_extra jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.marketplace_accounts; current_credential public.platform_credentials; result uuid;
begin
  select * into a from public.marketplace_accounts where id=p_account_id and merchant_code=p_merchant_code
    and platform=p_platform and not is_legacy for update;
  if not found then raise exception 'Selling account not found'; end if;
  if a.external_seller_id is not null and a.external_seller_id<>p_seller_id then
    raise exception 'Reconnect the same seller; use a new account for another seller';
  end if;
  if nullif(btrim(p_seller_id),'') is null or nullif(p_extra->>'secret_blob','') is null then
    raise exception 'Verified seller and encrypted credentials are required';
  end if;
  select * into current_credential from public.platform_credentials where marketplace_account_id=p_account_id for update;
  if current_credential.extra->'sync_lock' is not null and
    coalesce((current_credential.extra->'sync_lock'->>'expires_at')::timestamptz,'infinity')>now() then
    raise exception 'Synchronization is running; retry later';
  end if;
  update public.marketplace_accounts set external_seller_id=p_seller_id,status='active',updated_at=now() where id=p_account_id;
  insert into public.platform_credentials(id,merchant_code,platform,marketplace_account_id,seller_id,api_key,api_secret,extra,is_active,test_status,last_tested_at,updated_at)
    values(p_account_id,p_merchant_code,p_platform,p_account_id,p_seller_id,null,null,p_extra,true,'success',now(),clock_timestamp())
    on conflict (merchant_code,platform,marketplace_account_id) do update
      set seller_id=excluded.seller_id,api_key=null,api_secret=null,extra=coalesce(platform_credentials.extra,'{}'::jsonb) || excluded.extra,is_active=true,
          test_status='success',last_tested_at=excluded.last_tested_at,updated_at=excluded.updated_at
    returning id into result;
  return result;
end $$;
revoke all on function security.save_marketplace_credential(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function security.save_marketplace_credential(uuid,text,text,text,jsonb) to service_role;
create function public.save_marketplace_credential(p_account_id uuid,p_merchant_code text,p_platform text,p_seller_id text,p_extra jsonb)
returns uuid language sql security invoker set search_path='' as $$
  select security.save_marketplace_credential(p_account_id,p_merchant_code,p_platform,p_seller_id,p_extra)
$$;
revoke all on function public.save_marketplace_credential(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_marketplace_credential(uuid,text,text,text,jsonb) to service_role;

create function security.disconnect_marketplace_account(p_account_id uuid,p_merchant_code text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.marketplace_accounts; credential public.platform_credentials;
begin
  select * into a from public.marketplace_accounts where id=p_account_id and merchant_code=p_merchant_code and not is_legacy for update;
  if not found then raise exception 'Selling account not found'; end if;
  select * into credential from public.platform_credentials where marketplace_account_id=p_account_id for update;
  if credential.extra->'sync_lock' is not null and coalesce((credential.extra->'sync_lock'->>'expires_at')::timestamptz,'infinity')>now() then
    raise exception 'Synchronization is running; retry later';
  end if;
  if exists(select 1 from public.sync_queue where marketplace_account_id=p_account_id and status in ('processing','running'))
    or exists(select 1 from public.salla_connections where marketplace_account_id=p_account_id and sync_status='syncing') then
    raise exception 'Synchronization is running; retry later';
  end if;
  update public.marketplace_accounts set status='disconnected',updated_at=now() where id=p_account_id;
  delete from public.platform_credentials where marketplace_account_id=p_account_id;
  -- Vault material stays private and cannot be used after this status change.
  update public.salla_connections set sync_status='disconnected',uninstalled_at=now() where marketplace_account_id=p_account_id;
end $$;
revoke all on function security.disconnect_marketplace_account(uuid,text) from public,anon,authenticated;
grant execute on function security.disconnect_marketplace_account(uuid,text) to service_role;
create function public.disconnect_marketplace_account(p_account_id uuid,p_merchant_code text)
returns void language sql security invoker set search_path='' as $$
  select security.disconnect_marketplace_account(p_account_id,p_merchant_code)
$$;
revoke all on function public.disconnect_marketplace_account(uuid,text) from public,anon,authenticated;
grant execute on function public.disconnect_marketplace_account(uuid,text) to service_role;
