-- Schedule Amazon SP-API synchronization next to Trendyol.
--
-- Owner decision (2026-11-26): once a merchant connects Amazon through SP-API,
-- the API is the authoritative Amazon source. queue-worker dispatches
-- platform = 'amazon' jobs to the resumable sync-amazon function, which keeps
-- its own cursor and ignores the job's date range.
--
-- The current enqueue routine was last rewritten dynamically by
-- 20260810180331_remove_retired_integrations_and_billing.sql. Keep that
-- definition (authorization, cadence, de-duplication) and change only the
-- platform filter. Abort if the expected anchor is not present exactly once.
do $migration$
declare
  definition text;
  anchor text := $anchor$credentials.platform = 'trendyol'$anchor$;
  replacement text := $replacement$credentials.platform in ('trendyol', 'amazon')$replacement$;
begin
  select pg_get_functiondef('security.enqueue_active_marketplace_syncs()'::regprocedure)
    into definition;
  if position(anchor in definition) = 0
     or (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) then
    raise exception 'Unexpected enqueue_active_marketplace_syncs definition; review before enabling Amazon sync';
  end if;
  execute replace(definition, anchor, replacement);
end
$migration$;

revoke all on function security.enqueue_active_marketplace_syncs() from public, anon, authenticated;
grant execute on function security.enqueue_active_marketplace_syncs() to service_role;
