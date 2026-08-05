import { trendyolPackageWorkflow } from './trendyolOrderWorkflow'

export type OperationalOrder = { id: string; order_id: string; platform: string; product_name?: string | null; status?: string | null; order_date?: string | null }
export type OperationalPackage = {
  id: string
  order_id: string
  shipment_package_id: string | number
  provider_status?: string | null
  status?: string | null
  cargo_tracking_number?: string | null
  invoice_number?: string | null
  invoice_status?: string | null
  invoice_rejected_reasons?: unknown
  modified_at?: string | null
  raw?: Record<string, any> | null
}

export type OrderOperationRow = {
  order: OperationalOrder
  package: OperationalPackage
  canStartPicking: boolean
  needsInvoice: boolean
  needsInvoiceCorrection: boolean
  needsTracking: boolean
}

export type OrderOperationTaskKind = 'picking' | 'invoicing' | 'tracking'

export type OrderOperationTask = {
  key: string
  kind: OrderOperationTaskKind
  label: string
  description: string
  priority: number
  order: OperationalOrder
  package: OperationalPackage
}

function normalized(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '')
}

export function invoiceNeedsCorrection(packageRow: OperationalPackage) {
  const status = normalized(packageRow.invoice_status)
  const reasons = packageRow.invoice_rejected_reasons
  return ['rejected', 'failed', 'invoicerejected'].includes(status) ||
    (Array.isArray(reasons) ? reasons.length > 0 : Boolean(String(reasons || '').trim()))
}

export function buildOrderOperationQueue(orders: OperationalOrder[], packages: OperationalPackage[]) {
  const ordersByNumber = new Map(orders.filter(order => order.platform === 'trendyol').map(order => [order.order_id, order]))
  const rows: OrderOperationRow[] = []
  for (const packageRow of packages) {
    const order = ordersByNumber.get(packageRow.order_id)
    if (!order || !String(packageRow.shipment_package_id || '').trim()) continue
    const workflow = trendyolPackageWorkflow(packageRow, order.status || undefined)
    const needsInvoiceCorrection = invoiceNeedsCorrection(packageRow)
    rows.push({
      order,
      package:packageRow,
      canStartPicking:workflow.canStartPicking,
      needsInvoice:needsInvoiceCorrection || (workflow.canInvoice && !String(packageRow.invoice_number || '').trim()),
      needsInvoiceCorrection,
      needsTracking:workflow.canUpdateTracking && !String(packageRow.cargo_tracking_number || '').trim(),
    })
  }
  rows.sort((left,right) => String(left.order.order_date || '').localeCompare(String(right.order.order_date || '')))
  const tasks: OrderOperationTask[] = []
  for (const row of rows) {
    const packageId = String(row.package.shipment_package_id)
    if (row.needsInvoiceCorrection) tasks.push({
      key:`invoice-correction:${packageId}`, kind:'invoicing', label:'تصحيح الفاتورة',
      description:'رفض Trendyol الفاتورة الحالية. افتح الطلب وراجع سبب الرفض ثم أرسل النسخة الصحيحة.',
      priority:0, order:row.order, package:row.package,
    })
    if (row.canStartPicking) tasks.push({
      key:`picking:${packageId}`, kind:'picking', label:'بدء تجهيز الطلب',
      description:'الطلب جاهز للتجهيز في Trendyol ولم تبدأ معالجته بعد.',
      priority:1, order:row.order, package:row.package,
    })
    if (row.needsInvoice && !row.needsInvoiceCorrection) tasks.push({
      key:`invoice:${packageId}`, kind:'invoicing', label:'إصدار الفاتورة',
      description:'بدأ تجهيز الطلب وما زالت الفاتورة غير مسجلة.',
      priority:2, order:row.order, package:row.package,
    })
    if (row.needsTracking) tasks.push({
      key:`tracking:${packageId}`, kind:'tracking', label:'إكمال بيانات الشحن',
      description:'شركة الشحن أو رقم التتبع لم يُسجل بعد لهذه الشحنة.',
      priority:3, order:row.order, package:row.package,
    })
  }
  tasks.sort((left,right) => left.priority - right.priority || String(left.order.order_date || '').localeCompare(String(right.order.order_date || '')))
  return {
    rows,
    picking:rows.filter(row => row.canStartPicking),
    invoicing:rows.filter(row => row.needsInvoice),
    tracking:rows.filter(row => row.needsTracking),
    tasks,
  }
}
