-- Keep tenant/MFA/permission semantics; evaluate actor-only identity once per
-- statement instead of re-reading it for every product and supporting fact.
DO $$
DECLARE t text; policy_row record; normalized text;
  access_predicate constant text := '((SELECT security.can_access_all_merchants()) OR merchant_code = ANY ((SELECT security.current_accessible_merchant_codes())::text[]))';
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_metrics'] LOOP
    SELECT pol.*,pg_get_expr(pol.polqual,pol.polrelid) q,pg_get_expr(pol.polwithcheck,pol.polrelid) c INTO STRICT policy_row
      FROM pg_policy pol WHERE pol.polrelid=format('public.%I',t)::regclass AND pol.polname='tenant_boundary';
    IF policy_row.polpermissive OR policy_row.polcmd<>'*' OR policy_row.polroles<>ARRAY['authenticated'::regrole::oid] THEN
      RAISE EXCEPTION 'Unreviewed tenant boundary metadata: %',t;
    END IF;
    FOREACH normalized IN ARRAY ARRAY[policy_row.q,policy_row.c] LOOP
      normalized:=regexp_replace(replace(normalized,t||'.',''),'\s','','g');
      IF normalized IS NULL OR normalized NOT IN ('security.can_access_merchant(merchant_code)','(SELECTsecurity.can_access_merchant(merchant_code)AScan_access_merchant)') THEN
        RAISE EXCEPTION 'Unreviewed tenant boundary predicate: %',t;
      END IF;
    END LOOP;
    EXECUTE format('ALTER POLICY tenant_boundary ON public.%I USING (%s) WITH CHECK (%s)',t,access_predicate,access_predicate);
    IF t = 'ad_metrics' THEN
      SELECT pol.*,pg_get_expr(pol.polqual,pol.polrelid) q INTO STRICT policy_row FROM pg_policy pol
        WHERE pol.polrelid=format('public.%I',t)::regclass AND pol.polname='identity_scoped_select';
      IF NOT policy_row.polpermissive OR policy_row.polcmd<>'r' OR policy_row.polroles<>ARRAY['authenticated'::regrole::oid]
        OR policy_row.q<>'security.can_access_merchant(merchant_code)' THEN RAISE EXCEPTION 'Unreviewed identity select: %',t; END IF;
      EXECUTE format('ALTER POLICY identity_scoped_select ON public.%I USING (%s)',t,access_predicate);
    END IF;
  END LOOP;
END $$;

-- Every observation and movement stays inside the source selling account.
CREATE VIEW public.inventory_ageing_by_account WITH (security_invoker=true) AS
WITH last_movement AS (
 SELECT merchant_code,marketplace_account_id,platform,sku,max(order_date) last_sold
 FROM public.orders WHERE status<>'cancelled' GROUP BY merchant_code,marketplace_account_id,platform,sku
)
SELECT i.id,i.merchant_code,i.marketplace_account_id,i.platform,i.sku,i.product_name,i.quantity,
 nullif(i.cost_price,0) cost_price,
 CASE WHEN i.cost_price>0 THEN i.quantity::numeric*i.cost_price END tied_capital,
 lm.last_sold,
 coalesce(extract(day from now()-lm.last_sold)::integer,extract(day from now()-i.created_at)::integer) age_days,
 CASE WHEN lm.last_sold IS NULL THEN 'never_sold'
 WHEN now()-lm.last_sold>interval '90 days' THEN 'dead_stock'
 WHEN now()-lm.last_sold>interval '60 days' THEN 'aging'
 WHEN now()-lm.last_sold>interval '30 days' THEN 'slow' ELSE 'fresh' END ageing_class
FROM public.inventory i LEFT JOIN last_movement lm ON lm.merchant_code=i.merchant_code
 AND lm.marketplace_account_id=i.marketplace_account_id AND lm.platform=i.platform AND lm.sku=i.sku
WHERE i.is_active AND i.quantity>0;

CREATE VIEW public.inventory_pipeline_by_account WITH (security_invoker=true) AS
WITH asn AS (
 SELECT s.id,s.merchant_code,s.marketplace_account_id,s.platform,s.asn_number,s.expected_qty,s.delivered_qty,
 s.expected_qty-s.delivered_qty lost_qty,s.delivery_date,s.created_at asn_sent_at,s.warehouse_code FROM public.inbound_shipments s
), grn AS (
 SELECT merchant_code,marketplace_account_id,platform,asn_number,sum(grn_quantity) grn_total,
 sum(grn_quantity) FILTER(WHERE qc_status='failed') qc_failed_qty,
 count(*) FILTER(WHERE qc_status='failed') qc_failed_lines
 FROM public.goods_received GROUP BY merchant_code,marketplace_account_id,platform,asn_number
), sales AS (
 SELECT a.id,count(o.id) orders_after,coalesce(sum(o.quantity),0) units_sold_after,coalesce(sum(o.total_amount),0) revenue_after
 FROM asn a LEFT JOIN public.orders o ON o.merchant_code=a.merchant_code AND o.marketplace_account_id=a.marketplace_account_id
 AND o.platform=a.platform AND o.order_date::date>=coalesce(a.delivery_date,a.asn_sent_at::date) AND o.status<>'cancelled'
 GROUP BY a.id
)
SELECT a.id,a.merchant_code,a.marketplace_account_id,a.platform,a.asn_number,a.warehouse_code,a.asn_sent_at,a.delivery_date,
 a.expected_qty,a.delivered_qty,a.lost_qty,coalesce(g.grn_total,0) grn_total,coalesce(g.qc_failed_qty,0) qc_failed_qty,
 coalesce(g.qc_failed_lines,0) qc_failed_lines,coalesce(s.orders_after,0) orders_after_receive,
 coalesce(s.units_sold_after,0) units_sold_after_receive,coalesce(s.revenue_after,0) revenue_after_receive,
 CASE WHEN a.delivery_date IS NOT NULL AND a.asn_sent_at IS NOT NULL THEN extract(day from a.delivery_date::timestamptz-a.asn_sent_at)::integer END days_to_receive
FROM asn a LEFT JOIN grn g ON g.merchant_code=a.merchant_code AND g.marketplace_account_id=a.marketplace_account_id
 AND g.platform=a.platform AND g.asn_number=a.asn_number LEFT JOIN sales s ON s.id=a.id;
REVOKE ALL ON public.inventory_ageing_by_account,public.inventory_pipeline_by_account FROM PUBLIC,anon;
GRANT SELECT ON public.inventory_ageing_by_account,public.inventory_pipeline_by_account TO authenticated,service_role;
