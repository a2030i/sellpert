/**
 * salla-sync
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches data from Salla API and syncs into Sellpert DB.
 * Can be called:
 *   1. By the queue worker (job_type: sync_orders | sync_products | sync_analytics)
 *   2. Directly by admin for a full manual sync
 *
 * SECURITY: Checks subscription_status = 'active' before EVERY sync.
 *           Suspended merchants → 402 immediately, no data fetched.
 *
 * Body: { merchant_code, job_type, payload? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSettings } from '../_shared/getSettings.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SALLA_API    = 'https://api.salla.dev/admin/v2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    const { merchant_code, job_type, payload: jobPayload } = await req.json()
    if (!merchant_code || !job_type) return json({ error: 'merchant_code and job_type required' }, 400)

    // ── GUARD: Check subscription status ─────────────────────────────────────
    const { data: merchant } = await admin
      .from('merchants')
      .select('subscription_status, subscription_plan, name')
      .eq('merchant_code', merchant_code)
      .maybeSingle()

    if (!merchant) return json({ error: 'Merchant not found' }, 404)

    if (merchant.subscription_status !== 'active') {
      console.warn(`[GUARD] Blocked sync for ${merchant_code} — status: ${merchant.subscription_status}`)
      return json({ error: 'SUBSCRIPTION_INACTIVE', status: merchant.subscription_status }, 402)
    }

    // ── Get Salla tokens ──────────────────────────────────────────────────────
    const { data: conn } = await admin
      .from('salla_connections')
      .select('*')
      .eq('merchant_code', merchant_code)
      .eq('sync_status', 'idle')
      .maybeSingle()

    if (!conn) return json({ error: 'No active Salla connection' }, 404)

    // Refresh token if expiring in < 5 minutes
    let accessToken = conn.access_token
    if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() - Date.now() < 300000) {
      accessToken = await refreshSallaToken(admin, conn)
    }

    // Mark connection as syncing
    await admin.from('salla_connections').update({ sync_status: 'syncing' })
      .eq('merchant_code', merchant_code)

    let result: any = {}

    // ── Route to correct sync job ────────────────────────────────────────────
    switch (job_type) {
      case 'sync_orders':
        result = await syncOrders(admin, merchant_code, accessToken, jobPayload)
        break
      case 'sync_products':
        result = await syncProducts(admin, merchant_code, accessToken, jobPayload)
        break
      case 'sync_analytics':
        result = await syncAnalytics(admin, merchant_code, accessToken)
        break
      case 'sync_all':
        const [o, p, a] = await Promise.all([
          syncOrders(admin, merchant_code, accessToken, {}),
          syncProducts(admin, merchant_code, accessToken, {}),
          syncAnalytics(admin, merchant_code, accessToken),
        ])
        result = { orders: o, products: p, analytics: a }
        break
      default:
        return json({ error: `Unknown job_type: ${job_type}` }, 400)
    }

    // Mark connection idle + update last_sync
    await admin.from('salla_connections').update({
      sync_status:  'idle',
      last_sync_at: new Date().toISOString(),
    }).eq('merchant_code', merchant_code)

    return json({ ok: true, ...result })

  } catch (e: any) {
    console.error('salla-sync error:', e)
    // Reset sync_status on error
    const { merchant_code } = await req.json().catch(() => ({}))
    if (merchant_code) {
      await admin.from('salla_connections').update({ sync_status: 'error' })
        .eq('merchant_code', merchant_code)
    }
    return json({ ok: false, error: e.message }, 500)
  }
})

// ── Order Sync ────────────────────────────────────────────────────────────────

async function syncOrders(admin: any, merchantCode: string, token: string, payload: any) {
  // If specific order_id provided, fetch just that order
  if (payload?.order_id) {
    const res = await sallaGet(`/orders/${payload.order_id}`, token)
    if (!res.ok) return { synced: 0, error: 'Order fetch failed' }
    const order = (await res.json()).data
    await upsertOrder(admin, merchantCode, order)
    return { synced: 1 }
  }

  // Full sync: paginate all orders (last 90 days)
  const since = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
  let page = 1
  let synced = 0

  while (true) {
    const res = await sallaGet(`/orders?page=${page}&per_page=50&created_at[from]=${since}`, token)
    if (!res.ok) break
    const body = await res.json()
    const orders: any[] = body.data || []
    if (orders.length === 0) break

    for (const order of orders) {
      await upsertOrder(admin, merchantCode, order)
      synced++
    }

    if (!body.pagination?.next) break
    page++
  }

  // Update orders_synced count
  await admin.from('salla_connections').update({ orders_synced: synced })
    .eq('merchant_code', merchantCode)

  return { synced }
}

async function upsertOrder(admin: any, merchantCode: string, order: any) {
  const status = mapOrderStatus(order.status?.name || order.status)
  await admin.from('orders').upsert({
    merchant_code: merchantCode,
    platform:      'salla',
    order_id:      String(order.id || order.reference_id),
    status,
    product_name:  order.items?.[0]?.product?.name || null,
    quantity:      order.items?.reduce((s: number, i: any) => s + (i.quantity || 1), 0) || 1,
    unit_price:    order.items?.[0]?.price?.amount || 0,
    total_amount:  order.amounts?.total?.amount || 0,
    platform_fee:  0,
    shipping_cost: order.amounts?.shipping?.amount || 0,
    currency:      order.currency || 'SAR',
    customer_city: order.customer?.city || null,
    order_date:    order.date?.date ? new Date(order.date.date).toISOString() : new Date().toISOString(),
  }, { onConflict: 'merchant_code,platform,order_id', ignoreDuplicates: false })
    .catch(() => {}) // don't fail entire sync on one bad order
}

function mapOrderStatus(raw: string): string {
  const map: Record<string, string> = {
    'pending': 'pending', 'under_review': 'processing',
    'in_progress': 'processing', 'delivering': 'shipped',
    'delivered': 'delivered', 'canceled': 'cancelled',
    'returned': 'returned', 'refunded': 'returned',
  }
  return map[raw?.toLowerCase()] || 'pending'
}

// ── Product Sync ──────────────────────────────────────────────────────────────

async function syncProducts(admin: any, merchantCode: string, token: string, payload: any) {
  if (payload?.product_id) {
    const res = await sallaGet(`/products/${payload.product_id}`, token)
    if (!res.ok) return { synced: 0, error: 'Product fetch failed' }
    const product = (await res.json()).data
    await upsertProduct(admin, merchantCode, product)
    return { synced: 1 }
  }

  let page = 1
  let synced = 0

  while (true) {
    const res = await sallaGet(`/products?page=${page}&per_page=50`, token)
    if (!res.ok) break
    const body = await res.json()
    const products: any[] = body.data || []
    if (products.length === 0) break

    for (const product of products) {
      await upsertProduct(admin, merchantCode, product)
      synced++
    }

    if (!body.pagination?.next) break
    page++
  }

  await admin.from('salla_connections').update({ products_synced: synced })
    .eq('merchant_code', merchantCode)

  return { synced }
}

async function upsertProduct(admin: any, merchantCode: string, product: any) {
  const sku = product.sku || String(product.id)
  await admin.from('products').upsert({
    merchant_code:    merchantCode,
    name:             product.name || 'منتج سلة',
    sku,
    barcode:          product.barcode || null,
    category:         product.categories?.[0]?.name || null,
    description:      product.description || null,
    image_url:        product.images?.[0]?.url || null,
    cost_price:       product.cost_price || 0,
    target_net_price: product.price?.amount || 0,
    status:           product.status === 'sale' ? 'active' : 'inactive',
  }, { onConflict: 'merchant_code,sku', ignoreDuplicates: false })
    .catch(() => {})
}

// ── Analytics Sync ────────────────────────────────────────────────────────────

async function syncAnalytics(admin: any, merchantCode: string, token: string) {
  // Salla provides summary stats — map to performance_data
  const today = new Date().toISOString().split('T')[0]

  // Get today's summary
  const res = await sallaGet('/orders/summary', token)
  if (!res.ok) return { synced: 0, error: 'Analytics fetch failed' }

  const body = await res.json()
  const data  = body.data || {}

  const totalSales  = data.totals?.revenue?.amount || 0
  const orderCount  = data.totals?.orders_count    || 0

  if (totalSales === 0 && orderCount === 0) return { synced: 0 }

  await admin.from('performance_data').upsert({
    merchant_code: merchantCode,
    platform:      'salla',
    data_date:     today,
    total_sales:   totalSales,
    order_count:   orderCount,
    margin:        0,
    ad_spend:      0,
    platform_fees: 0,
  }, { onConflict: 'merchant_code,platform,data_date', ignoreDuplicates: false })
    .catch(() => {})

  return { synced: 1 }
}

// ── Token Refresh ─────────────────────────────────────────────────────────────

async function refreshSallaToken(admin: any, conn: any): Promise<string> {
  const cfg = await getSettings(admin)

  if (!conn.refresh_token) return conn.access_token

  const res = await fetch('https://accounts.salla.sa/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: conn.refresh_token,
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  })

  if (!res.ok) {
    console.error('Token refresh failed:', await res.text())
    return conn.access_token
  }

  const tokens = await res.json()
  const newToken = tokens.access_token
  const expiresIn = tokens.expires_in || 3600

  await admin.from('salla_connections').update({
    access_token:    newToken,
    refresh_token:   tokens.refresh_token || conn.refresh_token,
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    updated_at:      new Date().toISOString(),
  }).eq('merchant_code', conn.merchant_code)

  return newToken
}

// ── HTTP Helpers ──────────────────────────────────────────────────────────────

function sallaGet(path: string, token: string) {
  return fetch(`${SALLA_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
    },
  })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

