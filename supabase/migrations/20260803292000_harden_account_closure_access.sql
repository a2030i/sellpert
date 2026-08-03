-- State the Data API boundary explicitly for database advisors and future
-- maintainers. Table privileges remain revoked; the Edge Function is the only
-- customer-facing access path.
create policy account_closure_deny_direct_access
  on public.account_closure_requests
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create index if not exists account_closure_requested_by_idx
  on public.account_closure_requests (requested_by);
