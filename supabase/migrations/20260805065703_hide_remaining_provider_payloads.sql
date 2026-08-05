revoke select, insert, update on public.account_transactions from authenticated;
grant select (
  id, merchant_code, platform, transaction_no, transaction_date, posted_date,
  transaction_type, order_id, description, product_name, product_sku,
  product_barcode, amount_type, amount_description, debit, credit, net_amount,
  currency, marketplace, settlement_id, created_at, promotion_id,
  quantity_purchased, shipment_id, settlement_period_start,
  settlement_period_end, deposit_date, upload_id
) on public.account_transactions to authenticated;

revoke select, insert, update on public.ad_metrics from authenticated;
grant select (
  id, merchant_code, platform, report_date, campaign_name, ad_group_name,
  ad_status, sku, asin, search_query, impressions, clicks, orders, add_to_cart,
  spend, revenue, ctr, roas, cpc, cps, cvr, acos, budget_total, budget_daily,
  budget_remaining, start_date, end_date, currency, created_at, default_bid,
  suggested_bid_low, suggested_bid_med, suggested_bid_high, keywords_count,
  products_count, upload_id
) on public.ad_metrics to authenticated;

revoke select, insert, update on public.inbound_shipments from authenticated;
grant select (
  id, merchant_code, platform, asn_number, warehouse_code, expected_qty,
  delivered_qty, variance, status, delivery_date, created_at, upload_id
) on public.inbound_shipments to authenticated;

revoke select, insert, update on public.goods_received from authenticated;
grant select (
  id, merchant_code, platform, asn_number, warehouse_code, grn_date, sku,
  partner_sku, barcode, grn_quantity, qc_status, reject_reason, created_at,
  upload_id
) on public.goods_received to authenticated;

revoke select, insert, update on public.webhook_events from authenticated;
grant select (
  id, source, event_type, store_id, merchant_code, status, error, received_at,
  processed_at, event_key
) on public.webhook_events to authenticated;

comment on column public.account_transactions.raw is 'Private provider financial payload; trusted backend only.';
comment on column public.ad_metrics.raw is 'Private advertising provider payload; trusted backend only.';
comment on column public.inbound_shipments.raw is 'Private provider shipment payload; trusted backend only.';
comment on column public.goods_received.raw is 'Private provider goods-received payload; trusted backend only.';
comment on column public.webhook_events.payload is 'Private webhook body; trusted backend only and never rendered in browser administration.';
