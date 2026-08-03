const SA_COMMISSION_VAT_MULTIPLIER = 1.15

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = finiteNumber(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

export function trendyolPackageId(shipment: any): string {
  return String(shipment?.shipmentPackageId ?? shipment?.id ?? '').trim()
}

export function mapTrendyolOrderStatus(value: unknown) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '')
  return ({
    created: 'pending', awaiting: 'pending', unpacked: 'pending',
    picking: 'processing', invoiced: 'processing',
    shipped: 'shipped', atcollectionpoint: 'shipped',
    delivered: 'delivered', cancelled: 'cancelled', unsupplied: 'cancelled',
    undelivered: 'returned', returned: 'returned',
  } as Record<string, string>)[normalized] || 'pending'
}

function mergeStatus(current: string | undefined, incoming: string) {
  if (!current) return incoming
  // An order remains actionable while any one of its split packages is open.
  const priority: Record<string, number> = {
    pending: 6, processing: 5, shipped: 4, returned: 3, delivered: 2, cancelled: 1,
  }
  return (priority[incoming] || 0) > (priority[current] || 0) ? incoming : current
}

export type TrendyolLineFinancials = {
  quantity: number
  unitPrice: number
  grossUnitPrice: number
  discountUnitAmount: number
  lineTotal: number
  grossTotal: number
  discountTotal: number
  commissionRate: number
  commissionAmount: number
  vatRate: number
}

export function trendyolLineFinancials(line: any): TrendyolLineFinancials {
  const quantity = Math.max(1, Math.trunc(firstNumber(line?.quantity) ?? 1))
  const sellerDiscount = firstNumber(line?.lineSellerDiscount)
  const trendyolDiscount = firstNumber(line?.lineTyDiscount)
  const componentDiscount = sellerDiscount !== undefined || trendyolDiscount !== undefined
    ? (sellerDiscount ?? 0) + (trendyolDiscount ?? 0)
    : undefined
  const discountUnitAmount = Math.max(0, firstNumber(
    line?.lineTotalDiscount,
    componentDiscount,
    line?.discount,
  ) ?? 0)
  const grossUnitPrice = Math.max(0, firstNumber(
    line?.lineGrossAmount,
    line?.price,
    line?.amount,
  ) ?? 0)
  const unitPrice = Math.max(0, firstNumber(
    line?.lineUnitPrice,
    grossUnitPrice - discountUnitAmount,
    line?.price,
    line?.amount,
  ) ?? 0)
  const commissionRate = Math.max(0, firstNumber(line?.commission, line?.commissionRate) ?? 0)
  const vatRate = Math.max(0, firstNumber(line?.vatRate) ?? 0)
  const lineTotal = unitPrice * quantity

  return {
    quantity,
    unitPrice,
    grossUnitPrice,
    discountUnitAmount,
    lineTotal,
    grossTotal: grossUnitPrice * quantity,
    discountTotal: discountUnitAmount * quantity,
    commissionRate,
    commissionAmount: lineTotal * commissionRate / 100 * SA_COMMISSION_VAT_MULTIPLIER,
    vatRate,
  }
}

