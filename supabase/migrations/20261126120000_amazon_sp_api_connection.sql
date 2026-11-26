-- Direct Amazon Selling Partner API (SP-API) connection.
--
-- Owner decision (2026-11-26): Sellpert registered as an approved public SP-API
-- solution provider with non-PII roles only, and Amazon becomes a direct
-- connection again next to Trendyol. This migration only allows the stored
-- connection and the short-lived OAuth state. It does not add Amazon to the
-- automatic sync queue and does not write canonical orders or financial data;
-- those need their own reviewed change (source precedence vs. Amazon file imports).

-- 1. Allow an encrypted Amazon refresh token in platform_credentials.
alter table public.platform_credentials
  drop constraint if exists platform_credentials_platform_check;
alter table public.platform_credentials
  add constraint platform_credentials_platform_check
  check (platform in ('trendyol', 'amazon'));

-- 2. One-time OAuth state for the website authorization workflow.
--    Only a SHA-256 hash of the state is stored. A state is bound to the
--    Sellpert user who started the flow and the merchant workspace it targets,
--    expires after at most 15 minutes, and can be consumed once.
create table if not exists public.amazon_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  merchant_code text not null
    references public.merchants(merchant_code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  marketplace_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);

create index if not exists amazon_oauth_states_expires_at_idx
  on public.amazon_oauth_states (expires_at);
create index if not exists amazon_oauth_states_user_id_idx
  on public.amazon_oauth_states (user_id);
create index if not exists amazon_oauth_states_merchant_code_idx
  on public.amazon_oauth_states (merchant_code);

alter table public.amazon_oauth_states enable row level security;

revoke all on table public.amazon_oauth_states from public, anon, authenticated;
grant all on table public.amazon_oauth_states to service_role;

drop policy if exists amazon_oauth_states_server_only on public.amazon_oauth_states;
create policy amazon_oauth_states_server_only
  on public.amazon_oauth_states
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on table public.amazon_oauth_states is
  'Server-only, single-use OAuth state hashes for the Amazon SP-API website authorization workflow.';
