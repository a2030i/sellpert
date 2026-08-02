import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  HttpError,
  authorizeMerchantSync,
  fetchJsonWithRetry,
  json,
  numberValue,
  parseSyncRange,
  splitRange,
} from '../_shared/sync.ts'
import { resolveSecretPayload } from '../_shared/credentialVault.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TRENDYOL_API = 'https://apigw.trendyol.com/integration/order/sellers'
const TRENDYOL_PRODUCT_API = 'https://apigw.trendyol.com/integration/product/sellers'
const TRENDYOL_FINANCE_API = 'https://apigw.trendyol.com/integration/finance/che/sellers'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  let logId = ''
  let mappingId = ''

  try {
    const body = await req.json()
    const merchantCode = String(body?.merchant_code || '')
    mappingId = String(body?.mapping_id || '')
    if (!merchantCode) throw new HttpError(400, 'merchant_code مطلوب')
    await authorizeMerchantSync(req, admin, SERVICE_KEY, merchantCode)

    const { data: merchant } = await admin.from('merchants')
      .select('subscription_status').eq('merchant_code', merchantCode).maybeSingle()
    if (!merchant) throw new HttpError(404, 'Merchant not found')
    if (merchant.subscription_status !== 'active') throw new HttpError(402, 'SUBSCRIPTION_INACTIVE')

    const credentials = await resolveCredentials(admin, merchantCode, mappingId)
    const { from, to } = parseSyncRange(body, 90)

    const { data: log, error: logError } = await admin.from('sync_logs').insert({
      merchant_code: merchantCode,
      platform: 'trendyol',
      status: 'running',
      records_synced: 0,
    }).select().single()
    if (logError) throw logError
    logId = log.id

    const auth = btoa(`${credentials.apiKey}:${credentials.apiSecret}`)
    const headers = {
      Authorization: `Basic ${auth}`,
      // Trendyol requires "Seller Id - Integration Company" on every request.
      'User-Agent': `${credentials.sellerId} - Sellpert`,
      Accept: 'application/json',
    }

    const orders = new Map<string, any>()
    // Trendyol accepts at most a two-week date interval. Slightly smaller
    // windows avoid boundary/time-zone rejection.
    for (const window of splitRange(from, to, 13)) {
      let page = 0
      while (true) {
        const query = new URLSearchParams({
          startDate: String(window.from.getTime()),
          endDate: String(window.to.getTime()),
          orderByField: 'PackageLastModifiedDate',
          orderByDirection: 'ASC',
          page: String(page),
          size: '200',
        })
        const data = await fetchJsonWithRetry(
          `${TRENDYOL_API}/${encodeURIComponent(credentials.sellerId)}/orders?${query}`,
          { headers },
          'Trendyol API',
        )
        const packages: any[] = data?.content || []
        for (const shipment of packages) mergeShipment(orders, shipment, merchantCode)

        const totalPages = numberValue(data?.totalPages)
        if (packages.length < 200 || (totalPages > 0 && page + 1 >= totalPages)) break
        page++
      }
    }

    const rows = [...orders.values()]
    await upsertRows(admin, rows)
    const daily = buildDaily(rows)
    await upsertPerformance(admin, merchantCode, daily)

    const details: Record<string, unknown> = { orders: rows.length, performance_days: daily.size }
    const warnings: string[] = []
    details.returns = await optionalResource('returns', warnings, () =>
      syncReturns(admin, merchantCode, credentials.sellerId, from, to, headers))
    details.settlements = await optionalResource('settlements', warnings, () =>
      syncSettlements(admin, merchantCode, credentials.sellerId, from, to, headers))
    const productResult = await optionalResource('products', warnings, () =>
      syncProducts(admin, merchantCode, credentials.sellerId, headers))
    details.products = typeof productResult === 'object' && productResult ? (productResult as any).products : productResult
    details.inventory = typeof productResult === 'object' && productResult ? (productResult as any).inventory : 0
    details.warnings = warnings

    const now = new Date().toISOString()
    await admin.from('sync_logs').update({
      status: 'success', records_synced: rows.length, finished_at: now, details,
    }).eq('id', logId)
    await admin.from('platform_credentials').update({
      last_sync_at: now, records_synced: rows.length,
    }).eq('merchant_code', merchantCode).eq('platform', 'trendyol')
    if (mappingId) await admin.from('merchant_platform_mappings').update({
      last_sync_at: now,
      last_sync_status: 'success',
      records_synced: rows.length,
      last_sync_error: null,
    }).eq('id', mappingId).eq('merchant_code', merchantCode)

    return json({ ok: true, records_synced: rows.length, ...details }, 200, corsHeaders)
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500
    if (logId) await admin.from('sync_logs').update({
      status: 'error', error_message: error.message, finished_at: new Date().toISOString(),
    }).eq('id', logId)
    if (mappingId) await admin.from('merchant_platform_mappings').update({
      last_sync_status: 'error', last_sync_error: error.message,
    }).eq('id', mappingId)
    return json({ error: error.message }, status, corsHeaders)
  }
})