function safeIsoDate(value: unknown, fallback: string) {
  const numeric = finiteNumber(value)
  const date = numeric !== undefined && numeric > 0 ? new Date(numeric) : new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

export function mergeTrendyolShipment(
  target: Map<string, any>,
  shipment: any,
  merchantCode: string,
  syncedAt = new Date().toISOString(),
) {
  const externalId = String(shipment?.orderNumber ?? shipment?.id ?? shipment?.shipmentPackageId ?? '').trim()
  if (!externalId) return

  const lines = Array.isArray(shipment?.lines) ? shipment.lines : []
  const financials: TrendyolLineFinancials[] = lines.map((line: any) => trendyolLineFinancials(line))
  const quantity = financials.reduce((sum: number, line: TrendyolLineFinancials) => sum + line.quantity, 0) || 1
  const calculatedNet = financials.reduce((sum: number, line: TrendyolLineFinancials) => sum + line.lineTotal, 0)
  const calculatedGross = financials.reduce((sum: number, line: TrendyolLineFinancials) => sum + line.grossTotal, 0)
  const calculatedDiscount = financials.reduce((sum: number, line: TrendyolLineFinancials) => sum + line.discountTotal, 0)
  const packageNet = Math.max(0, firstNumber(shipment?.packageTotalPrice, shipment?.totalPrice) ?? calculatedNet)
  const packageGross = Math.max(0, firstNumber(shipment?.packageGrossAmount) ?? calculatedGross)
  const packageDiscount = Math.max(0, firstNumber(shipment?.packageTotalDiscount, shipment?.totalDiscount, shipment?.discount) ?? calculatedDiscount)
  const packageCommission = financials.reduce((sum: number, line: TrendyolLineFinancials) => sum + line.commissionAmount, 0)
  const packageCommissionRate = financials.reduce((rate: number, line: TrendyolLineFinancials) => Math.max(rate, line.commissionRate), 0)
  const packageVatRate = financials.reduce((rate: number, line: TrendyolLineFinancials) => Math.max(rate, line.vatRate), 0)
  const packageId = trendyolPackageId(shipment)
  const incomingStatus = mapTrendyolOrderStatus(shipment?.shipmentPackageStatus || shipment?.status)
  const existing = target.get(externalId)
  const row = existing || {
    merchant_code: merchantCode,
    platform: 'trendyol',
    order_id: externalId,
    status: incomingStatus,
    product_name: '',
    sku: '',
    quantity: 0,
    unit_price: 0,
    total_amount: 0,
    gross_amount: 0,
    platform_fee: 0,
    currency: shipment?.currencyCode || lines[0]?.currencyCode || 'SAR',
    customer_city: shipment?.shipmentAddress?.city || shipment?.shipmentAddress?.stateName || null,
    order_date: safeIsoDate(shipment?.orderDate || shipment?.createdDate, syncedAt),
    shipment_package_id: packageId || null,
    cargo_tracking_number: String(shipment?.cargoTrackingNumber ?? shipment?.trackingNumber ?? '').trim() || null,
    cargo_provider: shipment?.cargoProviderName || null,
    shipping_cost: 0,
    shipment_address: shipment?.shipmentAddress || null,
    invoice_address: shipment?.invoiceAddress || null,
    discount_amount: 0,
    commission_rate: null,
    vat_rate: null,
    raw: shipment,
    last_synced_at: syncedAt,
  }

  const names = lines.map((line: any) => line.productName).filter(Boolean)
  const skus = lines.map((line: any) => line.merchantSku || line.stockCode || line.barcode).filter(Boolean)
  row.product_name = [...new Set([...(row.product_name ? row.product_name.split(' | ') : []), ...names])].join(' | ')
  row.sku = [...new Set([...(row.sku ? row.sku.split(' | ') : []), ...skus])].join(' | ')
  row.quantity += quantity
  row.total_amount += packageNet
  row.gross_amount += packageGross
  row.discount_amount += packageDiscount
  row.platform_fee += packageCommission
  row.shipping_cost += Math.max(0, firstNumber(shipment?.cargoFee, shipment?.shippingCost) ?? 0)
  row.commission_rate = Math.max(finiteNumber(row.commission_rate) ?? 0, packageCommissionRate) || null
  row.vat_rate = Math.max(finiteNumber(row.vat_rate) ?? 0, packageVatRate) || null
  row.unit_price = row.quantity ? row.total_amount / row.quantity : row.total_amount
  row.status = mergeStatus(row.status, incomingStatus)
  row.shipment_package_id ||= packageId || null
  row.cargo_tracking_number ||= String(shipment?.cargoTrackingNumber ?? shipment?.trackingNumber ?? '').trim() || null
  row.cargo_provider ||= shipment?.cargoProviderName || null
  row.raw = shipment
  row.last_synced_at = syncedAt
  target.set(externalId, row)
}
