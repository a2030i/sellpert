-- Operational queue functions and trigger implementations are internal
-- database machinery, not merchant-facing RPCs. PostgreSQL grants EXECUTE to
-- PUBLIC for newly created functions unless the creating role's defaults are
-- hardened, so revoke both the inherited and explicit API-role grants.

revoke execute on function public.process_sync_queue(integer)
  from public, anon, authenticated;
grant execute on function public.process_sync_queue(integer)
  to service_role;

revoke execute on function public.prepare_merchant_weekly_brief()
  from public, anon, authenticated;
grant execute on function public.prepare_merchant_weekly_brief()
  to service_role;

revoke execute on function public.update_updated_at()
  from public, anon, authenticated;
grant execute on function public.update_updated_at()
  to service_role;

-- Default privileges for normal migration-created functions were already
-- hardened in 20260803145656. Managed Supabase does not allow project
-- migrations to alter supabase_admin's defaults, so the regression test below
-- checks the effective privileges of every internal function after all
-- migrations instead of relying on an unavailable owner-level setting.