async function resolveCredentials(admin: any, merchantCode: string, mappingId: string) {
  if (mappingId) {
    const { data } = await admin.from('merchant_platform_mappings')
      .select('seller_id,merchant_code,platform,platform_connections(api_key,api_secret)')
      .eq('id', mappingId).eq('merchant_code', merchantCode).eq('platform', 'trendyol').maybeSingle()
    const connection = data?.platform_connections as any
    if (!data || !connection) throw new HttpError(404, 'Trendyol connection not found')
    assertCredentials(data.seller_id, connection.api_key, connection.api_secret)
    return { sellerId: data.seller_id, apiKey: connection.api_key, apiSecret: connection.api_secret }
  }

  const { data } = await admin.from('platform_credentials').select('seller_id,api_key,api_secret,extra')
    .eq('merchant_code', merchantCode).eq('platform', 'trendyol').eq('is_active', true).maybeSingle()
  if (!data) throw new HttpError(400, 'لا توجد بيانات ربط مفعلة لترنديول')
  const secret = await resolveSecretPayload(data)
  assertCredentials(secret.seller_id, secret.api_key, secret.api_secret)
  return { sellerId: secret.seller_id, apiKey: secret.api_key, apiSecret: secret.api_secret }
}

function assertCredentials(sellerId: unknown, apiKey: unknown, apiSecret: unknown) {
  if (!sellerId || !apiKey || !apiSecret) {
    throw new HttpError(400, 'بيانات Trendyol غير مكتملة (Seller ID / API Key / API Secret)')
  }
}

