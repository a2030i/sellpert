-- Provider product identifiers belong to one account listing, not the shared
-- canonical product. Re-sync verifies these fields; historical guesses are not
-- backfilled from another account's canonical barcode/content ID.
alter table public.product_platform_listings add column provider_barcode text;
alter table public.product_platform_listings add column provider_product_id text;
grant select(provider_barcode,provider_product_id) on public.product_platform_listings to authenticated;
grant update(family_id,variant_attributes) on public.products to authenticated;
