-- Add Noon and Trendyol to the same isolated Omniful shadow trial. These rows
-- do not alter the existing Excel or direct Trendyol connections.
insert into public.omniful_connections (
  merchant_code, platform, mode, status, scope_strategy, is_enabled
)
select merchant.merchant_code, platform.name, 'shadow', 'pending', 'seller_token', false
from public.merchants merchant
cross join (values ('amazon'), ('noon'), ('trendyol')) as platform(name)
where merchant.merchant_code = 'M-6498'
  and merchant.role = 'merchant'
on conflict (merchant_code, platform) do nothing;

alter table public.omniful_order_observations
  drop constraint if exists omniful_order_observations_match_status_check;

update public.omniful_order_observations
set match_status = 'matched_existing'
where match_status = 'matched_excel';

alter table public.omniful_order_observations
  add constraint omniful_order_observations_match_status_check
  check (match_status in ('matched_existing', 'new_shadow', 'filtered', 'invalid'));

-- Preserve the system-wide opt-in MFA boundary for both server-only tables.
-- Browser roles remain denied by grants and the explicit server-only policies.
drop policy if exists sellpert_require_mfa_if_enrolled
  on public.omniful_connections;
create policy sellpert_require_mfa_if_enrolled
  on public.omniful_connections
  as restrictive
  for all
  to authenticated
  using ((select security.mfa_access_allowed()))
  with check ((select security.mfa_access_allowed()));

drop policy if exists sellpert_require_mfa_if_enrolled
  on public.omniful_order_observations;
create policy sellpert_require_mfa_if_enrolled
  on public.omniful_order_observations
  as restrictive
  for all
  to authenticated
  using ((select security.mfa_access_allowed()))
  with check ((select security.mfa_access_allowed()));
