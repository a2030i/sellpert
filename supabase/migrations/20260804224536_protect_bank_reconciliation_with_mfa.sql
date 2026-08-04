-- Every public RLS table participates in Sellpert's opt-in MFA boundary. The
-- reconciliation tables were added after the global policy migration and must
-- explicitly inherit the same restrictive requirement.
create policy sellpert_require_mfa_if_enrolled on public.bank_transactions
  as restrictive for all to authenticated
  using ((select security.mfa_access_allowed()))
  with check ((select security.mfa_access_allowed()));

create policy sellpert_require_mfa_if_enrolled on public.settlement_bank_matches
  as restrictive for all to authenticated
  using ((select security.mfa_access_allowed()))
  with check ((select security.mfa_access_allowed()));

comment on policy sellpert_require_mfa_if_enrolled on public.bank_transactions is
  'Restrictive opt-in MFA boundary for privately imported bank evidence.';
comment on policy sellpert_require_mfa_if_enrolled on public.settlement_bank_matches is
  'Restrictive opt-in MFA boundary for settlement confirmations.';
