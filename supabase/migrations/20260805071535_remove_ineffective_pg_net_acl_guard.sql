-- pg_net 0.20 objects are owned by the managed `supabase_admin` role. The
-- Data API exposes `public`, not `net`, so the enforceable application
-- boundary is: keep the extension metadata outside public and expose network
-- access only through Sellpert's restricted security-schema wrappers.
-- Remove the earlier ACL event trigger because postgres cannot override the
-- managed extension owner's grants and a no-op guard would be misleading.

drop event trigger if exists zz_sellpert_restrict_pg_net_access;
drop function if exists security.restrict_pg_net_access();

revoke all on function security.trigger_queue_worker() from public, anon, authenticated;
grant execute on function security.trigger_queue_worker() to service_role;

revoke all on function security.notify_order_whatsapp() from public, anon, authenticated;
grant execute on function security.notify_order_whatsapp() to service_role;

comment on extension pg_net is
  'Managed async HTTP extension stored outside public. The net schema is not exposed by Sellpert Data API; application calls use restricted security-schema wrappers.';
