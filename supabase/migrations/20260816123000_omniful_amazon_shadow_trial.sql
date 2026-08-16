-- Omniful is introduced as an independent shadow source. Existing Amazon
-- Excel imports remain the canonical source until an administrator explicitly
-- promotes a connection after comparing both feeds.

create table if not exists public.omniful_connections (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code) on delete cascade,
  platform text not null default 'amazon'
    check (platform in ('amazon', 'noon', 'trendyol')),
  mode text not null default 'shadow'
    check (mode in ('shadow', 'live')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'error', 'disabled')),
  scope_strategy text not null default 'seller_token'
    check (scope_strategy in ('seller_token', 'seller_ref', 'store_ref')),
  omniful_seller_ref text,
  omniful_store_ref text,
  is_enabled boolean not null default false,
  last_sync_at timestamptz,
  last_cursor text,
  last_error text,
  records_seen integer not null default 0,
  records_matched integer not null default 0,
  records_new integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_code, platform)
);

create table if not exists public.omniful_order_observations (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code) on delete cascade,
  platform text not null check (platform in ('amazon', 'noon', 'trendyol')),
  omniful_order_id text not null,
  external_order_id text,
  canonical_order_id uuid references public.orders(id) on delete set null,
  sales_channel_tag text,
  sales_channel_name text,
  store_name text,
  match_status text not null
    check (match_status in ('matched_excel', 'new_shadow', 'filtered', 'invalid')),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  unique (merchant_code, platform, omniful_order_id)
);

create index if not exists omniful_observations_external_order_idx
  on public.omniful_order_observations (merchant_code, platform, external_order_id)
  where external_order_id is not null;

create index if not exists omniful_observations_match_idx
  on public.omniful_order_observations (merchant_code, platform, match_status, last_seen_at desc);

alter table public.omniful_connections enable row level security;
alter table public.omniful_order_observations enable row level security;

-- Connection metadata and provider payloads are only exposed through the
-- authenticated Edge Function, which returns a deliberately redacted status.
revoke all on table public.omniful_connections from public, anon, authenticated;
revoke all on table public.omniful_order_observations from public, anon, authenticated;
grant all on table public.omniful_connections to service_role;
grant all on table public.omniful_order_observations to service_role;

comment on table public.omniful_connections is
  'Server-only Omniful merchant mappings. No access tokens are stored in this table.';
comment on table public.omniful_order_observations is
  'Shadow copy of Omniful orders used for safe comparison and deduplication before promotion.';
comment on column public.omniful_order_observations.raw is
  'Private Omniful provider payload; service-role access only.';

-- Create the requested trial without enabling any external calls. Enabling is
-- a separate server-side step after the seller-scoped Omniful token is stored
-- as an Edge Function secret.
insert into public.omniful_connections (
  merchant_code, platform, mode, status, scope_strategy, is_enabled
)
select merchant_code, 'amazon', 'shadow', 'pending', 'seller_token', false
from public.merchants
where merchant_code = 'M-6498' and role = 'merchant'
on conflict (merchant_code, platform) do nothing;
