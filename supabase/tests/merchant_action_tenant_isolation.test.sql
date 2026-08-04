-- Regression: merchant actions are deduplicated and cannot be read or changed by another merchant.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous
) values
  ('00000000-0000-4000-8000-000000009981', 'authenticated', 'authenticated', 'action-a@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Action A"}', now(), now(), now(), false, false),
  ('00000000-0000-4000-8000-000000009982', 'authenticated', 'authenticated', 'action-b@test.invalid', '',
   '{"provider":"email","providers":["email"]}', '{"signup_source":"self_service","name":"Action B"}', now(), now(), now(), false, false);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009981';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009981","email":"action-a@test.invalid","role":"authenticated"}';

create temp table action_fixture(id uuid) on commit drop;
insert into action_fixture
select (public.create_my_action('test-source', 'Tenant action', 'operations', 'high', null, 'Safe isolation', '{}', current_date + 3)->>'id')::uuid;

do $$
begin
  begin
    insert into public.merchant_requests (
      merchant_code, type, title, status, admin_note, resolved_by
    ) values (
      public.current_merchant_code(), 'task', 'Forged resolved request',
      'pending', 'must be staff-only', 'forged-staff'
    );
    raise exception 'MERCHANT_FORGED_STAFF_FIELDS';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

do $$
declare
  first_id uuid := (select id from action_fixture);
  duplicate_id uuid;
begin
  duplicate_id := (public.create_my_action('test-source', 'Tenant action', 'operations', 'high', null, 'Safe isolation', '{}', current_date + 3)->>'id')::uuid;
  if duplicate_id <> first_id then
    raise exception 'active action was duplicated';
  end if;
end
$$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009982';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009982","email":"action-b@test.invalid","role":"authenticated"}';

do $$
declare
  action_id uuid := (select id from action_fixture);
begin
  if exists (select 1 from public.merchant_requests where id = action_id) then
    raise exception 'foreign merchant action became visible';
  end if;
  begin
    perform public.update_my_action_status(action_id, 'done');
    raise exception 'CROSS_TENANT_UPDATE_ALLOWED';
  exception when others then
    if sqlerrm = 'CROSS_TENANT_UPDATE_ALLOWED' then raise; end if;
  end;
end
$$;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000009981';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000009981","email":"action-a@test.invalid","role":"authenticated"}';

select public.update_my_action_status((select id from action_fixture), 'in_progress');

do $$
begin
  if (select status from public.merchant_requests where id = (select id from action_fixture)) <> 'in_progress' then
    raise exception 'owner could not update own action status';
  end if;
end
$$;

reset role;
rollback;
