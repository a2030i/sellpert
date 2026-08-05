-- The quota table is an internal enforcement primitive. Keep an explicit
-- deny policy in addition to revoked grants so future grant changes cannot
-- expose per-user security counters through the Data API.

drop policy if exists client_incident_rate_limits_deny_authenticated
  on security.client_incident_rate_limits;

create policy client_incident_rate_limits_deny_authenticated
  on security.client_incident_rate_limits
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);
