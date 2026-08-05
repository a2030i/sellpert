-- A professional self-service signup needs an immutable, versioned record of
-- the documents the merchant accepted. The browser supplies the attestation;
-- the database owns the timestamp and tenant identity.

create table public.merchant_legal_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code),
  user_id uuid not null,
  terms_version text not null check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  privacy_version text not null check (privacy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now(),
  source text not null default 'self_service_signup'
    check (source in ('self_service_signup')),
  unique (merchant_code, user_id, terms_version, privacy_version)
);

create index merchant_legal_acceptances_user_idx
  on public.merchant_legal_acceptances(user_id, accepted_at desc);
create index merchant_legal_acceptances_merchant_idx
  on public.merchant_legal_acceptances(merchant_code, accepted_at desc);

alter table public.merchant_legal_acceptances enable row level security;
alter table public.merchant_legal_acceptances force row level security;

revoke all on table public.merchant_legal_acceptances from public, anon, authenticated;
grant select on table public.merchant_legal_acceptances to authenticated;
grant select, insert on table public.merchant_legal_acceptances to service_role;

create policy tenant_boundary
on public.merchant_legal_acceptances
as restrictive
for all
to authenticated
using (security.can_access_merchant(merchant_code))
with check (security.can_access_merchant(merchant_code));

create policy merchant_legal_acceptance_owner_select
on public.merchant_legal_acceptances
for select
to authenticated
using (
  user_id = (select auth.uid())
  and security.can_access_merchant(merchant_code)
);

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
  v_legal_version text;
  v_accepted boolean;
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
  v_legal_version := nullif(left(btrim(new.raw_user_meta_data->>'legal_version'), 10), '');
  v_accepted := coalesce((new.raw_user_meta_data->>'terms_accepted')::boolean, false)
    and coalesce((new.raw_user_meta_data->>'privacy_accepted')::boolean, false)
    and v_legal_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

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

  if v_accepted then
    insert into public.merchant_legal_acceptances (
      merchant_code, user_id, terms_version, privacy_version
    ) values (
      v_code, new.id, v_legal_version, v_legal_version
    );
  end if;

  return new;
end
$$;

revoke all on function security.handle_self_service_merchant_signup()
  from public, anon, authenticated;
grant execute on function security.handle_self_service_merchant_signup() to service_role;

comment on table public.merchant_legal_acceptances is
  'Immutable server-timestamped record of the legal documents accepted during merchant signup.';
comment on function security.handle_self_service_merchant_signup() is
  'Atomically provisions an isolated self-service workspace and records a valid versioned legal attestation.';
