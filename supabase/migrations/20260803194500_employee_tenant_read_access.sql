-- Merchant employees may read operational data for their owning merchant.
-- Writes remain governed by the existing page/action-specific policies.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders', 'order_items', 'products', 'inventory',
    'performance_data', 'ad_metrics', 'returns', 'account_transactions',
    'platform_file_uploads', 'sync_queue', 'sync_logs', 'sync_requests',
    'ai_insights', 'notifications', 'budget_alerts', 'sales_targets',
    'product_platform_listings', 'product_platform_prices',
    'product_performance_snapshots', 'price_change_log',
    'goods_received', 'inbound_shipments', 'inbound_shipment_items',
    'platform_deals', 'amazon_daily_sales', 'import_diagnostics',
    'merchant_payout_schedule', 'marketplace_action_logs'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS employee_read_owner_tenant ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY employee_read_owner_tenant ON public.%I FOR SELECT TO authenticated USING (security.can_access_merchant(merchant_code))',
      t
    );
  END LOOP;
END
$$;