function mergeShipment(target: Map<string, any>, shipment: any, merchantCode: string) {
  const externalId = String(shipment.orderNumber || shipment.id || shipment.shipmentPackageId || '')
  if (!externalId) return
  const lines: any[] = shipment.lines || []
  const quantity = lines.reduce((sum, line) => sum + numberValue(line.quantity || 1), 0) || 1
  const total = lines.reduce((sum, line) => sum + numberValue(line.price) * numberValue(line.quantity || 1), 0)
  const existing = target.get(externalId)
  const row = existing || {
    merchant_code: merchantCode,
    platform: 'trendyol',
    order_id: externalId,
    status: mapStatus(shipment.status),
    product_name: '',
    sku: '',
    quantity: 0,
    unit_price: 0,
    total_amount: 0,
    gross_amount: 0,
    // Commission is deliberately not estimated. It must come from a financial report/API.
    platform_fee: 0,
    currency: shipment.currencyCode || 'TRY',
    customer_city: shipment.shipmentAddress?.city || null,
    order_date: new Date(shipment.orderDate || shipment.createdDate || Date.now()).toISOString(),
    shipment_package_id: String(shipment.id || shipment.shipmentPackageId || '') || null,
    cargo_tracking_number: String(shipment.cargoTrackingNumber || shipment.trackingNumber || '') || null,
    cargo_provider: shipment.cargoProviderName || shipment.cargoSenderNumber || null,
    shipping_cost: numberValue(shipment.cargoFee || shipment.shippingCost),
    shipment_address: shipment.shipmentAddress || null,
    invoice_address: shipment.invoiceAddress || null,
    discount_amount: numberValue(shipment.totalDiscount || shipment.discount),
    commission_rate: null,
    vat_rate: null,
    raw: shipment,
    last_synced_at: new Date().toISOString(),
  }
  const names = lines.map(line => line.productName).filter(Boolean)
  const skus = lines.map(line => line.merchantSku || line.stockCode || line.barcode).filter(Boolean)
  row.product_name = [...new Set([...(row.product_name ? row.product_name.split(' | ') : []), ...names])].join(' | ')
  row.sku = [...new Set([...(row.sku ? row.sku.split(' | ') : []), ...skus])].join(' | ')
  row.quantity += quantity
  row.total_amount += total || numberValue(shipment.totalPrice)
  row.gross_amount = row.total_amount
  row.unit_price = row.quantity ? row.total_amount / row.quantity : row.total_amount
  row.status = mapStatus(shipment.status)
  row.shipment_package_id ||= String(shipment.id || shipment.shipmentPackageId || '') || null
  row.cargo_tracking_number ||= String(shipment.cargoTrackingNumber || shipment.trackingNumber || '') || null
  row.raw = shipment
  row.last_synced_at = new Date().toISOString()
  target.set(externalId, row)
}

async function optionalResource(name: string, warnings: string[], task: () => Promise<any>) {
  try {
    return await task()
  } catch (error: any) {
    console.error(`[trendyol:${name}]`, error?.message || error)
    warnings.push(`${name}: ${error?.message || 'sync failed'}`)
    return 0
  }
}

async function pagedContent(url: string, headers: Record<string, string>, pageSize = 200) {
  const rows: any[] = []
  let page = 0
  while (true) {
    const separator = url.includes('?') ? '&' : '?'
    const data = await fetchJsonWithRetry(`${url}${separator}page=${page}&size=${pageSize}`, { headers }, 'Trendyol API')
    const content = Array.isArray(data) ? data : (data?.content || data?.items || [])
    rows.push(...content)
    const totalPages = numberValue(data?.totalPages)
    if (content.length < pageSize || (totalPages > 0 && page + 1 >= totalPages)) break
    page++
  }
  return rows
}

async function syncReturns(admin: any, merchantCode: string, sellerId: string, from: Date, to: Date, headers: Record<string, string>) {
  const params = new URLSearchParams({ startDate: String(from.getTime()), endDate: String(to.getTime()) })
  const claims = await pagedContent(`${TRENDYOL_API}/${encodeURIComponent(sellerId)}/claims?${params}`, headers)
  const rows: any[] = []
  for (const claim of claims) {
    const claimId = String(claim.id || claim.claimId || '')
    const items = claim.items || claim.claimItems || claim.lines || [claim]
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      const line = item.orderLine || item.line || item
      const lineId = String(item.id || item.claimItemId || line.id || index)
      if (!claimId) continue
      rows.push({
        merchant_code: merchantCode, platform: 'trendyol', claim_id: claimId, claim_line_id: lineId,
        order_id: String(claim.orderNumber || line.orderNumber || line.orderId || '') || null,
        product_name: line.productName || line.name || null,
        sku: line.merchantSku || line.stockCode || line.barcode || null,
        quantity: Math.max(1, numberValue(item.quantity || line.quantity || 1)),
        return_amount: numberValue(item.amount || line.price || claim.totalPrice),
        reason: item.customerClaimItemReason?.name || item.reason?.name || item.reason || claim.reason || null,
        return_date: new Date(claim.claimDate || claim.createdDate || claim.lastModifiedDate || Date.now()).toISOString().slice(0, 10),
        status: String(item.claimItemStatus?.name || item.status || claim.status || 'pending'),
        raw: { claim, item }, last_synced_at: new Date().toISOString(),
      })
    }
  }
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('returns').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,claim_id,claim_line_id',
    })
    if (error) throw error
  }
  return rows.length
}

