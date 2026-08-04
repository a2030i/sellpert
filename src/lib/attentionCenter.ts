import { orderFinancialIssue } from './orderQuality'
import { friendlyDeliveryError, productActionLabel, shortDeliveryReference } from './productDelivery'

export type AttentionSeverity = 'urgent' | 'attention' | 'info'
export type AttentionCategory = 'orders' | 'customers' | 'catalog' | 'finance' | 'integration'

export interface AttentionItem {
  id: string
  severity: AttentionSeverity
  category: AttentionCategory
  title: string
  description: string
  count: number
  actionLabel: string
  path: string
  occurredAt?: string | null
}

export interface AttentionOrder {
  id: string
  order_id: string
  status: string
  cargo_tracking_number?: string | null
  total_amount: number
  platform_fee?: number | null
  unit_price: number
  quantity: number
  sku?: string | null
  order_date: string
}

export interface AttentionPackage {
  order_id: string
  shipment_package_id?: string | null
  status: string
  cargo_tracking_number?: string | null
  invoice_status?: string | null
  invoice_rejected_reasons?: unknown
  modified_at?: string | null
}

export interface AttentionQuestion {
  status: string
  asked_at?: string | null
}

export interface AttentionListing {
  product_id: string
  delivery_status: string
  delivery_error?: string | null
  updated_at?: string | null
}

