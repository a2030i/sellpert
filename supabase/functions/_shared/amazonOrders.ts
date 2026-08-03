import { numberValue } from './sync.ts'

export function amazonRequestHeaders(accessToken: string, now = new Date()) {
  return {
    'x-amz-access-token': accessToken,
    'x-amz-date': now.toISOString().replace(/[:-]|\.\d{3}/g, ''),
    'user-agent': 'Sellpert/2.0 (Language=Deno; Platform=SupabaseEdge)',
    Accept: 'application/json',
  }
}

export function mapAmazonOrder(order: any, merchantCode: string, syncedAt = new Date().toISOString()) {
  const externalId = String(order?.orderId || order?.amazonOrderId || '')
  if (!externalId) return null
  const items: any[] = order.orderItems || order.items || []
  const quantity = items.reduce((sum, item) => sum + numberValue(item.quantityOrdered || item.quantity), 0) || 1
  const itemNames = items.map(item => item.product?.title || item.title).filter(Boolean)
  const skus = items.map(item => item.product?.sellerSku || item.sellerSku).filter(Boolean)
  const itemProceeds = items.reduce((sum, item) => sum + proceedsValue(item.proceeds), 0)
  const total = moneyValue(order.proceeds?.grandTotal) || itemProceeds || moneyValue(order.orderTotal)
  const createdTime = order.createdTime || order.purchaseDate || syncedAt
  const fulfillmentStatus = order.fulfillment?.fulfillmentStatus || order.fulfillmentStatus || order.orderStatus || 'PENDING'
  const address = order.recipient?.deliveryAddress || order.shippingAddress || null
  const firstPackage = Array.isArray(order.packages) ? order.packages[0] : null

  return {
    merchant_code: merchantCode,
    platform: 'amazon',
    order_id: externalId,
    status: mapAmazonStatus(String(fulfillmentStatus)),
    product_name: [...new Set(itemNames)].join(' | ') || null,
    sku: [...new Set(skus)].join(' | ') || null,
    quantity,
    unit_price: quantity ? total / quantity : total,
    total_amount: total,
    gross_amount: total,
    // Orders API does not expose Amazon commissions. Finances API is the
    // authoritative source, so never present points cost as a platform fee.
    platform_fee: 0,
    currency: detectCurrency(order, items) || 'SAR',
    customer_city: address?.city || address?.municipality || null,
    fulfillment_model: String(order.fulfillment?.fulfilledBy || order.fulfilledBy || ''),
    shipment_package_id: firstPackage?.packageReferenceId || null,
    cargo_tracking_number: firstPackage?.trackingNumber || null,
    cargo_provider: firstPackage?.carrier || null,
    shipment_address: address,
    order_date: new Date(createdTime).toISOString(),
    raw: order,
    last_synced_at: syncedAt,
  }
}

export function mapAmazonOrderItems(order: any, merchantCode: string, syncedAt = new Date().toISOString()) {
  const orderId = String(order?.orderId || order?.amazonOrderId || '')
  if (!orderId) return []
  return (order.orderItems || order.items || []).flatMap((item: any, index: number) => {
    const lineId = String(item.orderItemId || item.id || index + 1)
    const quantity = numberValue(item.quantityOrdered || item.quantity) || 1
    const lineTotal = proceedsValue(item.proceeds)
    const product = item.product || {}
    return [{
      merchant_code: merchantCode,
      platform: 'amazon',
      order_id: orderId,
      line_id: lineId,
      content_id: product.asin || item.asin || null,
      sku: product.sellerSku || item.sellerSku || null,
      product_name: product.title || item.title || null,
      quantity,
      unit_price: moneyValue(product.price?.unitPrice) || (quantity ? lineTotal / quantity : lineTotal),
      line_total: lineTotal,
      discount_amount: discountValue(item.proceeds),
      commission_amount: 0,
      raw: item,
      catalog_raw: product,
      last_synced_at: syncedAt,
    }]
  })
}

