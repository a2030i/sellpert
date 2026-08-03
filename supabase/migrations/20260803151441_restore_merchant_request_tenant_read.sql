-- INSERT ... RETURNING and the merchant actions/support screens both need an
-- explicit permissive SELECT policy. The shared restrictive tenant boundary
-- remains the final workspace isolation check.
drop policy if exists merchant_request_tenant_select on public.merchant_requests;
create policy merchant_request_tenant_select
on public.merchant_requests
for select
to authenticated
using (security.can_access_merchant(merchant_code));

comment on policy merchant_request_tenant_select on public.merchant_requests is
  'Allows authenticated identities to read requests only for workspaces they can access; tenant_boundary remains restrictive.';

notify pgrst, 'reload schema';
