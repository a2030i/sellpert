-- Inventory quantities need explicit provenance. `last_updated` alone cannot
-- distinguish a marketplace sync from a merchant override or a file import.

alter table public.inventory
  add column if not exists platform_source text,
  add column if not exists last_synced_at timestamptz;

-- Backfill only rows whose preserved Trendyol payload proves they were fetched
-- from the catalogue API. Other legacy rows remain intentionally undocumented.
update public.inventory
set platform_source = 'trendyol_api_v2',
    last_synced_at = coalesce(last_synced_at, last_updated)
where lower(btrim(platform)) = 'trendyol'
  and platform_source is null
  and raw is not null
  and (
    raw ? 'variant'
    or raw ? 'contentId'
    or raw ? 'approvalStatus'
  );

comment on column public.inventory.platform_source is
  'Explicit latest quantity source such as trendyol_api_v2, manual, or manual_override. File imports are linked by upload_id.';

comment on column public.inventory.last_synced_at is
  'Latest successful marketplace synchronization time; retained when a merchant later overrides the quantity manually.';
