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

-- A lookup before upsert cannot prevent concurrent cross-workspace claims.
-- Fail closed on existing duplicates; never rewrite merchant credentials here.
create unique index if not exists platform_credentials_active_amazon_seller_uidx
  on public.platform_credentials (seller_id)
  where platform = 'amazon' and is_active = true;

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

-- Preserve the schema-wide MFA invariant even though browser grants are revoked.
create policy sellpert_require_mfa_if_enrolled
  on public.amazon_oauth_states as restrictive
  for all to authenticated
  using ((select security.mfa_access_allowed()))
  with check ((select security.mfa_access_allowed()));

-- Keep the shared tenant guard as defense in depth; this grants no browser access.
create policy tenant_boundary
  on public.amazon_oauth_states as restrictive
  for all to authenticated
  using (security.can_access_merchant(merchant_code))
  with check (security.can_access_merchant(merchant_code));

comment on table public.amazon_oauth_states is
  'Server-only, single-use OAuth state hashes for the Amazon SP-API website authorization workflow.';

-- A safe boolean for the existing import UI, including platform staff whose
-- import rights are governed by integrations permission rather than link rights.
create or replace function security.amazon_file_import_allowed(p_merchant_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or (select security.mfa_access_allowed()) is not true
     or security.has_merchant_permission(p_merchant_code, 'integrations') is not true then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  return not exists (
    select 1 from public.platform_credentials
    where merchant_code = p_merchant_code and platform = 'amazon' and is_active = true
  );
end
$$;

create or replace function public.amazon_file_import_allowed(p_merchant_code text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select security.amazon_file_import_allowed(p_merchant_code)
$$;

revoke all on function security.amazon_file_import_allowed(text) from public, anon;
revoke all on function public.amazon_file_import_allowed(text) from public, anon;
grant execute on function security.amazon_file_import_allowed(text) to authenticated;
grant execute on function public.amazon_file_import_allowed(text) to authenticated;

-- Keep the current atomic import implementation and its existing authorization,
-- archive checks, lineage and transaction intact. Abort if its expected anchor
-- has changed; never silently skip the rule or replace an unknown implementation.
do $migration$
declare
  definition text;
  anchor text := $anchor$  if v_upload.status <> 'processing' then$anchor$;
  guard text := $guard$  -- Amazon API is authoritative after this workspace connects.
  -- Inspect payloads too, so a client cannot relabel an Amazon file as Noon.
  if exists (
    select 1 from public.platform_credentials
    where merchant_code = v_upload.merchant_code
      and platform = 'amazon' and is_active = true
  ) and (
    v_upload.platform = 'amazon'
    or exists (
      select 1 from jsonb_array_elements(p_payloads) payload
      where payload ->> 'table' = 'amazon_daily_sales'
        or exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(payload -> 'rows') = 'array'
              then payload -> 'rows' else '[]'::jsonb end
          ) source_row
          where source_row ->> 'platform' = 'amazon'
        )
    )
  ) then
    raise exception using errcode = '55000',
      message = 'Amazon file imports are disabled while the direct connection is active';
  end if;

$guard$;
begin
  select pg_get_functiondef('security.commit_merchant_file_import(uuid,jsonb)'::regprocedure)
    into definition;
  if position(anchor in definition) = 0
     or (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) then
    raise exception 'Unexpected atomic import definition; review Amazon import guard before applying';
  end if;
  execute replace(definition, anchor, guard || anchor);
end
$migration$;
