-- Isolated database regression test. Never run against production.
begin;

do $$
declare
  browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(browser_role, 'public.amazon_oauth_states', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_any_column_privilege(browser_role, 'public.amazon_oauth_states', 'SELECT, INSERT, UPDATE, REFERENCES') then
      raise exception 'browser role % retains OAuth state access', browser_role;
    end if;
  end loop;

  if not exists (
    select 1 from pg_class
    where oid = 'public.amazon_oauth_states'::regclass and relrowsecurity
  ) then
    raise exception 'Amazon OAuth state RLS is disabled';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'amazon_oauth_states'
      and policyname = 'amazon_oauth_states_server_only'
      and qual = 'false' and with_check = 'false'
      and roles @> array['anon', 'authenticated']::name[]
  ) then
    raise exception 'Amazon OAuth state deny-all policy is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'amazon_oauth_states'
      and policyname = 'sellpert_require_mfa_if_enrolled'
      and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'Amazon OAuth state MFA defense is missing';
  end if;
end
$$;

-- Follow the self-service Auth fixture path used by the other isolation tests.
insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000008961', 'authenticated', 'authenticated', 'amazon-state-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Amazon State A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000008962', 'authenticated', 'authenticated', 'amazon-state-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Amazon State B"}', now(), now(), now(), false, false);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  user_a constant uuid := '00000000-0000-4000-8000-000000008961';
  user_b constant uuid := '00000000-0000-4000-8000-000000008962';
  merchant_a text;
  merchant_b text;
  affected integer;
  conflict_constraint text;
begin
  select merchant_code into strict merchant_a from public.merchants where id = user_a;
  select merchant_code into strict merchant_b from public.merchants where id = user_b;
  if merchant_a is null or merchant_b is null or merchant_a = merchant_b then
    raise exception 'Amazon security fixtures did not create distinct workspaces';
  end if;

  insert into public.amazon_oauth_states (
    state_hash, merchant_code, user_id, marketplace_id, created_at, expires_at
  ) values
    (repeat('a', 64), merchant_a, user_a, 'A17E79C6D8DWNP', now(), now() + interval '10 minutes'),
    (repeat('b', 64), merchant_a, user_a, 'A17E79C6D8DWNP', now() - interval '20 minutes', now() - interval '10 minutes'),
    (repeat('c', 64), merchant_a, user_a, 'A17E79C6D8DWNP', now(), now() + interval '15 minutes');

  begin
    insert into public.amazon_oauth_states (
      state_hash, merchant_code, user_id, marketplace_id, created_at, expires_at
    ) values (repeat('d', 64), merchant_a, user_a, 'A17E79C6D8DWNP', now(), now() + interval '16 minutes');
    raise exception 'OAuth state accepted a lifetime exceeding 15 minutes';
  exception when check_violation then null;
  end;
  begin
    insert into public.amazon_oauth_states (
      state_hash, merchant_code, user_id, marketplace_id, created_at, expires_at
    ) values (repeat('e', 64), merchant_a, user_a, 'A17E79C6D8DWNP', now(), now());
    raise exception 'OAuth state accepted a nonpositive lifetime';
  exception when check_violation then null;
  end;

  -- Match the handler's single conditional UPDATE. A mismatch must not consume
  -- the row, even when the caller knows the state hash.
  update public.amazon_oauth_states set consumed_at = now()
  where state_hash = repeat('a', 64) and user_id = user_b
    and merchant_code = merchant_a and consumed_at is null and expires_at > now();
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'a different user consumed the OAuth state'; end if;

  update public.amazon_oauth_states set consumed_at = now()
  where state_hash = repeat('a', 64) and user_id = user_a
    and merchant_code = merchant_b and consumed_at is null and expires_at > now();
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'a different workspace consumed the OAuth state'; end if;

  update public.amazon_oauth_states set consumed_at = now()
  where state_hash = repeat('b', 64) and user_id = user_a
    and merchant_code = merchant_a and consumed_at is null and expires_at > now();
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'an expired OAuth state was consumed'; end if;

  update public.amazon_oauth_states set consumed_at = now()
  where state_hash = repeat('a', 64) and user_id = user_a
    and merchant_code = merchant_a and consumed_at is null and expires_at > now();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'the matching valid OAuth state could not be consumed'; end if;

  update public.amazon_oauth_states set consumed_at = now()
  where state_hash = repeat('a', 64) and user_id = user_a
    and merchant_code = merchant_a and consumed_at is null and expires_at > now();
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'an OAuth state was consumed twice'; end if;

  -- No credentials are needed to test seller uniqueness. All identities are synthetic.
  insert into public.platform_credentials (merchant_code, platform, seller_id, is_active)
  values (merchant_a, 'amazon', 'AAMAZONTEST8961', true);
  begin
    insert into public.platform_credentials (merchant_code, platform, seller_id, is_active)
    values (merchant_b, 'amazon', 'AAMAZONTEST8961', true);
    raise exception 'two workspaces acquired the same active Amazon seller';
  exception when unique_violation then
    get stacked diagnostics conflict_constraint = constraint_name;
    if conflict_constraint <> 'platform_credentials_active_amazon_seller_uidx' then
      raise exception 'duplicate seller test failed on an unrelated constraint: %', conflict_constraint;
    end if;
  end;

  insert into public.platform_credentials (merchant_code, platform, seller_id, is_active)
  values (merchant_b, 'amazon', 'AAMAZONTEST8961', false);
  begin
    update public.platform_credentials set is_active = true
    where merchant_code = merchant_b and platform = 'amazon';
    raise exception 'reactivation bypassed active Amazon seller uniqueness';
  exception when unique_violation then
    get stacked diagnostics conflict_constraint = constraint_name;
    if conflict_constraint <> 'platform_credentials_active_amazon_seller_uidx' then
      raise exception 'seller reactivation failed on an unrelated constraint: %', conflict_constraint;
    end if;
  end;

  update public.platform_credentials set seller_id = 'AAMAZONTEST8962', is_active = true
  where merchant_code = merchant_b and platform = 'amazon';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'a different Amazon seller could not be activated'; end if;
end
$$;

reset role;
rollback;
