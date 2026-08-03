-- Make the private table's default-deny posture explicit for the linter and
-- for defense in depth if a table grant is added accidentally in the future.
create policy client_incidents_deny_authenticated_direct_access
on security.client_incidents
as restrictive
for all
to authenticated
using (false)
with check (false);
