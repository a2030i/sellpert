-- One encrypted Omniful API credential per merchant account. This replaces
-- the non-scalable pattern of creating an Edge Function environment secret
-- for every merchant. Browser roles never receive direct table access.
create table if not exists public.omniful_account_credentials (
  merchant_code text primary key
    references public.merchants(merchant_code) on delete cascade,
  connection_mode text not null default 'merchant_account'
    check (connection_mode in ('merchant_account', 'central_account')),
  secret_blob text,
  token_hint text,
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (connection_mode = 'merchant_account' and secret_blob is not null)
    or (connection_mode = 'central_account' and secret_blob is null)
  )
);

alter table public.omniful_account_credentials enable row level security;

revoke all on table public.omniful_account_credentials
  from public, anon, authenticated;
grant all on table public.omniful_account_credentials to service_role;

drop policy if exists omniful_account_credentials_server_only
  on public.omniful_account_credentials;
create policy omniful_account_credentials_server_only
  on public.omniful_account_credentials
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on table public.omniful_account_credentials is
  'Server-only encrypted Omniful access tokens and account mode per merchant.';
comment on column public.omniful_account_credentials.secret_blob is
  'AES-GCM encrypted credential payload. It must never be returned to browser clients.';
comment on column public.omniful_account_credentials.token_hint is
  'Non-secret last-four-character hint used only to confirm which token is stored.';

-- The existing Shmool trial uses its own seller account, not the Sellpert
-- central tenant. No credential is inserted until the merchant submits it.
