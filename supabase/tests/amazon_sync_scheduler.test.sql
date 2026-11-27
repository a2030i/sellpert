-- Isolated synthetic regression test. Never run against production.
begin;

do $$
declare
  p record;
  i integer;
  actor_id uuid;
  code text;
begin
  select prosecdef, proconfig into strict p
  from pg_proc where oid = 'security.enqueue_active_marketplace_syncs()'::regprocedure;
  if not p.prosecdef or p.proconfig is distinct from array['search_path=""'] then
    raise exception 'Scheduler lost its definer/empty-search-path boundary';
  end if;
  if has_function_privilege('anon', 'security.enqueue_active_marketplace_syncs()', 'EXECUTE')
     or has_function_privilege('authenticated', 'security.enqueue_active_marketplace_syncs()', 'EXECUTE')
     or not has_function_privilege('service_role', 'security.enqueue_active_marketplace_syncs()', 'EXECUTE') then
    raise exception 'Scheduler execution grants changed';
  end if;
  for i in 1..12 loop
    actor_id := ('00000000-0000-4000-8000-' || lpad((9100 + i)::text, 12, '0'))::uuid;
    insert into auth.users (
      id, aud, role, email, encrypted_password, raw_app_meta_data,
      raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
    ) values (
      actor_id, 'authenticated', 'authenticated', 'amazon-scheduler-' || i || '@test.invalid', '',
      '{"provider":"email","providers":["email"]}',
      '{"signup_source":"self_service","name":"Scheduler fixture"}', now(), now(), now(), false, false
    );
    update public.merchants set is_active = i <> 4,
      workspace_status = case when i = 5 then 'suspended' else 'active' end
      where id = actor_id returning merchant_code into strict code;
    insert into public.marketplace_accounts(id,merchant_code,platform,label,status) values(actor_id,code,'amazon','Scheduler fixture','active');
    insert into public.platform_credentials (marketplace_account_id,merchant_code, platform, seller_id, is_active, last_sync_at)
    values (actor_id,code, 'amazon', 'AMAZON-SCHEDULER-' || i, i <> 3,
      case when i = 2 then now() - interval '21 minutes'
           when i = 6 then now() - interval '10 minutes'
           when i = 7 then now() - interval '20 minutes' else null end);
    if i in (1,12) then
      with a as (insert into public.marketplace_accounts(merchant_code,platform,label,status) values(code,'trendyol','Scheduler fixture','active') returning id)
      insert into public.platform_credentials (marketplace_account_id,merchant_code, platform, is_active)
      select id,code,'trendyol',true from a;
    end if;
    if i in (8, 9, 10, 11, 12) then
      insert into public.sync_queue (merchant_code, platform, marketplace_account_id, job_type, status)
      values (code, case when i = 12 then 'trendyol' else 'amazon' end,
        (select marketplace_account_id from public.platform_credentials where merchant_code=code and platform=case when i=12 then 'trendyol' else 'amazon' end), 'sync_incremental',
        case i when 8 then 'pending' when 9 then 'processing' when 10 then 'running'
          when 11 then 'completed' else 'pending' end);
    end if;
  end loop;
end
$$;

set local role authenticated;
do $$
begin
  begin
    perform security.enqueue_active_marketplace_syncs();
    raise exception 'Authenticated browser caller executed the scheduler';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  i integer;
  code text;
  n integer;
  expected integer;
begin
  perform security.enqueue_active_marketplace_syncs();
  for i in 1..12 loop
    select merchant_code into strict code from public.merchants
    where id = ('00000000-0000-4000-8000-' || lpad((9100 + i)::text, 12, '0'))::uuid;
    select count(*) into n from public.sync_queue
    where merchant_code = code and platform = 'amazon' and status = 'pending';
    expected := case when i in (1, 2, 8, 11, 12) then 1 else 0 end;
    if n <> expected then raise exception 'Amazon eligibility fixture %: expected %, got %', i, expected, n; end if;
    if i = 1 then
      if (select count(*) from public.sync_queue where merchant_code = code and platform = 'trendyol' and status = 'pending') <> 1 then
        raise exception 'Existing Trendyol scheduling regressed';
      end if;
      if not exists (select 1 from public.sync_queue where merchant_code = code and platform = 'amazon'
        and priority = 4 and job_type = 'sync_incremental' and scheduled_at = now()
        and (payload->>'date_to')::timestamptz = date_trunc('second', now() - interval '3 minutes')
        and (payload->>'date_from')::timestamptz = date_trunc('second', now() - interval '90 days')) then
        raise exception 'Inherited job shape, priority or date bounds changed';
      end if;
    end if;
  end loop;
  perform security.enqueue_active_marketplace_syncs();
  if exists (
    select q.merchant_code, q.platform, q.marketplace_account_id from public.sync_queue q
    join public.merchants m on m.merchant_code = q.merchant_code
    where m.id between '00000000-0000-4000-8000-000000009101'::uuid and '00000000-0000-4000-8000-000000009112'::uuid
      and q.status in ('pending', 'processing', 'running')
    group by q.merchant_code, q.platform, q.marketplace_account_id having count(*) > 1
  ) then raise exception 'Repeated scheduler call duplicated an active tenant/platform job'; end if;
end
$$;
reset role;
rollback;
