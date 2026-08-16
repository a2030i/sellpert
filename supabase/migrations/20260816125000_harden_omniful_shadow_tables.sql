-- Make the server-only boundary explicit to the database linter as well as to
-- table grants. Service-role workers bypass RLS; browsers are denied.
create policy omniful_connections_server_only
  on public.omniful_connections
  for all to anon, authenticated
  using (false)
  with check (false);

create policy omniful_observations_server_only
  on public.omniful_order_observations
  for all to anon, authenticated
  using (false)
  with check (false);

create index if not exists omniful_observations_canonical_order_idx
  on public.omniful_order_observations (canonical_order_id)
  where canonical_order_id is not null;
