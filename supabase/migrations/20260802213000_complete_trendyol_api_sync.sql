-- Rich provenance and marketplace payloads for the complete Trendyol sync.
alter table public.orders
  add column if not exists shipment_package_id text,
  add column if not exists cargo_tracking_number text,
  add column if not exists cargo_provider text,
  add column if not exists shipment_address jsonb,
  add column if not exists invoice_address jsonb,
  add column if not exists commission_rate numeric,
  add column if not exists vat_rate numeric,
  add column if not exists raw jsonb,
  add column if not exists last_synced_at timestamptz;

alter table public.returns
  add column if not exists claim_id text,
  add column if not exists claim_line_id text,
  add column if not exists raw jsonb,
  add column if not exists last_synced_at timestamptz;

alter table public.products
  add column if not exists platform_source text,
  add column if not exists raw jsonb,
  add column if not exists last_synced_at timestamptz;

alter table public.inventory
  add column if not exists raw jsonb;

alter table public.sync_logs
  add column if not exists details jsonb;

create unique index if not exists returns_trendyol_claim_line_uniq
  on public.returns (merchant_code, platform, claim_id, claim_line_id);

create index if not exists orders_trendyol_package_idx
  on public.orders (merchant_code, shipment_package_id)
  where platform = 'trendyol' and shipment_package_id is not null;

comment on column public.sync_logs.details is
  'Per-resource counts and non-fatal warnings from marketplace synchronization.';
