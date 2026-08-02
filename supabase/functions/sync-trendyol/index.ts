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

    const now = new Date().toISOString()
    await admin.from('sync_logs').update({
      status: 'success', records_synced: rows.length, finished_at: now,
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

    return json({ ok: true, records_synced: daily.size, orders: rows.length }, 200, corsHeaders)
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
  target.set(externalId, row)
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
