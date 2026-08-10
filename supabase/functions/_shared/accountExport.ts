export type AccountExportResource = {
  key: string
  label: string
  table: string
  filterColumn?: 'merchant_code' | 'owner_merchant_code'
  columns?: string
}

// Only tenant-owned base tables belong here. Credential resources use an
// explicit allow-list so authentication material can never enter an export.
export const ACCOUNT_EXPORT_RESOURCES: readonly AccountExportResource[] = [
  { key: 'products', label: 'المنتجات', table: 'products' },
  { key: 'product_listings', label: 'قوائم المنتجات في المنصات', table: 'product_platform_listings' },
  { key: 'product_prices', label: 'أسعار المنتجات في المنصات', table: 'product_platform_prices' },
  { key: 'product_performance', label: 'سجل أداء المنتجات', table: 'product_performance_snapshots' },
  { key: 'inventory', label: 'المخزون', table: 'inventory' },
  { key: 'orders', label: 'الطلبات', table: 'orders' },
  { key: 'order_items', label: 'بنود الطلبات', table: 'order_items' },
  { key: 'order_packages', label: 'شحنات الطلبات', table: 'order_packages' },
  { key: 'returns', label: 'المرتجعات', table: 'returns' },
  { key: 'transactions', label: 'الحركات المالية', table: 'account_transactions' },
  { key: 'payouts', label: 'جدول التحويلات', table: 'merchant_payout_schedule' },
  { key: 'performance', label: 'مؤشرات الأداء', table: 'performance_data' },
  { key: 'advertising', label: 'بيانات الإعلانات', table: 'ad_metrics' },
  { key: 'amazon_daily_sales', label: 'مبيعات أمازون اليومية', table: 'amazon_daily_sales' },
  { key: 'sales_targets', label: 'أهداف المبيعات', table: 'sales_targets' },
  { key: 'budget_alerts', label: 'تنبيهات الميزانية', table: 'budget_alerts' },
  { key: 'uploads', label: 'سجل الملفات المرفوعة', table: 'platform_file_uploads' },
  { key: 'import_diagnostics', label: 'تشخيصات الاستيراد', table: 'import_diagnostics' },
  { key: 'entry_sessions', label: 'جلسات إدخال البيانات', table: 'entry_sessions' },
  { key: 'inbound_shipments', label: 'الشحنات الواردة', table: 'inbound_shipments' },
  { key: 'inbound_items', label: 'بنود الشحنات الواردة', table: 'inbound_shipment_items' },
  { key: 'goods_received', label: 'البضائع المستلمة', table: 'goods_received' },
  { key: 'sync_logs', label: 'سجل المزامنة', table: 'sync_logs' },
  { key: 'sync_requests', label: 'طلبات المزامنة', table: 'sync_requests' },
  { key: 'sync_queue', label: 'مهام المزامنة', table: 'sync_queue' },
  { key: 'marketplace_actions', label: 'عمليات منصات البيع', table: 'marketplace_action_logs' },
  { key: 'webhook_events', label: 'أحداث الربط', table: 'webhook_events' },
  { key: 'merchant_requests', label: 'طلبات المتجر', table: 'merchant_requests' },
  { key: 'notifications', label: 'الإشعارات', table: 'notifications' },
  { key: 'weekly_briefs', label: 'الملخصات الأسبوعية', table: 'merchant_weekly_briefs' },
  { key: 'price_changes', label: 'تغييرات الأسعار', table: 'price_change_log' },
  { key: 'platform_deals', label: 'عروض المنصات', table: 'platform_deals' },
  { key: 'account_links', label: 'الحسابات المرتبطة', table: 'merchant_account_links', columns: 'id,email,merchant_code,is_default,created_at' },
  { key: 'team_members', label: 'أعضاء الفريق', table: 'merchants', filterColumn: 'owner_merchant_code', columns: 'id,merchant_code,name,email,role,job_title,department,permissions,is_active,created_at' },
  { key: 'integration_metadata', label: 'بيانات الربط دون الأسرار', table: 'platform_credentials', columns: 'id,merchant_code,platform,seller_id,is_active,last_sync_at,records_synced,created_at,updated_at,test_status,last_tested_at' },
  { key: 'salla_metadata', label: 'بيانات ربط سلة دون الرموز', table: 'salla_connections', columns: 'id,merchant_code,salla_store_id,salla_merchant_id,store_name,store_domain,store_currency,store_country,store_logo,token_expires_at,scope,installed_at,uninstalled_at,last_sync_at,sync_status,orders_synced,products_synced,created_at,updated_at' },
  { key: 'notes', label: 'ملاحظات المتجر', table: 'merchant_notes' },
  { key: 'nps', label: 'تقييمات التجربة', table: 'nps_responses' },
  { key: 'account_closure', label: 'طلبات إغلاق الحساب', table: 'account_closure_requests' },
  { key: 'legal_acceptances', label: 'سجل الموافقة على الشروط والخصوصية', table: 'merchant_legal_acceptances', columns: 'id,merchant_code,user_id,terms_version,privacy_version,accepted_at,source' },
  { key: 'audit_log', label: 'سجل النشاط والأمان', table: 'audit_log' },
] as const

export function findAccountExportResource(key: unknown) {
  return ACCOUNT_EXPORT_RESOURCES.find(resource => resource.key === key) || null
}

export function parseExportPageSize(value: unknown) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return 500
  return Math.min(parsed, 1000)
}

const SENSITIVE_KEY = /(?:password|secret|token|authorization|api[_-]?key|credential)/i

export function redactExportSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactExportSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactExportSecrets(child),
  ]))
}