async function syncSettlements(admin: any, merchantCode: string, sellerId: string, from: Date, to: Date, headers: Record<string, string>) {
  const financeHeaders = { ...headers, storeFrontCode: 'SA' }
  const transactions: any[] = []
  // Finance API enforces a short date interval as well; use the same safe
  // 13-day windows as orders and retrieve Sale/Return independently.
  for (const window of splitRange(from, to, 13)) {
    for (const transactionType of ['Sale', 'Return']) {
      const params = new URLSearchParams({
        transactionType, startDate: String(window.from.getTime()), endDate: String(window.to.getTime()),
      })
      transactions.push(...await pagedContent(
        `${TRENDYOL_FINANCE_API}/${encodeURIComponent(sellerId)}/settlements?${params}`,
        financeHeaders,
        500,
      ))
    }
  }
  const rows = transactions.map((tx: any, index: number) => {
    const transactionNo = String(tx.id || tx.transactionId || tx.transactionNumber || `${tx.orderNumber || 'tx'}-${tx.transactionDate || index}-${tx.transactionType || ''}`)
    const type = String(tx.transactionType || tx.type || 'settlement')
    const isDebit = /return|deduction|debit/i.test(type)
    const gross = numberValue(tx.credit || tx.debt || tx.amount || tx.totalPrice || tx.paymentPrice)
    const sellerRevenue = numberValue(tx.sellerRevenue || tx.netAmount || gross - numberValue(tx.commissionAmount))
    return {
      merchant_code: merchantCode, platform: 'trendyol', transaction_no: transactionNo,
      transaction_date: new Date(tx.transactionDate || tx.createdDate || Date.now()).toISOString(),
      posted_date: tx.paymentDate ? new Date(tx.paymentDate).toISOString() : null,
      transaction_type: type, order_id: String(tx.orderNumber || tx.orderId || '') || null,
      description: tx.description || tx.transactionType || null,
      product_name: tx.productName || null, product_sku: tx.merchantSku || tx.stockCode || null,
      product_barcode: tx.barcode || null, amount_type: tx.amountType || type,
      amount_description: tx.amountDescription || tx.description || null,
      debit: isDebit ? Math.abs(gross) : numberValue(tx.debt),
      credit: isDebit ? numberValue(tx.credit) : Math.abs(gross),
      net_amount: isDebit ? -Math.abs(sellerRevenue) : sellerRevenue,
      currency: tx.currencyCode || tx.currency || 'TRY', marketplace: 'Trendyol',
      settlement_id: String(tx.settlementId || tx.paymentOrderId || '') || null, raw: tx,
    }
  })
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('account_transactions').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,transaction_no',
    })
    if (error) throw error
  }
  const orderFinancials = new Map<string, { fee: number; rate: number }>()
  for (const tx of transactions) {
    const orderId = String(tx.orderNumber || tx.orderId || '')
    if (!orderId) continue
    const current = orderFinancials.get(orderId) || { fee: 0, rate: 0 }
    const sign = /return/i.test(String(tx.transactionType || tx.type || '')) ? -1 : 1
    current.fee += sign * numberValue(tx.commissionAmount)
    current.rate = Math.max(current.rate, numberValue(tx.commissionRate))
    orderFinancials.set(orderId, current)
  }
  for (const [orderId, financial] of orderFinancials) {
    const { error } = await admin.from('orders').update({
      platform_fee: Math.max(0, financial.fee), commission_rate: financial.rate || null,
    }).eq('merchant_code', merchantCode).eq('platform', 'trendyol').eq('order_id', orderId)
    if (error) throw error
  }
  return rows.length
}

