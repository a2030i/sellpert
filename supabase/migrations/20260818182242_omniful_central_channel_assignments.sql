-- Omniful is managed as a Sellpert-level provider account by default. Merchants
-- only receive sanitized sales-channel assignments; provider credentials and
-- raw discovery payloads remain server-only.

alter table public.merchants
  add column if not exists omniful_connection_mode text not null default 'central_account';

alter table public.merchants
  drop constraint if exists merchants_omniful_connection_mode_check;
alter table public.merchants
  add constraint merchants_omniful_connection_mode_check
  check (omniful_connection_mode in ('central_account', 'merchant_account'));

create table if not exists public.omniful_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  account_key text not null unique,
  display_name text not null,
  account_type text not null default 'central_account'
    check (account_type in ('central_account')),
  secret_blob text,
  token_hint text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'error', 'disabled')),
  last_tested_at timestamptz,
  last_discovered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.omniful_channels (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid references public.omniful_provider_accounts(id) on delete cascade,
  owner_merchant_code text references public.merchants(merchant_code) on delete cascade,
  account_scope text not null
    check (account_scope in ('central_account', 'merchant_account')),
  provider_channel_id text not null,
  platform_code text not null,
  platform_name text not null,
  display_name text not null,
  seller_ref text,
  store_ref text,
  external_identity_key text,
  identity_status text not null default 'verified'
    check (identity_status in ('verified', 'needs_review')),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'error')),
  capabilities jsonb not null default '{}'::jsonb,
  provider_metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (account_scope = 'central_account' and provider_account_id is not null and owner_merchant_code is null)
    or
    (account_scope = 'merchant_account' and provider_account_id is null and owner_merchant_code is not null)
  )
);

create unique index if not exists omniful_channels_central_provider_id_idx
  on public.omniful_channels (provider_account_id, provider_channel_id);
create unique index if not exists omniful_channels_private_provider_id_idx
  on public.omniful_channels (owner_merchant_code, provider_channel_id);
create unique index if not exists omniful_channels_external_identity_idx
  on public.omniful_channels (external_identity_key)
  where external_identity_key is not null and identity_status = 'verified';
create index if not exists omniful_channels_provider_account_idx
  on public.omniful_channels (provider_account_id);
create index if not exists omniful_channels_owner_merchant_idx
  on public.omniful_channels (owner_merchant_code);
create index if not exists omniful_channels_platform_idx
  on public.omniful_channels (platform_code, status);

