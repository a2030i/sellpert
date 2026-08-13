-- Marketplace commission is a product/category property, not one constant
-- percentage for the whole channel. Preserve marketplace-supplied rates and
-- use the maintained category catalogue only when an exact product rate is
-- unavailable.

CREATE OR REPLACE FUNCTION security.normalized_fee_category(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN coalesce(p_category, '') ~* '(food|beverage|grocery|spice|coffee|tea|herb|seed|salt|pepper|بقال|غذ|طعام|توابل|بهارات|قهوة|شاي|أعشاب|اعشاب|بذور|ملح|فلفل|نباتات)' THEN 'grocery'
    WHEN coalesce(p_category, '') ~* '(health|nutrition|supplement|medical|صحة|تغذية|مكمل|طبي)' THEN 'health'
    WHEN coalesce(p_category, '') ~* '(beauty|personal.?care|عناية|تجميل)' THEN 'beauty'
    WHEN coalesce(p_category, '') ~* '(home|decor|منزل|ديكور)' THEN 'home'
    WHEN coalesce(p_category, '') ~* '(kitchen|مطبخ)' THEN 'kitchen'
    WHEN coalesce(p_category, '') ~* '(mobile|tablet|جوال|هاتف|لوحي)' THEN 'mobile_tablets'
    WHEN coalesce(p_category, '') ~* '(electronic|إلكترون)' THEN 'electronics'
    WHEN coalesce(p_category, '') ~* '(laptop|computer|حاسب|كمبيوتر|لاب.?توب)' THEN 'laptops'
    WHEN coalesce(p_category, '') ~* '(kids?.?apparel|ملابس أطفال)' THEN 'apparel_kids'
    WHEN coalesce(p_category, '') ~* '(women.?apparel|ملابس نسائية)' THEN 'apparel_women'
    WHEN coalesce(p_category, '') ~* '(men.?apparel|ملابس رجالية)' THEN 'apparel_men'
    WHEN coalesce(p_category, '') ~* '(shoe|footwear|أحذية)' THEN 'shoes'
    WHEN coalesce(p_category, '') ~* '(bag|luggage|حقائب)' THEN 'bags'
    WHEN coalesce(p_category, '') ~* '(sport|رياض)' THEN 'sports'
    WHEN coalesce(p_category, '') ~* '(toy|baby|ألعاب)' THEN 'toys'
    WHEN coalesce(p_category, '') ~* '(book|كتب)' THEN 'books'
    WHEN coalesce(p_category, '') ~* '(office|مكتب)' THEN 'office'
    WHEN coalesce(p_category, '') ~* '(automotive|سيارات)' THEN 'automotive'
    WHEN coalesce(p_category, '') ~* '(jewel|مجوهر)' THEN 'jewelry'
    WHEN coalesce(p_category, '') ~* '(watch|ساعات)' THEN 'watches'
    WHEN coalesce(p_category, '') ~* '(furniture|أثاث)' THEN 'furniture'
    ELSE nullif(lower(regexp_replace(trim(coalesce(p_category, '')), '[[:space:]-]+', '_', 'g')), '')
  END
$function$;

CREATE OR REPLACE FUNCTION security.platform_fee_category(p_platform text, p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN lower(coalesce(p_platform, '')) = 'amazon' AND security.normalized_fee_category(p_category) = 'electronics' THEN 'electronics_consumer'
    WHEN lower(coalesce(p_platform, '')) = 'amazon' AND security.normalized_fee_category(p_category) = 'laptops' THEN 'computers'
    ELSE security.normalized_fee_category(p_category)
  END
$function$;

REVOKE ALL ON FUNCTION security.normalized_fee_category(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security.platform_fee_category(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.normalized_fee_category(text) TO service_role;
GRANT EXECUTE ON FUNCTION security.platform_fee_category(text, text) TO service_role;

ALTER TABLE public.product_platform_prices
  ADD COLUMN IF NOT EXISTS category_key text,
  ADD COLUMN IF NOT EXISTS commission_source text;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_platform_prices_commission_source_check'
      AND conrelid = 'public.product_platform_prices'::regclass
  ) THEN
    ALTER TABLE public.product_platform_prices
      ADD CONSTRAINT product_platform_prices_commission_source_check
      CHECK (commission_source IS NULL OR commission_source IN ('platform_api','category','manual','unknown'));
  END IF;
END
$block$;

WITH resolved AS (
  SELECT
    price.id,
    security.platform_fee_category(price.platform, product.category) AS category_key,
    CASE
      WHEN price.platform = 'trendyol' AND coalesce(product.commission_rate, 0) > 0 THEN product.commission_rate
      ELSE category.commission_rate
    END AS rate,
    CASE
      WHEN price.platform = 'trendyol' AND coalesce(product.commission_rate, 0) > 0 THEN 'platform_api'
      WHEN category.commission_rate IS NOT NULL THEN 'category'
      ELSE 'unknown'
    END AS source
  FROM public.product_platform_prices price
  JOIN public.products product ON product.id = price.product_id AND product.merchant_code = price.merchant_code
  LEFT JOIN public.platform_fee_categories category
    ON category.platform = price.platform
   AND category.category_key = security.platform_fee_category(price.platform, product.category)
)
UPDATE public.product_platform_prices price
SET category_key = resolved.category_key,
    commission_rate = coalesce(resolved.rate, price.commission_rate),
    commission_source = resolved.source,
    updated_at = now()
FROM resolved
WHERE resolved.id = price.id;

-- Fill missing per-order commission from the matched catalogue product. Exact
-- fees already supplied by Amazon or Trendyol are never overwritten.
WITH matched AS (
  SELECT
    order_row.id,
    price.commission_rate,
    round(order_row.total_amount * price.commission_rate / 100.0 * 1.15, 2) AS platform_fee
  FROM public.orders order_row
  JOIN LATERAL (
    SELECT product.id
    FROM public.products product
    WHERE product.merchant_code = order_row.merchant_code
      AND nullif(trim(order_row.sku), '') IS NOT NULL
      AND lower(trim(order_row.sku)) IN (
        lower(coalesce(product.sku, '')),
        lower(coalesce(product.barcode, '')),
        lower(coalesce(product.psku_code, '')),
        lower(coalesce(product.noon_sku_child, '')),
        lower(coalesce(product.asin, '')),
        lower(coalesce(product.external_id, '')),
        lower(coalesce(product.supplier_sku, ''))
      )
    ORDER BY CASE WHEN lower(trim(order_row.sku)) = lower(coalesce(product.sku, '')) THEN 0 ELSE 1 END, product.id
    LIMIT 1
  ) product_match ON true
  JOIN public.product_platform_prices price
    ON price.product_id = product_match.id
   AND price.merchant_code = order_row.merchant_code
   AND price.platform = order_row.platform
  WHERE coalesce(order_row.platform_fee, 0) = 0
    AND price.commission_rate > 0
)
UPDATE public.orders order_row
SET commission_rate = matched.commission_rate,
    platform_fee = matched.platform_fee
FROM matched
WHERE matched.id = order_row.id;

CREATE OR REPLACE FUNCTION security.rebuild_performance_data(p_merchant_code text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE affected integer;
BEGIN
  DELETE FROM public.performance_data WHERE merchant_code = p_merchant_code;

  WITH item_fees AS (
    SELECT merchant_code, platform, order_id, sum(coalesce(commission_amount, 0)) AS platform_fee
    FROM public.order_items
    WHERE merchant_code = p_merchant_code
    GROUP BY merchant_code, platform, order_id
  ),
  order_agg AS (
    SELECT o.merchant_code, o.platform, DATE(o.order_date) AS data_date,
      SUM(o.total_amount) AS total_sales,
      COUNT(*)::int AS order_count,
      SUM(CASE
        WHEN coalesce(items.platform_fee, 0) > 0 THEN items.platform_fee
        ELSE coalesce(o.platform_fee, 0)
      END) AS platform_fees
    FROM public.orders o
    LEFT JOIN item_fees items
      ON items.merchant_code = o.merchant_code
     AND items.platform = o.platform
     AND items.order_id = o.order_id
    WHERE o.merchant_code = p_merchant_code AND o.status NOT IN ('cancelled')
    GROUP BY o.merchant_code, o.platform, DATE(o.order_date)
  ),
  amz_tx_orders AS (
    SELECT t.merchant_code, t.platform, DATE(t.transaction_date) AS data_date,
      SUM(GREATEST(t.credit, 0)) AS total_sales, COUNT(*)::int AS order_count,
      SUM(GREATEST(t.debit, 0)) AS platform_fees
    FROM public.account_transactions t
    WHERE t.merchant_code = p_merchant_code AND t.platform = 'amazon'
      AND (t.transaction_type ILIKE '%مبلغ الطلب%' OR t.transaction_type ILIKE '%order%' OR t.amount_type ILIKE '%ItemPrice%')
      AND t.transaction_date IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon')
    GROUP BY t.merchant_code, t.platform, DATE(t.transaction_date)
  ),
  amz_dashboard AS (
    SELECT d.merchant_code, 'amazon'::text AS platform, d.data_date,
      d.total_sales, COALESCE(d.units,0) AS order_count, 0::numeric AS platform_fees
    FROM public.amazon_daily_sales d
    WHERE d.merchant_code = p_merchant_code
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'amazon')
      AND NOT EXISTS (SELECT 1 FROM amz_tx_orders)
  ),
  trendyol_snap AS (
    SELECT s.merchant_code, s.platform, s.snapshot_date AS data_date,
      SUM(s.gross_sales) AS total_sales, SUM(s.net_sold)::int AS order_count, 0::numeric AS platform_fees
    FROM public.product_performance_snapshots s
    WHERE s.merchant_code = p_merchant_code AND s.platform = 'trendyol'
      AND NOT EXISTS (SELECT 1 FROM order_agg o WHERE o.platform = 'trendyol')
    GROUP BY s.merchant_code, s.platform, s.snapshot_date
  ),
  ad_agg AS (
    SELECT merchant_code, platform, report_date AS data_date, SUM(spend) AS ad_spend
    FROM public.ad_metrics WHERE merchant_code = p_merchant_code
    GROUP BY merchant_code, platform, report_date
  ),
  combined AS (
    SELECT * FROM order_agg UNION ALL SELECT * FROM amz_tx_orders
    UNION ALL SELECT * FROM amz_dashboard UNION ALL SELECT * FROM trendyol_snap
  ),
  collapsed AS (
    SELECT merchant_code, platform, data_date, SUM(total_sales) AS total_sales,
      SUM(order_count) AS order_count, SUM(platform_fees) AS platform_fees
    FROM combined GROUP BY merchant_code, platform, data_date
  )
  INSERT INTO public.performance_data
    (merchant_code, platform, data_date, total_sales, order_count, platform_fees, ad_spend)
  SELECT COALESCE(c.merchant_code, a.merchant_code), COALESCE(c.platform, a.platform),
    COALESCE(c.data_date, a.data_date), COALESCE(c.total_sales, 0),
    COALESCE(c.order_count, 0)::int, COALESCE(c.platform_fees, 0), COALESCE(a.ad_spend, 0)
  FROM collapsed c FULL OUTER JOIN ad_agg a
    ON c.merchant_code = a.merchant_code AND c.platform = a.platform AND c.data_date = a.data_date;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

REVOKE ALL ON FUNCTION security.rebuild_performance_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION security.rebuild_performance_data(text) TO service_role;

COMMENT ON FUNCTION security.rebuild_performance_data(text) IS
  'Rebuilds daily performance from canonical sales sources and exact or product-category commission, never a fixed platform-wide estimate.';

DO $block$
DECLARE merchant_row record;
BEGIN
  FOR merchant_row IN SELECT DISTINCT merchant_code FROM public.orders LOOP
    PERFORM security.rebuild_performance_data(merchant_row.merchant_code);
  END LOOP;
END
$block$;