async function syncProducts(admin: any, merchantCode: string, sellerId: string, headers: Record<string, string>) {
  const items = await pagedContent(`${TRENDYOL_PRODUCT_API}/${encodeURIComponent(sellerId)}/products`, headers)
  const now = new Date().toISOString()
  const products = items.map((item: any) => {
    const sku = String(item.stockCode || item.merchantSku || item.barcode || item.id || '')
    return {
      merchant_code: merchantCode, name: item.title || item.productName || sku, sku,
      barcode: String(item.barcode || '') || null, category: item.categoryName || item.category?.name || null,
      description: item.description || null, image_url: item.images?.[0]?.url || item.imageUrl || null,
      images: item.images || null, cost_price: 0, target_net_price: numberValue(item.salePrice || item.price),
      sale_price: numberValue(item.salePrice || item.price), status: item.approved === false || item.archived ? 'inactive' : 'active',
      brand: item.brand || item.brandName || null, external_id: String(item.id || item.productMainId || '') || null,
      model_code: item.productMainId || item.modelCode || null, vat_rate: numberValue(item.vatRate),
      commission_rate: numberValue(item.commissionRate), supplier_sku: item.stockCode || null,
      platform_source: 'trendyol_api', raw: item, last_synced_at: now,
    }
  }).filter((item: any) => item.sku)
  for (let index = 0; index < products.length; index += 100) {
    const { error } = await admin.from('products').upsert(products.slice(index, index + 100), { onConflict: 'merchant_code,sku' })
    if (error) throw error
  }
  const inventory = items.map((item: any) => ({
    merchant_code: merchantCode, platform: 'trendyol',
    sku: String(item.stockCode || item.merchantSku || item.barcode || item.id || ''),
    product_name: item.title || item.productName || null,
    quantity: Math.max(0, Math.trunc(numberValue(item.quantity || item.stock))), reserved_quantity: 0,
    low_stock_threshold: 5, cost_price: null, image_url: item.images?.[0]?.url || item.imageUrl || null,
    is_active: item.approved !== false && !item.archived, last_updated: now, raw: item,
  })).filter((item: any) => item.sku)
  for (let index = 0; index < inventory.length; index += 100) {
    const { error } = await admin.from('inventory').upsert(inventory.slice(index, index + 100), { onConflict: 'merchant_code,sku,platform' })
    if (error) throw error
  }
  return { products: products.length, inventory: inventory.length }
}

function mapStatus(value: string) {
  return ({
    Created: 'pending', Picking: 'processing', Invoiced: 'processing',
    Shipped: 'shipped', Delivered: 'delivered', Cancelled: 'cancelled',
    UnDelivered: 'returned', Returned: 'returned', UnSupplied: 'cancelled',
  } as Record<string, string>)[value] || 'pending'
}

async function upsertRows(admin: any, rows: any[]) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('orders').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,order_id',
    })
    if (error) throw error
  }
}

function buildDaily(rows: any[]) {
  const daily = new Map<string, { sales: number; orders: number }>()
  for (const row of rows) {
    if (row.status === 'cancelled') continue
    const date = row.order_date.slice(0, 10)
    const value = daily.get(date) || { sales: 0, orders: 0 }
    value.sales += numberValue(row.total_amount)
    value.orders++
    daily.set(date, value)
  }
  return daily
}

async function upsertPerformance(admin: any, merchantCode: string, daily: Map<string, any>) {
  for (const [date, value] of daily) {
    const row = {
      merchant_code: merchantCode,
      platform: 'trendyol',
      data_date: date,
      total_sales: value.sales,
      order_count: value.orders,
      platform_fees: 0,
      margin: 0,
      ad_spend: 0,
    }
    // performance_data uses a partial unique index for aggregate rows
    // (product_name IS NULL), which PostgREST cannot infer from onConflict.
    const { data: existing, error: lookupError } = await admin.from('performance_data')
      .select('id').eq('merchant_code', merchantCode).eq('platform', 'trendyol')
      .eq('data_date', date).is('product_name', null).maybeSingle()
    if (lookupError) throw lookupError
    const { error } = existing
      ? await admin.from('performance_data').update(row).eq('id', existing.id)
      : await admin.from('performance_data').insert(row)
    if (error) throw error
  }
}
