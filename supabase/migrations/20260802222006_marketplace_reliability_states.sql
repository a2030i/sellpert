alter table public.webhook_events add column if not exists event_key text;

create unique index if not exists webhook_events_source_event_key_uniq
  on public.webhook_events (source, event_key);

alter table public.marketplace_action_logs drop constraint if exists marketplace_action_logs_status_check;
alter table public.marketplace_action_logs add constraint marketplace_action_logs_status_check
  check (status in ('running','accepted','processing','success','partial','failed'));

alter table public.sync_logs drop constraint if exists sync_logs_status_check;
alter table public.sync_logs add constraint sync_logs_status_check
  check (status in ('running','success','partial','error'));

alter table public.merchant_platform_mappings
  drop constraint if exists merchant_platform_mappings_last_sync_status_check;
alter table public.merchant_platform_mappings
  add constraint merchant_platform_mappings_last_sync_status_check
  check (last_sync_status in ('success','partial','error','running'));

comment on column public.webhook_events.event_key is
  'Stable provider event fingerprint used to make webhook processing idempotent.';