export function enrichAmazonOrderItems(items: any[], catalogItems: any[]) {
  const catalogue = new Map(catalogItems.map(item => [String(item?.asin || ''), item]))
  for (const row of items) {
    const item = catalogue.get(String(row.content_id || ''))
    if (!item) continue
    const marketplaceImages = Array.isArray(item.images) ? item.images.flatMap((entry: any) => entry?.images || []) : []
    const mainImage = marketplaceImages.find((image: any) => image?.variant === 'MAIN') || marketplaceImages[0]
    const summary = Array.isArray(item.summaries) ? item.summaries[0] : null
    const identifiers = Array.isArray(item.identifiers)
      ? item.identifiers.flatMap((entry: any) => entry?.identifiers || [])
      : []
    const barcode = identifiers.find((identifier: any) => /^(EAN|UPC|GTIN)$/i.test(String(identifier?.identifierType)))

    row.product_name = row.product_name || summary?.itemName || null
    row.barcode = row.barcode || barcode?.identifier || null
    row.image_url = mainImage?.link || null
    row.images = marketplaceImages
    row.catalog_raw = item
  }
  return items
}

export function mapAmazonPackages(order: any, merchantCode: string, syncedAt = new Date().toISOString()) {
  const orderId = String(order?.orderId || order?.amazonOrderId || '')
  if (!orderId) return []
  return (order.packages || []).map((pkg: any, index: number) => {
    const packageItems: any[] = pkg.packageItems || []
    return {
      merchant_code: merchantCode,
      platform: 'amazon',
      order_id: orderId,
      shipment_package_id: String(pkg.packageReferenceId || pkg.trackingNumber || `${orderId}-${index + 1}`),
      status: mapPackageStatus(String(pkg.packageStatus?.status || pkg.packageStatus?.detailedStatus || 'PENDING')),
      cargo_tracking_number: pkg.trackingNumber || null,
      cargo_provider: pkg.carrier || null,
      delivery_type: pkg.shippingService || null,
      line_count: packageItems.length,
      quantity: packageItems.reduce((sum, item) => sum + numberValue(item.quantity), 0),
      total_amount: 0,
      currency: detectCurrency(order, order.orderItems || []) || 'SAR',
      modified_at: pkg.shipTime || pkg.createdTime || order.lastUpdatedTime || syncedAt,
      last_synced_at: syncedAt,
      raw: pkg,
    }
  })
}

export function mapAmazonFinancialTransaction(transaction: any, merchantCode: string) {
  const transactionNo = String(transaction?.transactionId || '')
  if (!transactionNo) return null
  const identifiers = identifierMap(transaction.relatedIdentifiers)
  const items: any[] = transaction.items || []
  const productContext = items.flatMap(item => item.contexts || [])
    .find(context => String(context.contextType).toLowerCase() === 'productcontext') || {}
  const total = moneyValue(transaction.totalAmount)
  return {
    merchant_code: merchantCode,
    platform: 'amazon',
    transaction_no: transactionNo,
    transaction_date: transaction.postedDate || null,
    posted_date: transaction.postedDate || null,
    transaction_type: transaction.transactionType || null,
    order_id: identifiers.ORDER_ID || null,
    description: transaction.description || null,
    product_name: items[0]?.description || null,
    product_sku: productContext.sku || null,
    amount_type: transaction.transactionStatus || null,
    amount_description: expenseLabels(transaction).join(' | ') || null,
    debit: total < 0 ? Math.abs(total) : 0,
    credit: total > 0 ? total : 0,
    net_amount: total,
    currency: transaction.totalAmount?.currencyCode || 'SAR',
    marketplace: transaction.marketplaceDetails?.marketplaceName || transaction.marketplaceDetails?.marketplaceId || null,
    settlement_id: identifiers.SETTLEMENT_ID || identifiers.FINANCIAL_EVENT_GROUP_ID || null,
    shipment_id: identifiers.SHIPMENT_ID || null,
    quantity_purchased: numberValue(productContext.quantityShipped) || null,
    raw: transaction,
  }
}

