-- One-time conversion of already synchronized Trendyol payloads into the new
-- normalized listing state. Future syncs write these fields directly.
with normalized as (
  select
    p.id as product_id,
    p.merchant_code,
    nullif(p.raw ->> 'approvalStatus','') as catalog_status,
    nullif(p.raw ->> 'rejection','') as catalog_error,
    coalesce(
      nullif(p.raw #>> '{selectedVariant,deliveryOptions,deliveryDuration}',''),
      nullif(p.raw #>> '{selectedVariant,deliveryOption,deliveryDuration}',''),
      nullif(p.raw #>> '{deliveryOptions,deliveryDuration}',''),
      nullif(p.raw #>> '{deliveryOption,deliveryDuration}','')
    ) as duration_text,
    upper(coalesce(
      nullif(p.raw #>> '{selectedVariant,deliveryOptions,fastDeliveryType}',''),
      nullif(p.raw #>> '{selectedVariant,deliveryOption,fastDeliveryType}',''),
      nullif(p.raw #>> '{deliveryOptions,fastDeliveryType}',''),
      nullif(p.raw #>> '{deliveryOption,fastDeliveryType}',''),
      'STANDARD'
    )) as delivery_type
  from public.products p
  where p.platform_source like 'trendyol%'
)
insert into public.product_platform_listings (
  product_id, merchant_code, platform, delivery_duration,
  fast_delivery_type, catalog_status, catalog_error, updated_at
)
select
  product_id,
  merchant_code,
  'trendyol',
  case when duration_text ~ '^([0-9]|[12][0-9]|30)$' then duration_text::integer else null end,
  case when delivery_type in ('FAST_DELIVERY','SAME_DAY_SHIPPING') then delivery_type else 'STANDARD' end,
  catalog_status,
  catalog_error,
  now()
from normalized
on conflict (product_id,platform) do update set
  delivery_duration = excluded.delivery_duration,
  fast_delivery_type = excluded.fast_delivery_type,
  catalog_status = excluded.catalog_status,
  catalog_error = excluded.catalog_error,
  updated_at = excluded.updated_at;