export interface AttentionActionLog {
  id?: string
  platform?: string
  risk_level?: string
  status: string
  action: string
  request?: unknown
  external_batch_id?: string | null
  error_message?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export interface AttentionProduct {
  id?: string
  sku?: string | null
  barcode?: string | null
  external_id?: string | null
  cost_price?: number | null
}

export type MarketplaceOperationTone = 'pending' | 'success' | 'warning' | 'failed'

export interface MarketplaceOperation {
  id: string
  label: string
  statusLabel: string
  tone: MarketplaceOperationTone
  path: string
  actionLabel: string
  error: string
  reference: string
  occurredAt?: string | null
}

export interface AttentionCenterInput {
  orders: AttentionOrder[]
  packages: AttentionPackage[]
  questions: AttentionQuestion[]
  listings: AttentionListing[]
  actionLogs: AttentionActionLog[]
  products: AttentionProduct[]
}

const TERMINAL_ORDER_STATUSES = new Set(['delivered', 'cancelled', 'returned'])
const OPEN_PACKAGE_STATUSES = new Set(['created', 'picking', 'invoiced', 'pending', 'processing'])
const WAITING_QUESTION_STATUSES = new Set(['waiting_for_answer', 'waiting', 'unanswered', 'pending'])
const FAILED_DELIVERY_STATUSES = new Set(['failed', 'error', 'rejected', 'partial'])

function normalized(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function hasInvoiceRejection(row: AttentionPackage) {
  if (normalized(row.invoice_status).includes('reject')) return true
  if (Array.isArray(row.invoice_rejected_reasons)) return row.invoice_rejected_reasons.length > 0
  return Boolean(row.invoice_rejected_reasons && String(row.invoice_rejected_reasons) !== '{}')
}

function marketplaceActionLabel(action: string) {
  if (action.startsWith('products.')) return productActionLabel(action)
  if (action === 'packages.status') return 'تحديث حالة الشحنة'
  if (action === 'packages.tracking' || action === 'packages.cargo_provider') return 'تحديث بيانات الشحن والتتبع'
  if (action.includes('common_label')) return 'تجهيز ملصق الشحن'
  if (action.startsWith('packages.')) return 'إجراء على الشحنة'
  if (action.startsWith('invoices.')) return 'إرسال فاتورة الطلب'
  if (action.startsWith('returns.')) return 'معالجة طلب مرتجع'
  if (action === 'questions.answer') return 'الرد على سؤال عميل'
  return 'عملية في Trendyol'
}

function marketplaceStatus(status: string): { label: string; tone: MarketplaceOperationTone } {
  const value = normalized(status)
  if (value === 'success') return { label:'اكتملت بنجاح', tone:'success' }
  if (value === 'partial') return { label:'اكتملت جزئيًا وتحتاج مراجعة', tone:'warning' }
  if (value === 'failed') return { label:'لم تكتمل', tone:'failed' }
  if (value === 'processing') return { label:'قيد معالجة Trendyol', tone:'pending' }
  if (value === 'accepted') return { label:'تم إرسالها إلى Trendyol', tone:'pending' }
  return { label:'جارٍ التنفيذ', tone:'pending' }
}

function operationTarget(log: AttentionActionLog, input: AttentionCenterInput) {
  const request = log.request as { path?: Record<string, unknown>; payload?: { items?: Array<Record<string, unknown>> } } | null
  const action = String(log.action || '')
  if (action.startsWith('products.')) {
    const item = request?.payload?.items?.[0]
    const contentId = normalized(item?.contentId)
    const barcode = normalized(item?.barcode)
    const product = input.products.find(row =>
      (contentId && normalized(row.external_id) === contentId) || (barcode && normalized(row.barcode) === barcode),
    )
    if (product?.id) return { path:`/product-detail?id=${encodeURIComponent(product.id)}`, actionLabel:'فتح المنتج' }
    return { path:'/products', actionLabel:'فتح المنتجات' }
  }
  if (action.startsWith('packages.') || action.startsWith('invoices.')) {
    const packageId = normalized(request?.path?.packageId)
    const trackingNumber = normalized(request?.path?.cargoTrackingNumber)
    const shipment = input.packages.find(row =>
      (packageId && normalized(row.shipment_package_id) === packageId) ||
      (trackingNumber && normalized(row.cargo_tracking_number) === trackingNumber),
    )
    if (shipment?.order_id) return { path:`/orders?order=${encodeURIComponent(shipment.order_id)}`, actionLabel:'فتح الطلب' }
    return { path:'/orders', actionLabel:'فتح الطلبات' }
  }
  if (action === 'questions.answer') return { path:'/integrations?panel=trendyol-questions', actionLabel:'فتح أسئلة العملاء' }
  return { path:'/integrations', actionLabel:'فتح الربط' }
}

export function buildMarketplaceOperations(input: AttentionCenterInput): MarketplaceOperation[] {
  return input.actionLogs
    .filter(log => normalized(log.risk_level) !== 'read' || FAILED_DELIVERY_STATUSES.has(normalized(log.status)))
    .map((log, index) => {
    const status = marketplaceStatus(log.status)
    const target = operationTarget(log, input)
    return {
      id: log.id || `marketplace-operation-${index}`,
      label: marketplaceActionLabel(log.action),
      statusLabel: status.label,
      tone: status.tone,
      path: target.path,
      actionLabel: target.actionLabel,
      error: friendlyDeliveryError(log.error_message),
      reference: shortDeliveryReference(log.external_batch_id),
      occurredAt: log.finished_at || log.started_at,
    }
    })
}

export function buildAttentionItems(input: AttentionCenterInput): AttentionItem[] {
  const items: AttentionItem[] = []
  const invoiceRejected = input.packages.filter(hasInvoiceRejection)
  const openPackages = input.packages.filter(row => OPEN_PACKAGE_STATUSES.has(normalized(row.status)) && !row.cargo_tracking_number)
  const packagedOrderIds = new Set(input.packages.map(row => row.order_id))
  const ordersWithoutShipment = input.orders.filter(row =>
    !TERMINAL_ORDER_STATUSES.has(normalized(row.status)) &&
    !row.cargo_tracking_number &&
    !packagedOrderIds.has(row.order_id),
  )
  const waitingQuestions = input.questions.filter(row => WAITING_QUESTION_STATUSES.has(normalized(row.status)))
  const rejectedListings = input.listings.filter(row => FAILED_DELIVERY_STATUSES.has(normalized(row.delivery_status)))
  const rejectedListingPaths = new Set(rejectedListings.map(row => `/product-detail?id=${encodeURIComponent(row.product_id)}`))
  const failedOperations = buildMarketplaceOperations(input).filter(operation =>
    ['failed', 'warning'].includes(operation.tone) && !rejectedListingPaths.has(operation.path),
  )
  const financialIssues = input.orders.filter(row => Boolean(orderFinancialIssue(row)))

  const productCosts = new Map<string, number>()
  for (const product of input.products) {
    const sku = normalized(product.sku)
    if (sku && Number(product.cost_price || 0) > 0) productCosts.set(sku, Number(product.cost_price))
  }
  const financiallyRelevantOrders = input.orders.filter(row => !['cancelled', 'returned'].includes(normalized(row.status)))
  const missingCostOrders = financiallyRelevantOrders.filter(row => !row.sku || !productCosts.has(normalized(row.sku)))
  const missingCostUnits = missingCostOrders.reduce((sum, row) => sum + Math.max(1, Number(row.quantity || 1)), 0)

  if (invoiceRejected.length) items.push({
    id: 'invoice-rejected', severity: 'urgent', category: 'orders', count: invoiceRejected.length,
    title: 'فواتير شحن مرفوضة',
    description: `${invoiceRejected.length} شحنة رفضت المنصة فاتورتها وتحتاج تصحيحًا قبل اكتمال المعالجة.`,
    actionLabel: 'فتح أول طلب', path: `/orders?order=${encodeURIComponent(invoiceRejected[0].order_id)}`,
    occurredAt: invoiceRejected[0].modified_at,
  })
  if (openPackages.length) items.push({
    id: 'packages-without-tracking', severity: 'urgent', category: 'orders', count: openPackages.length,
    title: 'شحنات تنتظر التجهيز أو رقم التتبع',
    description: `${openPackages.length} شحنة مفتوحة لم تصل إلى مرحلة الشحن بعد. ابدأ بالأقدم لتجنب التأخير.`,
    actionLabel: 'متابعة أول شحنة', path: `/orders?order=${encodeURIComponent(openPackages[0].order_id)}`,
    occurredAt: openPackages[0].modified_at,
  })
  if (ordersWithoutShipment.length) items.push({
    id: 'orders-without-shipment', severity: 'attention', category: 'orders', count: ordersWithoutShipment.length,
    title: 'طلبات بلا شحنة مسجلة',
    description: `${ordersWithoutShipment.length} طلبًا نشطًا لم يظهر له رقم تتبع أو طرد شحن حتى الآن.`,
    actionLabel: 'مراجعة أول طلب', path: `/orders?order=${encodeURIComponent(ordersWithoutShipment[0].order_id)}`,
    occurredAt: ordersWithoutShipment[0].order_date,
  })
  if (waitingQuestions.length) items.push({
    id: 'customer-questions', severity: 'urgent', category: 'customers', count: waitingQuestions.length,
    title: 'أسئلة عملاء تنتظر الرد',
    description: `${waitingQuestions.length} سؤالًا من عملاء Trendyol لم تتم الإجابة عنه.`,
    actionLabel: 'فتح صندوق الأسئلة', path: '/integrations?panel=trendyol-questions',
    occurredAt: waitingQuestions[0].asked_at,
  })
  if (rejectedListings.length) items.push({
    id: 'rejected-listings', severity: 'urgent', category: 'catalog', count: rejectedListings.length,
    title: 'تحديثات منتجات لم تعتمد',
    description: `${rejectedListings.length} تحديثًا للمنتجات رُفض أو تعذر إرساله إلى المنصة.`,
    actionLabel: 'فتح أول منتج', path: `/product-detail?id=${encodeURIComponent(rejectedListings[0].product_id)}`,
    occurredAt: rejectedListings[0].updated_at,
  })
  if (failedOperations.length) items.push({
    id: 'failed-actions', severity: 'attention', category: 'integration', count: failedOperations.length,
    title: failedOperations.length === 1 ? `${failedOperations[0].label} لم تكتمل` : 'عمليات Trendyol لم تكتمل',
    description: failedOperations[0].error || `${failedOperations.length} عملية حديثة لم تكتمل وتحتاج مراجعة قبل إعادة المحاولة.`,
    actionLabel: failedOperations[0].actionLabel, path: failedOperations[0].path, occurredAt: failedOperations[0].occurredAt,
  })
  if (financialIssues.length) items.push({
    id: 'financial-quality', severity: 'attention', category: 'finance', count: financialIssues.length,
    title: 'طلبات تحتاج مراجعة مالية',
    description: `${financialIssues.length} طلبًا يحتوي فرقًا بين الإجمالي والكمية أو رسومًا غير منطقية في المصدر.`,
    actionLabel: 'فتح أول طلب', path: `/orders?order=${encodeURIComponent(financialIssues[0].order_id)}`,
    occurredAt: financialIssues[0].order_date,
  })
  if (missingCostOrders.length) items.push({
    id: 'missing-product-costs', severity: 'info', category: 'finance', count: missingCostOrders.length,
    title: 'صافي الربح غير مكتمل',
    description: `${missingCostUnits} وحدة مباعة أو قيد التنفيذ بلا تكلفة شراء؛ لن يعرض النظام ربحًا نهائيًا لها حتى استكمال التكلفة.`,
    actionLabel: 'استكمال التكاليف', path: '/products?costs=import', occurredAt: missingCostOrders[0].order_date,
  })

  const severityRank: Record<AttentionSeverity, number> = { urgent: 0, attention: 1, info: 2 }
  return items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
}

export function attentionTotals(items: AttentionItem[]) {
  return items.reduce((totals, item) => {
    totals.total += item.count
    totals[item.severity] += item.count
    return totals
  }, { total: 0, urgent: 0, attention: 0, info: 0 })
}
