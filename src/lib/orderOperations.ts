import { trendyolPackageWorkflow } from './trendyolOrderWorkflow'

export type OperationalOrder = { id: string; order_id: string; platform: string; status?: string | null; order_date?: string | null }
export type OperationalPackage = {
  id: string
  order_id: string
  shipment_package_id: string | number
  provider_status?: string | null
  status?: string | null
  cargo_tracking_number?: string | null
  invoice_number?: string | null
  invoice_status?: string | null
  raw?: Record<string, any> | null
}

export type OrderOperationRow = {
  order: OperationalOrder
  package: OperationalPackage
  canStartPicking: boolean
  needsInvoice: boolean
  needsTracking: boolean
}

export function buildOrderOperationQueue(orders: OperationalOrder[], packages: OperationalPackage[]) {
  const ordersByNumber = new Map(orders.filter(order => order.platform === 'trendyol').map(order => [order.order_id, order]))
  const rows: OrderOperationRow[] = []
  for (const packageRow of packages) {
    const order = ordersByNumber.get(packageRow.order_id)
    if (!order || !String(packageRow.shipment_package_id || '').trim()) continue
    const workflow = trendyolPackageWorkflow(packageRow, order.status || undefined)
    rows.push({
      order,
      package:packageRow,
      canStartPicking:workflow.canStartPicking,
      needsInvoice:workflow.canInvoice && !String(packageRow.invoice_number || '').trim(),
      needsTracking:workflow.canUpdateTracking && !String(packageRow.cargo_tracking_number || '').trim(),
    })
  }
  rows.sort((left,right) => String(right.order.order_date || '').localeCompare(String(left.order.order_date || '')))
  return {
    rows,
    picking:rows.filter(row => row.canStartPicking),
    invoicing:rows.filter(row => row.needsInvoice),
    tracking:rows.filter(row => row.needsTracking),
  }
}
