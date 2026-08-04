-- A self-service signup may create its tenant record inside the Auth insert
-- transaction, but the workspace must not become usable until the email
-- address has been verified by Supabase Auth.

create or replace function security.handle_self_service_merchant_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_name text;
  v_phone text;
  v_attempt integer := 0;
begin
  if coalesce(new.raw_user_meta_data->>'signup_source', '') <> 'self_service' then
    return new;
  end if;

  v_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'متجر جديد'
    ),
    120
  );
  v_phone := nullif(left(btrim(new.raw_user_meta_data->>'whatsapp_phone'), 32), '');

  loop
    v_attempt := v_attempt + 1;
    v_code := 'M-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 16));

    begin
      insert into public.merchants (
        id, merchant_code, name, email, currency, role,
        subscription_plan, subscription_status, signup_source,
        whatsapp_phone, is_active
      ) values (
        new.id,
        v_code,
        v_name,
        lower(new.email),
        'SAR',
        'merchant',
        'free',
        'active',
        'self_service',
        v_phone,
        new.email_confirmed_at is not null
      );
      exit;
    exception
      when unique_violation then
        if exists (select 1 from public.merchants where id = new.id) then
          return new;
        end if;
        if v_attempt >= 3 then
          raise;
        end if;
    end;
  end loop;

  return new;
end
$$;

create or replace function security.activate_verified_self_service_merchant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.merchants
    set is_active = true
    where id = new.id
      and signup_source = 'self_service'
      and is_active is false;
  end if;

  return new;
end
$$;

revoke all on function security.handle_self_service_merchant_signup()
  from public, anon, authenticated;
revoke all on function security.activate_verified_self_service_merchant()
  from public, anon, authenticated;
grant execute on function security.handle_self_service_merchant_signup() to service_role;
grant execute on function security.activate_verified_self_service_merchant() to service_role;

drop trigger if exists on_auth_user_verified_activate_merchant on auth.users;
create trigger on_auth_user_verified_activate_merchant
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function security.activate_verified_self_service_merchant();

-- Converge any rows created before this release. Confirmed workspaces remain
-- active; an unverified identity cannot retain an active tenant workspace.
update public.merchants merchant
set is_active = (users.email_confirmed_at is not null)
from auth.users users
where merchant.id = users.id
  and merchant.signup_source = 'self_service'
  and merchant.is_active is distinct from (users.email_confirmed_at is not null);

comment on function security.handle_self_service_merchant_signup() is
  'Atomically provisions an isolated self-service workspace which remains inactive until Auth verifies the email address.';
comment on function security.activate_verified_self_service_merchant() is
  'Activates only the self-service workspace owned by an Auth identity after its first email confirmation.';
