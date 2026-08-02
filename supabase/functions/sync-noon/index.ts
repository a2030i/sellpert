import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  HttpError,
  authorizeMerchantSync,
  fetchJsonWithRetry,
  json,
  numberValue,
  parseSyncRange,
} from '../_shared/sync.ts'
import { resolveSecretPayload } from '../_shared/credentialVault.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DEFAULT_ORDERS_ENDPOINT = 'https://api.noon.partners/seller/v1/order'
const DEFAULT_TOKEN_ENDPOINT = 'https://idp.noon.partners/token'

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
      merchant_code: merchantCode, platform: 'noon', status: 'running', records_synced: 0,
    }).select().single()
    if (logError) throw logError
    logId = log.id

    const token = await getNoonToken(credentials.serviceAccount, credentials.tokenEndpoint)
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    const rows: any[] = []
    let page = 1
    while (true) {
      const query = new URLSearchParams({
        page: String(page), limit: '100',
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      })
      const data = await fetchJsonWithRetry(`${credentials.ordersEndpoint}?${query}`, { headers }, 'Noon API')
      const orders: any[] = data?.value?.orders || data?.orders || data?.value || []
      for (const order of orders) {
        const row = mapNoonOrder(order, merchantCode)
        if (row) rows.push(row)
      }
      const next = data?.next_page || data?.pagination?.next_page
      if (!next && orders.length < 100) break
      page = next ? numberValue(next) : page + 1
      if (!page || page > 10_000) throw new HttpError(502, 'Invalid Noon pagination response')
    }

    await upsertRows(admin, rows)
    const daily = buildDaily(rows)
    await upsertPerformance(admin, merchantCode, daily)
    const now = new Date().toISOString()
    await admin.from('sync_logs').update({ status: 'success', records_synced: rows.length, finished_at: now }).eq('id', logId)
    await admin.from('platform_credentials').update({ last_sync_at: now, records_synced: rows.length })
      .eq('merchant_code', merchantCode).eq('platform', 'noon')
    if (mappingId) await admin.from('merchant_platform_mappings').update({
      last_sync_at: now, last_sync_status: 'success', records_synced: rows.length, last_sync_error: null,
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
  let data: any
  if (mappingId) {
    const result = await admin.from('merchant_platform_mappings')
      .select('seller_id,merchant_code,platform,platform_connections(extra)')
      .eq('id', mappingId).eq('merchant_code', merchantCode).eq('platform', 'noon').maybeSingle()
    const connection = result.data?.platform_connections as any
    if (!result.data || !connection) throw new HttpError(404, 'Noon connection not found')
    data = { seller_id: result.data.seller_id, extra: connection.extra }
  } else {
    const result = await admin.from('platform_credentials').select('seller_id,extra')
      .eq('merchant_code', merchantCode).eq('platform', 'noon').eq('is_active', true).maybeSingle()
    data = result.data
  }
  const secret = await resolveSecretPayload(data)
  const serviceAccount = secret.service_account
  if (!data || !serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new HttpError(400, 'حساب خدمة Noon غير موجود أو غير مكتمل')
  }
  return {
    sellerId: data.seller_id,
    serviceAccount,
    tokenEndpoint: allowNoonUrl(data.extra?.token_endpoint, DEFAULT_TOKEN_ENDPOINT),
    ordersEndpoint: allowNoonUrl(data.extra?.orders_endpoint, DEFAULT_ORDERS_ENDPOINT),
  }
}

function allowNoonUrl(value: unknown, fallback: string) {
  if (!value) return fallback
  const url = new URL(String(value))
  const allowed = url.protocol === 'https:' && (url.hostname === 'noon.partners' || url.hostname.endsWith('.noon.partners'))
  if (!allowed) throw new HttpError(400, 'Noon endpoint is not allowed')
  return url.toString().replace(/\/$/, '')
}

async function getNoonToken(serviceAccount: Record<string, any>, tokenEndpoint: string) {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: tokenEndpoint,
    iat: now,
    exp: now + 3600,
  }
  const header = { alg: 'RS256', typ: 'JWT' }
  const message = `${base64UrlJson(header)}.${base64UrlJson(claims)}`
  const pem = String(serviceAccount.private_key).replace(/\\n/g, '\n')
  const key = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const keyBytes = Uint8Array.from(atob(key), char => char.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(message))
  const jwt = `${message}.${base64UrlBytes(new Uint8Array(signature))}`
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt,
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) {
    throw new HttpError(response.status || 401, `Noon token: ${data.error_description || data.error || 'authorization failed'}`)
  }
  return data.access_token
}

function base64UrlJson(value: unknown) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function base64UrlBytes(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function mapNoonOrder(order: any, merchantCode: string) {
  const externalId = String(order.nr || order.id || order.order_id || '')
  if (!externalId) return null
  const items: any[] = order.items || order.order_items || []
  const quantity = items.reduce((sum, item) => sum + numberValue(item.quantity || item.qty || 1), 0) || 1
  const itemTotal = items.reduce((sum, item) => sum + numberValue(item.total || item.price) * numberValue(item.quantity || item.qty || 1), 0)
  const total = numberValue(order.grand_total || order.total || order.order_total) || itemTotal
  const dateValue = order.created_at || order.date || order.order_date
  if (!dateValue || Number.isNaN(Date.parse(dateValue))) return null
  return {
    merchant_code: merchantCode, platform: 'noon', order_id: externalId,
    status: mapStatus(String(order.status || '')),
    product_name: [...new Set(items.map(item => item.name || item.product_name).filter(Boolean))].join(' | ') || order.item_name || null,
    sku: [...new Set(items.map(item => item.partner_sku || item.sku).filter(Boolean))].join(' | ') || null,
    noon_sku: [...new Set(items.map(item => item.noon_sku).filter(Boolean))].join(' | ') || null,
    quantity, unit_price: quantity ? total / quantity : total,
    total_amount: total, gross_amount: total,
    // Noon fees must be sourced from its statement/financial API; never estimate them.
    platform_fee: 0,
    currency: order.currency || 'SAR',
    customer_city: order.delivery_address?.city || order.shipping_address?.city || null,
    order_date: new Date(dateValue).toISOString(),
  }
}

function mapStatus(value: string) {
  return ({
    CREATED: 'pending', CONFIRMED: 'processing', PROCESSING: 'processing',
    SHIPPED: 'shipped', DELIVERED: 'delivered', CANCELLED: 'cancelled',
    CANCELED: 'cancelled', RETURNED: 'returned',
  } as Record<string, string>)[value.toUpperCase()] || 'pending'
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
    value.sales += numberValue(row.total_amount); value.orders++
    daily.set(date, value)
  }
  return daily
}

async function upsertPerformance(admin: any, merchantCode: string, daily: Map<string, any>) {
  for (const [date, value] of daily) {
    const { error } = await admin.from('performance_data').upsert({
      merchant_code: merchantCode, platform: 'noon', data_date: date,
      total_sales: value.sales, order_count: value.orders,
      platform_fees: 0, margin: 0, ad_spend: 0,
    }, { onConflict: 'merchant_code,platform,data_date' })
    if (error) throw error
  }
}
