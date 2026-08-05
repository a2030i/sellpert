alter table public.product_platform_listings
  add column if not exists delivery_duration integer,
  add column if not exists fast_delivery_type text,
  add column if not exists catalog_status text,
  add column if not exists catalog_error text;

alter table public.product_platform_listings
  drop constraint if exists product_platform_listings_delivery_duration_check;
alter table public.product_platform_listings
  add constraint product_platform_listings_delivery_duration_check
  check (delivery_duration is null or delivery_duration between 0 and 30);

alter table public.product_platform_listings
  drop constraint if exists product_platform_listings_fast_delivery_type_check;
alter table public.product_platform_listings
  add constraint product_platform_listings_fast_delivery_type_check
  check (fast_delivery_type is null or fast_delivery_type in ('STANDARD', 'FAST_DELIVERY', 'SAME_DAY_SHIPPING'));

comment on column public.product_platform_listings.delivery_duration is 'Normalized marketplace preparation duration in days.';
comment on column public.product_platform_listings.fast_delivery_type is 'Normalized marketplace delivery speed; provider payloads remain backend-only.';
comment on column public.product_platform_listings.catalog_status is 'Normalized marketplace catalogue state used by merchant-facing readiness checks.';
comment on column public.product_platform_listings.catalog_error is 'Merchant-safe catalogue rejection detail synchronized from the marketplace.';

revoke select, insert, update on public.inventory from authenticated;

grant select (
  id, merchant_code, sku, product_name, platform, quantity, reserved_quantity,
  low_stock_threshold, cost_price, image_url, is_active, last_updated,
  created_at, asin, fulfillment_channel, condition_type, stock_xdock_gross,
  stock_xdock_net, partner_sku, upload_id, platform_source, last_synced_at
) on public.inventory to authenticated;

grant insert (
  id, merchant_code, sku, product_name, platform, quantity, reserved_quantity,
  low_stock_threshold, cost_price, image_url, is_active, last_updated,
  created_at, asin, fulfillment_channel, condition_type, stock_xdock_gross,
  stock_xdock_net, partner_sku, upload_id, platform_source, last_synced_at
) on public.inventory to authenticated;

grant update (
  merchant_code, sku, product_name, platform, quantity, reserved_quantity,
  low_stock_threshold, cost_price, image_url, is_active, last_updated,
  asin, fulfillment_channel, condition_type, stock_xdock_gross,
  stock_xdock_net, partner_sku, upload_id, platform_source, last_synced_at
) on public.inventory to authenticated;

comment on column public.inventory.raw is
  'Private marketplace provider payload. Accessible only to trusted backend roles; never exposed through browser inventory reads.';
