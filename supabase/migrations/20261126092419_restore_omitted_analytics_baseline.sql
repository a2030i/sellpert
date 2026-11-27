-- DRAFT: restore 17 analytics views and 8 routines omitted by the baseline.
-- Source: scoped, preflight-screened production catalog snapshot 2026-11-26.
-- No customer rows or credentials were exported. No existing object is replaced.
-- Existing definitions must match the reviewed snapshot; unexpected drift aborts.
-- Existing ACLs remain unchanged. New views receive SELECT only, and routines
-- receive EXECUTE only, for authenticated/service_role; PUBLIC/anon receive none.
-- SECURITY INVOKER preserves underlying tenant/RLS/MFA and column grants.
-- No financial formulas, routing, data, or provider integrations change here.
-- Known existing defect deliberately preserved: return_reasons_breakdown is
-- STABLE but uses a temporary table. Repair requires a separate reviewed change.

DO $restore_analytics$
DECLARE
  object_oid oid;
BEGIN
  PERFORM set_config('search_path', 'public,pg_catalog', true);
  -- public.brand_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.brand_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.brand_performance WITH (security_invoker = true) AS
 WITH from_snap AS (
         SELECT product_performance_snapshots.merchant_code,
            product_performance_snapshots.platform,
            product_performance_snapshots.brand,
            sum(product_performance_snapshots.sold)::integer AS units_sold,
            sum(product_performance_snapshots.returned)::integer AS units_returned,
            sum(product_performance_snapshots.gross_sales) AS revenue,
            sum(product_performance_snapshots.net_revenue) AS net_revenue
           FROM product_performance_snapshots
          WHERE product_performance_snapshots.brand IS NOT NULL AND product_performance_snapshots.brand <> ''::text
          GROUP BY product_performance_snapshots.merchant_code, product_performance_snapshots.platform, product_performance_snapshots.brand
        ), from_orders AS (
         SELECT orders.merchant_code,
            orders.platform,
            orders.brand,
            count(*)::integer AS units_sold,
            0 AS units_returned,
            sum(orders.total_amount) AS revenue,
            sum(orders.total_amount - COALESCE(orders.platform_fee, 0::numeric)) AS net_revenue
           FROM orders
          WHERE orders.brand IS NOT NULL AND orders.brand <> ''::text AND orders.status <> 'cancelled'::text
          GROUP BY orders.merchant_code, orders.platform, orders.brand
        ), combined AS (
         SELECT from_snap.merchant_code,
            from_snap.platform,
            from_snap.brand,
            from_snap.units_sold,
            from_snap.units_returned,
            from_snap.revenue,
            from_snap.net_revenue
           FROM from_snap
        UNION ALL
         SELECT from_orders.merchant_code,
            from_orders.platform,
            from_orders.brand,
            from_orders.units_sold,
            from_orders.units_returned,
            from_orders.revenue,
            from_orders.net_revenue
           FROM from_orders
        )
 SELECT merchant_code,
    platform,
    brand,
    sum(units_sold)::integer AS units_sold,
    sum(units_returned)::integer AS units_returned,
    sum(revenue) AS revenue,
    sum(net_revenue) AS net_revenue,
        CASE
            WHEN sum(units_sold) > 0 THEN round(sum(units_returned)::numeric / sum(units_sold)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS return_rate_pct
   FROM combined
  GROUP BY merchant_code, platform, brand;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.brand_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.brand_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.brand_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '81758e66a6706b2cf538514f018001cf' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.brand_performance; review required';
  END IF;

  -- public.buybox_warnings: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.buybox_warnings');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.buybox_warnings WITH (security_invoker = true) AS
 SELECT merchant_code,
    id AS product_id,
    name,
    sku,
    barcode,
    sale_price AS my_price,
    buybox_price,
    round((sale_price - buybox_price) / NULLIF(buybox_price, 0::numeric) * 100::numeric, 1) AS overprice_pct,
        CASE
            WHEN sale_price > (buybox_price * 1.05) THEN 'losing'::text
            WHEN sale_price > buybox_price THEN 'at_risk'::text
            ELSE 'winning'::text
        END AS buybox_status
   FROM products p
  WHERE buybox_price IS NOT NULL AND buybox_price > 0::numeric AND sale_price IS NOT NULL AND sale_price > 0::numeric;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.buybox_warnings FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.buybox_warnings TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.buybox_warnings; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '2152f38a7b99a41d364a5b516424f119' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.buybox_warnings; review required';
  END IF;

  -- public.cross_platform_product_perf: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.cross_platform_product_perf');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.cross_platform_product_perf WITH (security_invoker = true) AS
 WITH o AS (
         SELECT o_1.merchant_code,
            o_1.platform,
            COALESCE(o_1.partner_sku, o_1.sku) AS sku_norm,
            p.barcode,
            o_1.product_name,
            COALESCE(p.cost_price, 0::numeric) AS cost_price,
            count(*)::integer AS orders,
            sum(o_1.quantity) AS units,
            sum(o_1.total_amount) AS revenue,
            avg(o_1.total_amount / NULLIF(o_1.quantity, 0)::numeric) AS avg_price,
            sum(
                CASE
                    WHEN o_1.platform = 'noon'::text AND COALESCE(o_1.platform_fee, 0::numeric) = 0::numeric THEN o_1.total_amount * (COALESCE(cr.rate, 0::numeric) / 100.0) * (1::numeric + COALESCE(cr.vat_rate, 0::numeric) / 100.0)
                    ELSE COALESCE(o_1.platform_fee, 0::numeric)
                END) AS fees
           FROM orders o_1
             LEFT JOIN products p ON p.merchant_code = o_1.merchant_code AND (p.sku = o_1.sku OR p.sku = o_1.partner_sku)
             LEFT JOIN platform_commission_rates cr ON cr.platform = o_1.platform AND cr.category = 'default'::text
          WHERE o_1.status <> 'cancelled'::text
          GROUP BY o_1.merchant_code, o_1.platform, (COALESCE(o_1.partner_sku, o_1.sku)), p.barcode, o_1.product_name, (COALESCE(p.cost_price, 0::numeric))
        ), ad AS (
         SELECT am.merchant_code,
            am.platform,
            COALESCE(pp.sku, am.sku) AS sku_join,
            sum(am.spend) AS ad_spend
           FROM ad_metrics am
             LEFT JOIN products pp ON pp.merchant_code = am.merchant_code AND (pp.sku = am.sku OR pp.noon_sku_child = am.sku)
          WHERE am.sku IS NOT NULL AND am.sku <> ''::text
          GROUP BY am.merchant_code, am.platform, (COALESCE(pp.sku, am.sku))
        )
 SELECT o.merchant_code,
    COALESCE(o.barcode, o.sku_norm) AS product_key,
    max(o.product_name) AS product_name,
    jsonb_object_agg(o.platform, jsonb_build_object('orders', o.orders, 'units', o.units, 'revenue', round(o.revenue, 2), 'avg_price', round(o.avg_price, 2), 'fees', round(o.fees, 2), 'ad_spend', round(COALESCE(a.ad_spend, 0::numeric), 2), 'net', round(o.revenue - o.units::numeric * o.cost_price - o.fees - COALESCE(a.ad_spend, 0::numeric), 2), 'margin',
        CASE
            WHEN o.revenue > 0::numeric THEN round((o.revenue - o.units::numeric * o.cost_price - o.fees - COALESCE(a.ad_spend, 0::numeric)) / o.revenue * 100::numeric, 1)
            ELSE NULL::numeric
        END)) AS by_platform,
    count(DISTINCT o.platform) AS platforms_count,
    sum(o.revenue) AS total_revenue
   FROM o
     LEFT JOIN ad a ON a.merchant_code = o.merchant_code AND a.platform = o.platform AND a.sku_join = o.sku_norm
  GROUP BY o.merchant_code, (COALESCE(o.barcode, o.sku_norm))
 HAVING count(DISTINCT o.platform) > 1;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.cross_platform_product_perf FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.cross_platform_product_perf TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.cross_platform_product_perf; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'dd3951ebcfb881b1669e7b4c36ed2aa2' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.cross_platform_product_perf; review required';
  END IF;

  -- public.fulfillment_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.fulfillment_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.fulfillment_performance WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    COALESCE(NULLIF(fulfillment_model, ''::text), 'Unknown'::text) AS fulfillment_model,
    count(*)::integer AS orders,
    sum(total_amount) AS revenue,
    sum(platform_fee) AS fees,
    avg(total_amount) AS avg_order_value,
    count(*) FILTER (WHERE status = 'cancelled'::text)::integer AS cancelled,
    count(*) FILTER (WHERE status = 'returned'::text)::integer AS returned,
    avg(EXTRACT(epoch FROM shipment_date - order_date) / 3600.0) AS avg_ship_hours,
    avg(EXTRACT(epoch FROM delivered_date - shipment_date) / 3600.0) AS avg_delivery_hours
   FROM orders
  WHERE order_date >= (now() - '180 days'::interval)
  GROUP BY merchant_code, platform, fulfillment_model;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.fulfillment_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.fulfillment_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.fulfillment_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '08a03fa77adc3fda2534be18f92c7b5c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.fulfillment_performance; review required';
  END IF;

  -- public.inventory_ageing: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.inventory_ageing');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.inventory_ageing WITH (security_invoker = true) AS
 WITH last_movement AS (
         SELECT o.merchant_code,
            o.platform,
            o.sku,
            max(o.order_date) AS last_sold
           FROM orders o
          WHERE o.status <> 'cancelled'::text
          GROUP BY o.merchant_code, o.platform, o.sku
        )
 SELECT i.id,
    i.merchant_code,
    i.platform,
    i.sku,
    i.product_name,
    i.quantity,
    COALESCE(i.cost_price, 0::numeric) AS cost_price,
    i.quantity::numeric * COALESCE(i.cost_price, 0::numeric) AS tied_capital,
    lm.last_sold,
    COALESCE(EXTRACT(day FROM now() - lm.last_sold)::integer, EXTRACT(day FROM now() - i.created_at)::integer) AS age_days,
        CASE
            WHEN lm.last_sold IS NULL THEN 'never_sold'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 90::numeric THEN 'dead_stock'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 60::numeric THEN 'aging'::text
            WHEN EXTRACT(day FROM now() - lm.last_sold) > 30::numeric THEN 'slow'::text
            ELSE 'fresh'::text
        END AS ageing_class
   FROM inventory i
     LEFT JOIN last_movement lm ON lm.merchant_code = i.merchant_code AND lm.platform = i.platform AND lm.sku = i.sku
  WHERE i.is_active AND i.quantity > 0;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.inventory_ageing FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.inventory_ageing TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.inventory_ageing; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '7f9c56a12fba577f79f5c78117497003' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_ageing; review required';
  END IF;

  -- public.inventory_pipeline: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.inventory_pipeline');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.inventory_pipeline WITH (security_invoker = true) AS
 WITH asn AS (
         SELECT s.merchant_code,
            s.platform,
            s.asn_number,
            s.expected_qty,
            s.delivered_qty,
            s.expected_qty - s.delivered_qty AS lost_qty,
            s.delivery_date,
            s.created_at AS asn_sent_at,
            s.warehouse_code
           FROM inbound_shipments s
        ), grn_per_asn AS (
         SELECT g.merchant_code,
            g.asn_number,
            sum(g.grn_quantity) AS grn_total,
            sum(g.grn_quantity) FILTER (WHERE g.qc_status = 'failed'::text) AS qc_failed_qty,
            count(*) FILTER (WHERE g.qc_status = 'failed'::text) AS qc_failed_lines,
            min(g.grn_date) AS grn_date
           FROM goods_received g
          GROUP BY g.merchant_code, g.asn_number
        ), sales_per_asn AS (
         SELECT a.merchant_code,
            a.asn_number,
            count(o.id) AS orders_after,
            COALESCE(sum(o.quantity), 0::bigint) AS units_sold_after,
            COALESCE(sum(o.total_amount), 0::numeric) AS revenue_after
           FROM asn a
             LEFT JOIN orders o ON o.merchant_code = a.merchant_code AND o.platform = a.platform AND o.order_date::date >= COALESCE(a.delivery_date, a.asn_sent_at::date) AND o.status <> 'cancelled'::text
          GROUP BY a.merchant_code, a.asn_number
        )
 SELECT asn.merchant_code,
    asn.platform,
    asn.asn_number,
    asn.warehouse_code,
    asn.asn_sent_at,
    asn.delivery_date,
    asn.expected_qty,
    asn.delivered_qty,
    asn.lost_qty,
    COALESCE(grn.grn_total, 0::bigint) AS grn_total,
    COALESCE(grn.qc_failed_qty, 0::bigint) AS qc_failed_qty,
    COALESCE(grn.qc_failed_lines, 0::bigint) AS qc_failed_lines,
    COALESCE(sa.orders_after, 0::bigint) AS orders_after_receive,
    COALESCE(sa.units_sold_after, 0::bigint) AS units_sold_after_receive,
    COALESCE(sa.revenue_after, 0::numeric) AS revenue_after_receive,
        CASE
            WHEN asn.delivery_date IS NOT NULL AND asn.asn_sent_at IS NOT NULL THEN EXTRACT(day FROM asn.delivery_date::timestamp without time zone::timestamp with time zone - asn.asn_sent_at)::integer
            ELSE NULL::integer
        END AS days_to_receive
   FROM asn
     LEFT JOIN grn_per_asn grn USING (merchant_code, asn_number)
     LEFT JOIN sales_per_asn sa USING (merchant_code, asn_number);$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.inventory_pipeline FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.inventory_pipeline TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.inventory_pipeline; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '801d93ee41a9f47e0206e4eaab261911' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_pipeline; review required';
  END IF;

  -- public.merchant_timeline: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.merchant_timeline');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.merchant_timeline WITH (security_invoker = true) AS
 SELECT merchant_notes.merchant_code,
    'note'::text AS kind,
    merchant_notes.id::text AS ref_id,
    merchant_notes.type AS sub_type,
    merchant_notes.body AS title,
    NULL::text AS body,
    merchant_notes.author_email,
    merchant_notes.created_at
   FROM merchant_notes
UNION ALL
 SELECT merchant_requests.merchant_code,
    'task'::text AS kind,
    merchant_requests.id::text AS ref_id,
    COALESCE(merchant_requests.category, merchant_requests.type) AS sub_type,
    merchant_requests.title,
    merchant_requests.note AS body,
    merchant_requests.created_by AS author_email,
    merchant_requests.created_at
   FROM merchant_requests
UNION ALL
 SELECT platform_file_uploads.merchant_code,
    'upload'::text AS kind,
    platform_file_uploads.id::text AS ref_id,
    platform_file_uploads.file_type AS sub_type,
    platform_file_uploads.file_name AS title,
    NULL::text AS body,
    platform_file_uploads.uploaded_by AS author_email,
    platform_file_uploads.uploaded_at AS created_at
   FROM platform_file_uploads
UNION ALL
 SELECT notifications.merchant_code,
    'notify'::text AS kind,
    notifications.id::text AS ref_id,
    notifications.type AS sub_type,
    notifications.title,
    notifications.body,
    NULL::text AS author_email,
    notifications.created_at
   FROM notifications;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.merchant_timeline FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.merchant_timeline TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.merchant_timeline; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'e202d55cbba76ebae198ea832c7187d8' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.merchant_timeline; review required';
  END IF;

  -- public.product_abc_analysis: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.product_abc_analysis');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.product_abc_analysis WITH (security_invoker = true) AS
 WITH ranked AS (
         SELECT pp.merchant_code,
            pp.product_id,
            pp.product_name,
            pp.sku,
            pp.brand,
            pp.revenue,
            pp.units_sold,
            pp.net_profit,
            sum(pp.revenue) OVER (PARTITION BY pp.merchant_code) AS total_revenue,
            row_number() OVER (PARTITION BY pp.merchant_code ORDER BY pp.revenue DESC) AS rank
           FROM product_profitability pp
          WHERE pp.units_sold > 0
        ), cumulative AS (
         SELECT ranked.merchant_code,
            ranked.product_id,
            ranked.product_name,
            ranked.sku,
            ranked.brand,
            ranked.revenue,
            ranked.units_sold,
            ranked.net_profit,
            ranked.total_revenue,
            ranked.rank,
            sum(ranked.revenue) OVER (PARTITION BY ranked.merchant_code ORDER BY ranked.revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_revenue,
                CASE
                    WHEN ranked.total_revenue > 0::numeric THEN sum(ranked.revenue) OVER (PARTITION BY ranked.merchant_code ORDER BY ranked.revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / ranked.total_revenue * 100::numeric
                    ELSE 0::numeric
                END AS cum_pct
           FROM ranked
        )
 SELECT merchant_code,
    product_id,
    product_name,
    sku,
    brand,
    revenue,
    units_sold,
    net_profit,
    rank,
    round(cum_pct, 1) AS cumulative_pct,
        CASE
            WHEN cum_pct <= 80::numeric THEN 'A'::text
            WHEN cum_pct <= 95::numeric THEN 'B'::text
            ELSE 'C'::text
        END AS abc_class
   FROM cumulative;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.product_abc_analysis FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.product_abc_analysis TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.product_abc_analysis; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'aadec7721b77a1698b38dc1a4425251c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.product_abc_analysis; review required';
  END IF;

  -- public.receiving_accuracy: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.receiving_accuracy');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.receiving_accuracy WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    sku,
    COALESCE(NULLIF(barcode, ''::text), partner_sku) AS barcode,
    count(DISTINCT asn_number) AS shipments,
    COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'passed'::text), 0::bigint) AS received_ok,
    COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text), 0::bigint) AS rejected,
    sum(grn_quantity) AS total_received,
        CASE
            WHEN sum(grn_quantity) > 0 THEN round(COALESCE(sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text), 0::bigint)::numeric / sum(grn_quantity)::numeric * 100::numeric, 1)
            ELSE 0::numeric
        END AS rejection_rate_pct,
    array_agg(DISTINCT reject_reason) FILTER (WHERE qc_status = 'failed'::text AND reject_reason <> ''::text) AS reject_reasons
   FROM goods_received gr
  GROUP BY merchant_code, platform, sku, (COALESCE(NULLIF(barcode, ''::text), partner_sku));$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.receiving_accuracy FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.receiving_accuracy TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.receiving_accuracy; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '8df9a9af71320e7c822479b5fdf2e7a3' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.receiving_accuracy; review required';
  END IF;

  -- public.search_query_insights: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.search_query_insights');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.search_query_insights WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    search_query,
    count(*)::integer AS occurrences,
    sum(impressions) AS impressions,
    sum(clicks) AS clicks,
    sum(orders)::integer AS orders,
    sum(spend) AS spend,
    sum(revenue) AS revenue,
        CASE
            WHEN sum(impressions) > 0 THEN round(sum(clicks)::numeric / sum(impressions)::numeric * 100::numeric, 2)
            ELSE NULL::numeric
        END AS ctr,
        CASE
            WHEN sum(spend) > 0::numeric THEN round(sum(revenue) / sum(spend), 2)
            ELSE NULL::numeric
        END AS roas,
        CASE
            WHEN sum(clicks) > 0 THEN round(sum(orders)::numeric / sum(clicks)::numeric * 100::numeric, 2)
            ELSE NULL::numeric
        END AS cvr
   FROM ad_metrics
  WHERE search_query IS NOT NULL AND search_query <> ''::text
  GROUP BY merchant_code, platform, search_query;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.search_query_insights FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.search_query_insights TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.search_query_insights; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '6ac302dd43cd56e22134d126f4c26ee6' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.search_query_insights; review required';
  END IF;

  -- public.sku_lifecycle: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.sku_lifecycle');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.sku_lifecycle WITH (security_invoker = true) AS
 WITH stats AS (
         SELECT p.merchant_code,
            p.id,
            p.name,
            p.sku,
            p.created_at,
            EXTRACT(day FROM now() - p.created_at)::integer AS age_days,
            COALESCE(pp.units_sold, 0::bigint) AS units_sold,
            COALESCE(pp.revenue, 0::numeric) AS revenue,
            COALESCE(pp.profit_margin_pct, 0::numeric) AS margin
           FROM products p
             LEFT JOIN product_profitability pp ON pp.product_id = p.id
        )
 SELECT merchant_code,
    id,
    name,
    sku,
    created_at,
    age_days,
    units_sold,
    revenue,
    margin,
        CASE
            WHEN age_days < 30 AND units_sold > 0 THEN 'launching'::text
            WHEN age_days < 30 AND units_sold = 0 THEN 'new_no_sales'::text
            WHEN units_sold > 0 AND age_days >= 30 AND age_days <= 180 THEN 'growing'::text
            WHEN units_sold > 0 AND age_days > 180 THEN 'mature'::text
            WHEN units_sold = 0 AND age_days > 60 THEN 'dormant'::text
            ELSE 'unknown'::text
        END AS lifecycle_stage
   FROM stats;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.sku_lifecycle FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.sku_lifecycle TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.sku_lifecycle; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'f047c391d25cd08ea9fc184eac5725b1' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sku_lifecycle; review required';
  END IF;

  -- public.supplier_quality_over_time: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.supplier_quality_over_time');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.supplier_quality_over_time WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    date_trunc('month'::text, grn_date::timestamp with time zone)::date AS month,
    count(*) AS total_lines,
    count(*) FILTER (WHERE qc_status = 'failed'::text) AS failed_lines,
    sum(grn_quantity) AS total_qty,
    sum(grn_quantity) FILTER (WHERE qc_status = 'failed'::text) AS failed_qty,
    round(count(*) FILTER (WHERE qc_status = 'failed'::text)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 2) AS failure_rate_pct
   FROM goods_received
  WHERE grn_date IS NOT NULL
  GROUP BY merchant_code, platform, (date_trunc('month'::text, grn_date::timestamp with time zone));$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.supplier_quality_over_time FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.supplier_quality_over_time TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.supplier_quality_over_time; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '2951f5f88032aab39cc13106fe700cd0' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.supplier_quality_over_time; review required';
  END IF;

  -- public.supply_chain_health: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.supply_chain_health');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.supply_chain_health WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    count(*) AS shipments,
    sum(expected_qty) AS total_expected,
    sum(delivered_qty) AS total_delivered,
    sum(variance) AS total_variance,
    round(sum(abs(LEAST(variance, 0)))::numeric / NULLIF(sum(expected_qty), 0)::numeric * 100::numeric, 2) AS loss_rate_pct,
    ( SELECT count(*) AS count
           FROM goods_received g
          WHERE g.merchant_code = s.merchant_code AND g.qc_status = 'failed'::text) AS qc_failures,
    ( SELECT COALESCE(sum(g.grn_quantity), 0::bigint) AS "coalesce"
           FROM goods_received g
          WHERE g.merchant_code = s.merchant_code AND g.qc_status = 'failed'::text) AS qc_failed_qty
   FROM inbound_shipments s
  GROUP BY merchant_code, platform;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.supply_chain_health FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.supply_chain_health TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.supply_chain_health; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '85a18521d6f27e65b6b0318a307eafa1' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.supply_chain_health; review required';
  END IF;

  -- public.sync_queue_stats: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.sync_queue_stats');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.sync_queue_stats WITH (security_invoker = true) AS
 SELECT platform,
    job_type,
    status,
    count(*) AS job_count,
    avg(EXTRACT(epoch FROM finished_at - started_at))::integer AS avg_duration_sec,
    max(created_at) AS latest_job
   FROM sync_queue
  WHERE created_at > (now() - '24:00:00'::interval)
  GROUP BY platform, job_type, status
  ORDER BY platform, job_type, status;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.sync_queue_stats FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.sync_queue_stats TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.sync_queue_stats; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> 'a55c4a57f9c6538e52814385cc301b8c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sync_queue_stats; review required';
  END IF;

  -- public.top_failing_skus: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.top_failing_skus');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.top_failing_skus WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    sku,
    partner_sku,
    barcode,
    count(*) AS reject_events,
    sum(grn_quantity) AS total_rejected_qty,
    array_agg(DISTINCT reject_reason) FILTER (WHERE reject_reason IS NOT NULL) AS reasons
   FROM goods_received
  WHERE qc_status = 'failed'::text
  GROUP BY merchant_code, platform, sku, partner_sku, barcode;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.top_failing_skus FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.top_failing_skus TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.top_failing_skus; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '926aa4df787ee90df821b95d9cfd3f75' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.top_failing_skus; review required';
  END IF;

  -- public.true_ad_effectiveness: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.true_ad_effectiveness');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.true_ad_effectiveness WITH (security_invoker = true) AS
 SELECT am.merchant_code,
    am.platform,
    NULLIF(am.sku, ''::text) AS sku,
    am.campaign_name,
    sum(am.spend) AS spend,
    sum(am.revenue) AS gross_revenue,
    sum(am.orders) AS orders,
    round(sum(am.revenue) * COALESCE(fp.fee_rate, 0::numeric), 2) AS est_fees,
    round(sum(am.revenue) * COALESCE(rp.return_rate, 0::numeric), 2) AS est_returns,
    fp.fee_rate,
    rp.return_rate,
    round(sum(am.revenue) * (1::numeric - COALESCE(fp.fee_rate, 0::numeric) - COALESCE(rp.return_rate, 0::numeric)), 2) AS net_revenue,
        CASE
            WHEN sum(am.spend) > 0::numeric THEN round(sum(am.revenue) / sum(am.spend), 2)
            ELSE NULL::numeric
        END AS gross_roas,
        CASE
            WHEN sum(am.spend) > 0::numeric THEN round(sum(am.revenue) * (1::numeric - COALESCE(fp.fee_rate, 0::numeric) - COALESCE(rp.return_rate, 0::numeric)) / sum(am.spend), 2)
            ELSE NULL::numeric
        END AS net_roas,
    fp.commission,
    fp.fba_fee,
    fp.withheld_vat,
    max(pr.name) AS product_name
   FROM ad_metrics am
     LEFT JOIN platform_fee_profile fp ON fp.merchant_code = am.merchant_code AND fp.platform = am.platform
     LEFT JOIN platform_return_profile rp ON rp.merchant_code = am.merchant_code AND rp.platform = am.platform
     LEFT JOIN products pr ON pr.merchant_code = am.merchant_code AND (pr.sku = am.sku OR pr.noon_sku_child = am.sku)
  WHERE am.spend > 0::numeric
  GROUP BY am.merchant_code, am.platform, (NULLIF(am.sku, ''::text)), am.campaign_name, fp.fee_rate, rp.return_rate, fp.commission, fp.fba_fee, fp.withheld_vat;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.true_ad_effectiveness FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.true_ad_effectiveness TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.true_ad_effectiveness; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '8dfaab5984388d078e12f9b637dc314d' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.true_ad_effectiveness; review required';
  END IF;

  -- public.variant_performance: create only when absent; never replace a live analytics contract.
  object_oid := to_regclass('public.variant_performance');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE VIEW public.variant_performance WITH (security_invoker = true) AS
 SELECT merchant_code,
    platform,
    COALESCE(NULLIF(brand, ''::text), 'بلا ماركة'::text) AS brand,
    COALESCE(NULLIF(color, ''::text), 'بلا لون'::text) AS color,
    COALESCE(NULLIF(size, ''::text), 'بلا مقاس'::text) AS size,
    sum(sold)::integer AS units_sold,
    sum(returned)::integer AS units_returned,
    sum(gross_sales) AS revenue,
    sum(net_revenue) AS net_revenue,
    round(sum(returned)::numeric / NULLIF(sum(sold), 0)::numeric * 100::numeric, 1) AS return_rate_pct
   FROM product_performance_snapshots
  WHERE color IS NOT NULL OR size IS NOT NULL
  GROUP BY merchant_code, platform, brand, color, size
 HAVING sum(sold) > 0;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON public.variant_performance FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT SELECT ON public.variant_performance TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = object_oid AND relkind = 'v'
      AND 'security_invoker=true' = ANY(coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected object type/security mode for public.variant_performance; review required';
  ELSIF md5(replace(pg_get_viewdef(object_oid, true), 'TRIM(BOTH FROM ', 'btrim(')) <> '25ad00592dd52bc01b231bfacda22f00' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.variant_performance; review required';
  END IF;

  object_oid := to_regprocedure('public.inventory_turnover(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cogs AS (
    SELECT COALESCE(SUM(o.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs,
           COALESCE(SUM(o.total_amount), 0) AS total_revenue
    FROM public.orders o
    LEFT JOIN public.products p ON p.merchant_code = o.merchant_code AND p.sku = o.sku
    WHERE o.merchant_code = p_merchant_code
      AND o.order_date >= NOW() - p_days * INTERVAL '1 day'
      AND o.status NOT IN ('cancelled')
  ),
  inv AS (
    SELECT COALESCE(SUM(quantity * COALESCE(cost_price, 0)), 0) AS avg_inv_value,
           COALESCE(SUM(quantity), 0) AS total_units
    FROM public.inventory
    WHERE merchant_code = p_merchant_code AND is_active
  )
  SELECT jsonb_build_object(
    'period_days', p_days,
    'cogs',          cogs.total_cogs,
    'revenue',       cogs.total_revenue,
    'avg_inv_value', inv.avg_inv_value,
    'total_units',   inv.total_units,
    'turnover_ratio', CASE WHEN inv.avg_inv_value > 0 THEN ROUND((cogs.total_cogs / inv.avg_inv_value)::numeric * (365.0 / p_days), 2) ELSE NULL END,
    'days_to_sell_all', CASE WHEN cogs.total_cogs > 0 THEN ROUND((inv.avg_inv_value / cogs.total_cogs * p_days)::numeric, 0) ELSE NULL END
  )
  FROM cogs, inv;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_turnover(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.inventory_turnover; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'f86cda032fe06b2d38d3dc6feb1c5ab6' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.inventory_turnover; review required';
  END IF;

  object_oid := to_regprocedure('public.period_comparison(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.period_comparison(p_merchant_code text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH curr AS (
    SELECT
      COALESCE(SUM(total_sales), 0)   AS sales,
      COALESCE(SUM(order_count), 0)   AS orders,
      COALESCE(SUM(ad_spend), 0)      AS ad_spend,
      COALESCE(SUM(platform_fees), 0) AS fees
    FROM public.performance_data
    WHERE merchant_code = p_merchant_code
      AND data_date >  (CURRENT_DATE - p_days * INTERVAL '1 day')
      AND data_date <= CURRENT_DATE
  ),
  prev AS (
    SELECT
      COALESCE(SUM(total_sales), 0)   AS sales,
      COALESCE(SUM(order_count), 0)   AS orders,
      COALESCE(SUM(ad_spend), 0)      AS ad_spend,
      COALESCE(SUM(platform_fees), 0) AS fees
    FROM public.performance_data
    WHERE merchant_code = p_merchant_code
      AND data_date >  (CURRENT_DATE - 2 * p_days * INTERVAL '1 day')
      AND data_date <= (CURRENT_DATE - p_days * INTERVAL '1 day')
  )
  SELECT jsonb_build_object(
    'period_days', p_days,
    'current',  jsonb_build_object('sales', curr.sales, 'orders', curr.orders, 'ad_spend', curr.ad_spend, 'fees', curr.fees),
    'previous', jsonb_build_object('sales', prev.sales, 'orders', prev.orders, 'ad_spend', prev.ad_spend, 'fees', prev.fees),
    'delta_pct', jsonb_build_object(
      'sales',    CASE WHEN prev.sales    > 0 THEN ROUND(((curr.sales - prev.sales) / prev.sales * 100)::numeric, 1) ELSE NULL END,
      'orders',   CASE WHEN prev.orders   > 0 THEN ROUND(((curr.orders - prev.orders)::numeric / prev.orders * 100), 1) ELSE NULL END,
      'ad_spend', CASE WHEN prev.ad_spend > 0 THEN ROUND(((curr.ad_spend - prev.ad_spend) / prev.ad_spend * 100)::numeric, 1) ELSE NULL END,
      'fees',     CASE WHEN prev.fees     > 0 THEN ROUND(((curr.fees - prev.fees) / prev.fees * 100)::numeric, 1) ELSE NULL END
    )
  )
  FROM curr, prev;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.period_comparison(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.period_comparison(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.period_comparison; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '72571f4b98ed76ef4d6281bd88f6c15c' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.period_comparison; review required';
  END IF;

  object_oid := to_regprocedure('public.restock_recommendations(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer DEFAULT 14)
 RETURNS TABLE(sku text, product_name text, platform text, current_qty integer, daily_velocity numeric, days_of_stock numeric, suggested_order_qty integer, urgency text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT * FROM (
    SELECT
      sku, product_name, platform,
      quantity AS current_qty,
      daily_velocity,
      days_of_stock,
      GREATEST(CEIL(daily_velocity * (p_lead_time_days + 30))::int - quantity, 0) AS suggested_order_qty,
      CASE
        WHEN quantity = 0 THEN 'urgent'
        WHEN days_of_stock IS NOT NULL AND days_of_stock < p_lead_time_days THEN 'high'
        WHEN days_of_stock IS NOT NULL AND days_of_stock < (p_lead_time_days + 7) THEN 'medium'
        ELSE 'low'
      END AS urgency
    FROM public.inventory_health
    WHERE merchant_code = p_merchant_code
      AND daily_velocity > 0
      AND (days_of_stock IS NULL OR days_of_stock < (p_lead_time_days + 14))
  ) t
  ORDER BY
    (CASE t.urgency WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END),
    t.days_of_stock NULLS FIRST;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.restock_recommendations(p_merchant_code text, p_lead_time_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.restock_recommendations; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '640cc7bef99e0560c1dac28b705fe0a7' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.restock_recommendations; review required';
  END IF;

  object_oid := to_regprocedure('public.return_reasons_breakdown(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.return_reasons_breakdown(p_merchant_code text)
 RETURNS TABLE(reason text, count integer, percentage numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE total int;
BEGIN
  CREATE TEMP TABLE _rr (reason text, cnt int) ON COMMIT DROP;
  INSERT INTO _rr
    SELECT key, SUM(value::int)::int AS cnt
    FROM public.product_performance_snapshots,
         jsonb_each_text(return_reasons) AS r(key, value)
    WHERE merchant_code = p_merchant_code
      AND value::int > 0
    GROUP BY key;
  SELECT SUM(cnt) INTO total FROM _rr;
  RETURN QUERY
    SELECT _rr.reason, _rr.cnt, CASE WHEN total > 0 THEN ROUND((_rr.cnt::numeric / total * 100)::numeric, 1) ELSE 0 END
    FROM _rr ORDER BY _rr.cnt DESC;
END $function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.return_reasons_breakdown(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.return_reasons_breakdown(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.return_reasons_breakdown; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '41ded9e99be0b950291d81e512bf2d21' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.return_reasons_breakdown; review required';
  END IF;

  object_oid := to_regprocedure('public.sales_heatmap(text, integer)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer DEFAULT 90)
 RETURNS TABLE(day_of_week integer, hour_of_day integer, orders integer, sales numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    EXTRACT(DOW FROM order_date)::int  AS day_of_week,
    EXTRACT(HOUR FROM order_date)::int AS hour_of_day,
    COUNT(*)::int AS orders,
    COALESCE(SUM(total_amount), 0)::numeric AS sales
  FROM public.orders
  WHERE merchant_code = p_merchant_code
    AND order_date >= NOW() - p_days * INTERVAL '1 day'
    AND status NOT IN ('cancelled')
    AND order_date::time <> '00:00:00'
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sales_heatmap(p_merchant_code text, p_days integer) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.sales_heatmap; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'c7e0158141ca857ff124c87fe0885ea4' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.sales_heatmap; review required';
  END IF;

  object_oid := to_regprocedure('public.shipping_analytics(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.shipping_analytics(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ship AS (
    SELECT
      EXTRACT(EPOCH FROM (shipment_date - order_date)) / 3600.0 AS ship_hours,
      EXTRACT(EPOCH FROM (delivered_date - shipment_date)) / 3600.0 AS delivery_hours,
      EXTRACT(EPOCH FROM (delivered_date - order_date)) / 86400.0 AS total_days,
      status, platform
    FROM public.orders
    WHERE merchant_code = p_merchant_code
      AND order_date >= NOW() - INTERVAL '90 days'
      AND shipment_date IS NOT NULL
  )
  SELECT jsonb_build_object(
    'total_orders', COUNT(*),
    'avg_ship_hours', ROUND(AVG(ship_hours)::numeric, 1),
    'avg_delivery_hours', ROUND(AVG(delivery_hours)::numeric, 1),
    'avg_total_days', ROUND(AVG(total_days)::numeric, 1),
    'late_shipments', COUNT(*) FILTER (WHERE ship_hours > 48),
    'fastest_hours', ROUND(MIN(ship_hours)::numeric, 1),
    'slowest_hours', ROUND(MAX(ship_hours)::numeric, 1)
  )
  FROM ship;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.shipping_analytics(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.shipping_analytics(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.shipping_analytics; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> '0bafae1e3e1b44c87f378f2d68277b28' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.shipping_analytics; review required';
  END IF;

  object_oid := to_regprocedure('public.tasks_summary(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.tasks_summary(p_assigned text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total',       COUNT(*),
    'pending',     COUNT(*) FILTER (WHERE status = 'pending'),
    'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
    'done',        COUNT(*) FILTER (WHERE status = 'done'),
    'blocked',     COUNT(*) FILTER (WHERE status = 'blocked'),
    'urgent',      COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('done','rejected')),
    'overdue',     COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('done','rejected'))
  )
  FROM public.merchant_requests
  WHERE p_assigned IS NULL OR assigned_to = p_assigned;
$function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.tasks_summary(p_assigned text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tasks_summary(p_assigned text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.tasks_summary; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'd5724bc1469042a78608406328af4c7a' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.tasks_summary; review required';
  END IF;

  object_oid := to_regprocedure('public.weekly_digest(text)');
  IF object_oid IS NULL THEN
    EXECUTE $analytics_sql$CREATE OR REPLACE FUNCTION public.weekly_digest(p_merchant_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_curr jsonb; v_prev jsonb;
  v_top_product text; v_alerts text;
BEGIN
  -- مقارنة 7 يوم مع 7 السابقة
  SELECT public.period_comparison(p_merchant_code, 7) INTO v_curr;

  -- أعلى منتج بيع آخر 7 أيام
  SELECT product_name INTO v_top_product
  FROM public.orders
  WHERE merchant_code = p_merchant_code
    AND order_date >= NOW() - INTERVAL '7 days'
    AND status NOT IN ('cancelled')
    AND product_name IS NOT NULL
  GROUP BY product_name
  ORDER BY SUM(total_amount) DESC
  LIMIT 1;

  -- التنبيهات
  SELECT string_agg(title, E'\n') INTO v_alerts
  FROM (
    SELECT title FROM public.notifications
    WHERE merchant_code = p_merchant_code AND created_at >= NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'merchant_code', p_merchant_code,
    'period', '7 أيام',
    'sales',     v_curr->'current'->>'sales',
    'orders',    v_curr->'current'->>'orders',
    'ad_spend',  v_curr->'current'->>'ad_spend',
    'sales_delta_pct',  v_curr->'delta_pct'->>'sales',
    'orders_delta_pct', v_curr->'delta_pct'->>'orders',
    'top_product', COALESCE(v_top_product, 'لا يوجد'),
    'alerts',      COALESCE(v_alerts, 'لا تنبيهات جديدة')
  );
END $function$;$analytics_sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.weekly_digest(p_merchant_code text) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.weekly_digest(p_merchant_code text) TO authenticated, service_role';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = object_oid AND NOT prosecdef
      AND proconfig = ARRAY['search_path=public']::text[] AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'Unexpected security/configuration for public.weekly_digest; review required';
  ELSIF md5(pg_get_functiondef(object_oid)) <> 'f8e4d63929905515b18012b2b6caaefc' THEN
    RAISE EXCEPTION 'Unreviewed definition drift for public.weekly_digest; review required';
  END IF;

END
$restore_analytics$;