create table if not exists public.omniful_channel_assignments (
  channel_id uuid primary key references public.omniful_channels(id) on delete cascade,
  merchant_code text not null references public.merchants(merchant_code) on delete cascade,
  mode text not null default 'shadow'
    check (mode in ('shadow', 'live')),
  status text not null default 'active'
    check (status in ('active', 'paused')),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists omniful_channel_assignments_merchant_idx
  on public.omniful_channel_assignments (merchant_code, status);

alter table public.omniful_provider_accounts enable row level security;
alter table public.omniful_channels enable row level security;
alter table public.omniful_channel_assignments enable row level security;

revoke all on table public.omniful_provider_accounts from public, anon, authenticated;
revoke all on table public.omniful_channels from public, anon, authenticated;
revoke all on table public.omniful_channel_assignments from public, anon, authenticated;
grant all on table public.omniful_provider_accounts to service_role;
grant all on table public.omniful_channels to service_role;
grant all on table public.omniful_channel_assignments to service_role;

create policy omniful_provider_accounts_server_only
  on public.omniful_provider_accounts for all to anon, authenticated
  using (false) with check (false);
create policy omniful_channels_server_only
  on public.omniful_channels for all to anon, authenticated
  using (false) with check (false);
create policy omniful_channel_assignments_server_only
  on public.omniful_channel_assignments for all to anon, authenticated
  using (false) with check (false);

comment on table public.omniful_provider_accounts is
  'Server-only encrypted credentials for Sellpert-managed Omniful provider accounts.';
comment on table public.omniful_channels is
  'Server-only directory of discovered Omniful sales channels. Browser clients receive sanitized projections through an authenticated Edge Function.';
comment on table public.omniful_channel_assignments is
  'Exclusive Omniful channel-to-merchant assignments. The channel primary key prevents assigning one provider channel to multiple merchants.';

-- Promote the credential used by the Shmool experiment into the Sellpert
-- central vault. The encrypted blob can be copied because encryption does not
-- bind it to a merchant identifier. This is deliberately copy-before-delete.
insert into public.omniful_provider_accounts (
  account_key, display_name, account_type, secret_blob, token_hint, status,
  last_tested_at, last_error, updated_at
)
select
  'sellpert-central', 'حساب Sellpert المركزي', 'central_account', secret_blob,
  token_hint, case when secret_blob is null then 'pending' else 'active' end,
  last_tested_at, last_error, now()
from public.omniful_account_credentials
where merchant_code = 'M-6498' and secret_blob is not null
on conflict (account_key) do update set
  secret_blob = coalesce(public.omniful_provider_accounts.secret_blob, excluded.secret_blob),
  token_hint = coalesce(public.omniful_provider_accounts.token_hint, excluded.token_hint),
  status = case when coalesce(public.omniful_provider_accounts.secret_blob, excluded.secret_blob) is null then 'pending' else 'active' end,
  last_tested_at = coalesce(public.omniful_provider_accounts.last_tested_at, excluded.last_tested_at),
  updated_at = now();

insert into public.omniful_provider_accounts (
  account_key, display_name, account_type, status
)
values ('sellpert-central', 'حساب Sellpert المركزي', 'central_account', 'pending')
on conflict (account_key) do nothing;

-- Future signups inherit central_account from the column default. Preserve any
-- genuinely private accounts that may already exist, except Shmool whose
-- credential was explicitly confirmed to be the Sellpert central account.
update public.merchants merchant
set omniful_connection_mode = 'merchant_account'
where merchant.role = 'merchant'
  and merchant.merchant_code <> 'M-6498'
  and exists (
    select 1 from public.omniful_account_credentials credentials
    where credentials.merchant_code = merchant.merchant_code
      and credentials.connection_mode = 'merchant_account'
      and credentials.secret_blob is not null
  );

update public.merchants
set omniful_connection_mode = 'central_account'
where merchant_code = 'M-6498';

-- The known Shmool Trendyol channel is seeded so the already validated trial
-- remains visible immediately. A later discovery refresh enriches its metadata.
insert into public.omniful_channels (
  provider_account_id, account_scope, provider_channel_id, platform_code,
  platform_name, display_name, seller_ref, store_ref, external_identity_key,
  identity_status, status, provider_metadata
)
select
  account.id, 'central_account', 'trendyol:1148158', 'trendyol',
  'Trendyol', 'Trendyol — 1148158', '1148158', '1148158',
  'trendyol:seller:1148158', 'verified', 'active',
  jsonb_build_object('migration_source', 'shmool_shadow_trial')
from public.omniful_provider_accounts account
where account.account_key = 'sellpert-central'
on conflict do nothing;

insert into public.omniful_channel_assignments (channel_id, merchant_code, mode, status)
select channel.id, merchant.merchant_code, 'shadow', 'active'
from public.omniful_channels channel
join public.merchants merchant on merchant.merchant_code = 'M-6498'
where channel.external_identity_key = 'trendyol:seller:1148158'
on conflict (channel_id) do nothing;

-- Remove the merchant-scoped copy only after the central encrypted copy exists.
delete from public.omniful_account_credentials credentials
where credentials.merchant_code = 'M-6498'
  and exists (
    select 1 from public.omniful_provider_accounts account
    where account.account_key = 'sellpert-central'
      and account.secret_blob is not null
  );
