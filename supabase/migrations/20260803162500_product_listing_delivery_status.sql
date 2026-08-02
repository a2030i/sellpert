alter table public.product_platform_listings
  add column if not exists delivery_status text not null default 'draft',
  add column if not exists external_batch_id text,
  add column if not exists last_submitted_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists delivery_error text;

alter table public.product_platform_listings
  drop constraint if exists product_platform_listings_delivery_status_check;
alter table public.product_platform_listings
  add constraint product_platform_listings_delivery_status_check
  check (delivery_status in ('draft','accepted','processing','success','partial','failed'));

create index if not exists product_platform_listings_batch_idx
  on public.product_platform_listings (merchant_code, platform, external_batch_id)
  where external_batch_id is not null;

comment on column public.product_platform_listings.delivery_status is
  'Merchant-facing delivery lifecycle for the latest marketplace submission.';
