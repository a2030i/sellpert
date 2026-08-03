drop policy if exists merchant_action_owner_update on public.merchant_requests;
create policy merchant_action_owner_update
on public.merchant_requests
for update
to authenticated
using (
  request_kind = 'action'
  and merchant_code = (select public.current_merchant_code())
)
with check (
  request_kind = 'action'
  and merchant_code = (select public.current_merchant_code())
);

alter function public.update_my_action_status(uuid, text) security invoker;

comment on policy merchant_action_owner_update on public.merchant_requests is
  'Allows a merchant to maintain only action-plan rows inside the restrictive tenant boundary.';
