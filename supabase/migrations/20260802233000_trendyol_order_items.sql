create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  merchant_code text not null references public.merchants(merchant_code) on delete cascade,
  platform text not null,
  order_id text not null,
  line_id text not null,
  content_id text,
  barcode text,
  sku text,
  product_name text,
  product_name_ar text,
  translation_source text,
  quantity integer not null default 1,
  unit_price numeric not null default 0,
  line_total numeric not null default 0,
  discount_amount numeric not null default 0,
  commission_amount numeric not null default 0,
  commission_rate numeric,
  vat_rate numeric,
  image_url text,
  images jsonb,
  product_url text,
  raw jsonb,
  catalog_raw jsonb,
  last_synced_at timestamptz not null default now(),
  unique (merchant_code, platform, order_id, line_id)
);

create index if not exists order_items_order_idx
  on public.order_items (merchant_code, platform, order_id);
create index if not exists order_items_barcode_idx
  on public.order_items (merchant_code, platform, barcode);

alter table public.order_items enable row level security;
grant select on public.order_items to authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;

drop policy if exists order_items_merchant_select on public.order_items;
create policy order_items_merchant_select on public.order_items
for select to authenticated
using (
  merchant_code = (
    select m.merchant_code from public.merchants m
    where m.email = (select auth.email()) limit 1
  )
  or (select public.is_staff())
);

comment on table public.order_items is
  'Marketplace order lines enriched with catalogue images and product metadata.';
