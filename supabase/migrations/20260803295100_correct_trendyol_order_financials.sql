-- Keep the normalized package lifecycle for analytics while preserving the
-- exact Trendyol state needed to guide Picking -> Invoiced workflows.
alter table public.order_packages
  add column if not exists provider_status text;

update public.order_packages
set provider_status = coalesce(
  nullif(raw->>'shipmentPackageStatus', ''),
  nullif(raw->>'status', '')
)
where platform = 'trendyol'
  and provider_status is null;

-- Stream API fields lineGrossAmount and lineTotalDiscount are unit amounts.
-- Recalculate imported lines using the documented net unit price and quantity.
with corrected as (
  select
    id,
    greatest(coalesce(nullif(raw->>'quantity', '')::numeric, quantity, 1), 1) as qty,
    coalesce(nullif(raw->>'lineUnitPrice', '')::numeric, unit_price, 0) as net_unit,
    coalesce(nullif(raw->>'lineGrossAmount', '')::numeric, unit_price, 0) as gross_unit,
    coalesce(
      nullif(raw->>'lineTotalDiscount', '')::numeric,
      case
        when raw ? 'lineSellerDiscount' or raw ? 'lineTyDiscount' then
          coalesce(nullif(raw->>'lineSellerDiscount', '')::numeric, 0)
            + coalesce(nullif(raw->>'lineTyDiscount', '')::numeric, 0)
      end,
      discount_amount,
      0
    ) as discount_unit,
    coalesce(nullif(raw->>'commission', '')::numeric, commission_rate, 0) as rate,
    coalesce(nullif(raw->>'vatRate', '')::numeric, vat_rate, 0) as line_vat
  from public.order_items
  where platform = 'trendyol' and raw is not null
)
update public.order_items item
set
  quantity = corrected.qty::integer,
  unit_price = corrected.net_unit,
  line_total = corrected.net_unit * corrected.qty,
  discount_amount = corrected.discount_unit * corrected.qty,
  commission_rate = nullif(corrected.rate, 0),
  commission_amount = corrected.net_unit * corrected.qty * corrected.rate / 100 * 1.15,
  vat_rate = nullif(corrected.line_vat, 0)
from corrected
where item.id = corrected.id;

-- Package totals are authoritative for split orders and include the exact
-- discounts applied by Trendyol. Do not infer gross sales from net sales.
with package_totals as (
  select
    merchant_code,
    order_id,
    sum(coalesce(nullif(raw->>'packageTotalPrice', '')::numeric, total_amount, 0)) as net_total,
    sum(coalesce(nullif(raw->>'packageGrossAmount', '')::numeric, total_amount, 0)) as gross_total,
    sum(coalesce(nullif(raw->>'packageTotalDiscount', '')::numeric, 0)) as discount_total
  from public.order_packages
  where platform = 'trendyol'
  group by merchant_code, order_id
)
update public.orders order_row
set
  total_amount = package_totals.net_total,
  gross_amount = package_totals.gross_total,
  discount_amount = package_totals.discount_total,
  unit_price = case
    when order_row.quantity > 0 then package_totals.net_total / order_row.quantity
    else package_totals.net_total
  end
from package_totals
where order_row.merchant_code = package_totals.merchant_code
  and order_row.platform = 'trendyol'
  and order_row.order_id = package_totals.order_id;

comment on column public.order_packages.provider_status is
  'Exact marketplace package status (for example Picking or Invoiced); status remains the normalized lifecycle.';
