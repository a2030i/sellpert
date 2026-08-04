-- The public SECURITY INVOKER wrapper delegates to this private authorizer.
-- Authenticated callers therefore need EXECUTE on the private function, while
-- its own auth.uid(), workspace and dashboard-permission checks remain the
-- enforcement boundary. The security schema is not exposed through Data API.
revoke all on function security.generate_merchant_operational_alerts(text)
  from public, anon;
grant execute on function security.generate_merchant_operational_alerts(text)
  to authenticated, service_role;

comment on function security.generate_merchant_operational_alerts(text) is
  'Private authorized notification writer; authenticated execution is required by the public SECURITY INVOKER wrapper and remains guarded by tenant/dashboard checks.';