export function amazonFeeByOrder(transactions: any[]) {
  const fees = new Map<string, number>()
  for (const transaction of transactions) {
    const orderId = identifierMap(transaction?.relatedIdentifiers).ORDER_ID
    if (!orderId) continue
    fees.set(orderId, (fees.get(orderId) || 0) + amazonTransactionFee(transaction))
  }
  return fees
}

export function amazonTransactionFee(transaction: any): number {
  const roots: any[] = transaction?.breakdowns || []
  const expenseRoots = roots.filter(entry => /expense|fee|commission/i.test(String(entry.breakdownType)))
  if (expenseRoots.length) {
    return -expenseRoots.reduce((sum, entry) => sum + moneyValue(entry.breakdownAmount), 0)
  }
  const leaves = flattenBreakdowns(roots).filter(entry => /fee|commission/i.test(String(entry.breakdownType)))
  return -leaves.reduce((sum, entry) => sum + moneyValue(entry.breakdownAmount), 0)
}

function moneyValue(value: any): number {
  if (value == null) return 0
  if (typeof value === 'number' || typeof value === 'string') return numberValue(value)
  return numberValue(value.amount ?? value.currencyAmount ?? value.value ?? value.total ?? value.subtotal)
}

function proceedsValue(value: any): number {
  if (!value) return 0
  const direct = moneyValue(value.grandTotal ?? value.proceedsTotal ?? value.total ?? value.subtotal)
  if (direct) return direct
  return (value.breakdowns || []).reduce((sum: number, entry: any) => {
    const amount = moneyValue(entry.subtotal ?? entry.value ?? entry.amount)
    return sum + (String(entry.type).toUpperCase() === 'DISCOUNT' ? -Math.abs(amount) : amount)
  }, 0)
}

function discountValue(value: any): number {
  return Math.abs((value?.breakdowns || []).reduce((sum: number, entry: any) =>
    String(entry.type).toUpperCase() === 'DISCOUNT' ? sum + moneyValue(entry.subtotal) : sum, 0))
}

function detectCurrency(order: any, items: any[]) {
  return order.proceeds?.grandTotal?.currencyCode || order.orderTotal?.currencyCode ||
    items[0]?.proceeds?.proceedsTotal?.currencyCode || items[0]?.product?.price?.unitPrice?.currencyCode
}

function identifierMap(identifiers: any[]) {
  return (identifiers || []).reduce((result: Record<string, string>, identifier: any) => {
    const name = String(identifier.relatedIdentifierName || '')
    if (name) result[name] = String(identifier.relatedIdentifierValue || '')
    return result
  }, {})
}

function flattenBreakdowns(breakdowns: any[]): any[] {
  return (breakdowns || []).flatMap(entry => [entry, ...flattenBreakdowns(entry.breakdowns || [])])
}

function expenseLabels(transaction: any) {
  return [...new Set(flattenBreakdowns(transaction?.breakdowns || [])
    .filter(entry => /expense|fee|commission/i.test(String(entry.breakdownType)))
    .map(entry => String(entry.breakdownType)))]
}

export function mapAmazonStatus(value: string) {
  return ({
    PENDING_AVAILABILITY: 'pending', PENDING: 'pending', UNSHIPPED: 'processing',
    PARTIALLY_SHIPPED: 'processing', SHIPPED: 'shipped', DELIVERED: 'delivered',
    CANCELLED: 'cancelled', CANCELED: 'cancelled', UNFULFILLABLE: 'cancelled',
  } as Record<string, string>)[value.toUpperCase()] || 'pending'
}

function mapPackageStatus(value: string) {
  return ({
    PENDING: 'pending', IN_TRANSIT: 'shipped', SHIPPED: 'shipped', DELIVERED: 'delivered',
    CANCELLED: 'cancelled', CANCELED: 'cancelled', UNDELIVERABLE: 'returned',
    RETURNING_TO_SELLER: 'returned', RETURNED_TO_SELLER: 'returned',
  } as Record<string, string>)[value.toUpperCase()] || value.toLowerCase()
}
