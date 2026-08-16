-- One merchant-facing Omniful workspace entry point. Marketplace credentials
-- remain inside Omniful; Sellpert only stores the HTTPS workspace URL and
-- server-side seller mapping needed for the isolated shadow trial.
create table if not exists public.omniful_merchant_portals (
  merchant_code text primary key references public.merchants(merchant_code) on delete cascade,
  portal_url text,
  seller_scope_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omniful_merchant_portals_https_url
    check (portal_url is null or portal_url ~ '^https://')
);

alter table public.omniful_merchant_portals enable row level security;

revoke all on table public.omniful_merchant_portals from public, anon, authenticated;
grant all on table public.omniful_merchant_portals to service_role;

create policy omniful_merchant_portals_server_only
  on public.omniful_merchant_portals
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

create policy tenant_boundary
  on public.omniful_merchant_portals
  as restrictive
  for all
  to authenticated
  using ((select security.can_access_merchant(merchant_code)))
  with check ((select security.can_access_merchant(merchant_code)));

create policy sellpert_require_mfa_if_enrolled
  on public.omniful_merchant_portals
  as restrictive
  for all
  to authenticated
  using ((select security.mfa_access_allowed()))
  with check ((select security.mfa_access_allowed()));

comment on table public.omniful_merchant_portals is
  'Server-only merchant entry links for seller-scoped Omniful workspaces. No marketplace credentials or Omniful access tokens are stored here.';

insert into public.omniful_merchant_portals (merchant_code, seller_scope_label)
select merchant_code, name
from public.merchants
where merchant_code = 'M-6498' and role = 'merchant'
on conflict (merchant_code) do update
set seller_scope_label = excluded.seller_scope_label,
    updated_at = now();
