-- Raw audit payloads are an internal security record. Even though credential
-- fields are redacted by the trigger and rows are tenant scoped, clients do
-- not need direct access to old_values/new_values. A verified Edge Function
-- returns only a human-readable activity summary.
revoke select on table public.audit_log from authenticated;
revoke all on table public.audit_log from anon;

comment on table public.audit_log is
  'Internal immutable audit trail. Customer and staff access is mediated by the activity-feed Edge Function.';
