-- Explicit deny policies document and enforce that the browser never reads
-- recovery-code hashes or rate-limit evidence. The Edge service role bypasses
-- RLS and also has the only table grants.
create policy mfa_recovery_codes_deny_client_access
  on public.mfa_recovery_codes
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy mfa_recovery_attempts_deny_client_access
  on public.mfa_recovery_attempts
  for all
  to anon, authenticated
  using (false)
  with check (false);
