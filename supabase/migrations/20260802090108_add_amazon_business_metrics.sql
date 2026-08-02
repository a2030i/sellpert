-- Amazon Business Report fields (traffic + conversion by ASIN).
-- Kept on product_performance_snapshots so the same dated product grain used
-- by Trendyol remains the canonical cross-platform product-performance grain.
alter table public.product_performance_snapshots
  add column if not exists asin text,
  add column if not exists parent_asin text,
  add column if not exists seller_sku text,
  add column if not exists sessions integer,
  add column if not exists session_percentage numeric,
  add column if not exists page_views integer,
  add column if not exists page_views_percentage numeric,
  add column if not exists buy_box_percentage numeric,
  add column if not exists unit_session_percentage numeric;

alter table public.product_performance_snapshots
  drop constraint if exists product_performance_snapshots_sessions_nonnegative,
  add constraint product_performance_snapshots_sessions_nonnegative check (sessions is null or sessions >= 0),
  drop constraint if exists product_performance_snapshots_page_views_nonnegative,
  add constraint product_performance_snapshots_page_views_nonnegative check (page_views is null or page_views >= 0),
  drop constraint if exists product_performance_snapshots_percentages_valid,
  add constraint product_performance_snapshots_percentages_valid check (
    (session_percentage is null or session_percentage between 0 and 100.5)
    and (page_views_percentage is null or page_views_percentage between 0 and 100.5)
    and (buy_box_percentage is null or buy_box_percentage between 0 and 100.5)
    and (unit_session_percentage is null or unit_session_percentage between 0 and 100.5)
  );

create index if not exists idx_product_performance_amazon_asin
  on public.product_performance_snapshots (merchant_code, snapshot_date desc, asin)
  where platform = 'amazon' and asin is not null;

comment on column public.product_performance_snapshots.seller_sku is
  'Original Seller Central SKU text. sku may intentionally use ASIN when the export contains duplicated/scientific notation SKUs.';
