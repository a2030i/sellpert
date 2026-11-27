import { upsertMarketplaceProducts } from '../_shared/marketplaceProducts.ts'
import { accountScopedClient, resolveMarketplaceAccount } from '../_shared/marketplaceAccountScope.ts'
/**
 * salla-sync
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches data from Salla API and syncs into Sellpert DB.
 * Can be called:
 *   1. By the queue worker (job_type: sync_orders | sync_products | sync_analytics)
 *   2. Directly by admin for a full manual sync
 *
 * SECURITY: Checks the administrative account access state before every sync.
 *           Suspended merchants → 402 immediately, no data fetched.
 *
 * Body: { merchant_code, job_type, payload? }
 */

import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { getSettings } from '../_shared/getSettings.ts'
import { authorizeMerchantSync, HttpError } from '../_shared/sync.ts'
import { resolveSallaTokens, storeSallaTokens } from '../_shared/sallaTokenVault.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SALLA_API    = 'https://api.salla.dev/admin/v2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200)
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let admin = createClient(SUPABASE_URL, SERVICE_KEY)
  let syncingConnectionId: string | null = null

  try {
    const { merchant_code, marketplace_account_id, job_type, payload: jobPayload } = await req.json()
    if (!merchant_code || !job_type) return json({ error: 'merchant_code and job_type required' }, 400)
    if(!['sync_orders','sync_products','sync_analytics','sync_all'].includes(job_type))return json({error:'Unknown job_type'},400)
    await authorizeMerchantSync(req, admin, SERVICE_KEY, String(merchant_code))
    const account=await resolveMarketplaceAccount(admin,String(merchant_code),'salla',marketplace_account_id)
    admin=accountScopedClient(admin,account)

    // ── GUARD: Check administrative account access ──────────────────────────
    const { data: merchant } = await admin
      .from('merchants')
      .select('workspace_status, name')
      .eq('merchant_code', merchant_code)
      .maybeSingle()

    if (!merchant) return json({ error: 'Merchant not found' }, 404)

    if (merchant.workspace_status !== 'active') {
      console.warn(`[GUARD] Blocked sync for ${merchant_code} — status: ${merchant.workspace_status}`)
      return json({ error: 'ACCOUNT_SUSPENDED', status: merchant.workspace_status }, 403)
    }

    // ── Get Salla tokens ──────────────────────────────────────────────────────
    const { data: conn } = await admin
      .from('salla_connections')
      .select('id,merchant_code,token_expires_at,sync_status,access_token,refresh_token')
      .eq('merchant_code', merchant_code)
      .in('sync_status', ['idle','error'])
      .maybeSingle()

    if (!conn) return json({ error: 'No active Salla connection' }, 404)

    // Refresh token if expiring in < 5 minutes
    const credentials = await resolveSallaTokens(admin, conn)
    let accessToken = credentials.accessToken
    if (!accessToken) return json({ error: 'Salla credentials are unavailable' }, 409)
    if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() - Date.now() < 300000) {
      accessToken = await refreshSallaToken(admin, conn, credentials)
    }

    // Mark connection as syncing
    const {data:claimed,error:claimError}=await admin.from('salla_connections').update({sync_status:'syncing'}).eq('id',conn.id).in('sync_status',['idle','error']).select('id').maybeSingle()
    if(claimError)throw claimError
    if(!claimed)throw new HttpError(409,'Salla synchronization is already running')
    syncingConnectionId=conn.id

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
        result = await syncAnalytics(admin, merchant_code)
        break
      case 'sync_all':
        const o=await syncOrders(admin,merchant_code,accessToken,{})
        const p=await syncProducts(admin,merchant_code,accessToken,{})
        result = { orders:o, products:p }
        break
      default:
        return json({ error: `Unknown job_type: ${job_type}` }, 400)
    }

    if(job_type!=='sync_analytics')await syncAnalytics(admin,merchant_code)
    // Mark connection idle + update last_sync
    const {error:finishError}=await admin.from('salla_connections').update({
      sync_status:  'idle',
      last_sync_at: new Date().toISOString(),
    }).eq('id',syncingConnectionId)
    if(finishError)throw finishError
    syncingConnectionId=null

    return json({ ok: true, ...result })

  } catch (e: any) {
    console.error('salla-sync error:', e)
    if (syncingConnectionId) {
      await admin.from('salla_connections').update({ sync_status: 'error' }).eq('id',syncingConnectionId)
    }
    return json({ ok:false,error:e instanceof HttpError ? e.message : 'تعذرت مزامنة سلة؛ أعد المحاولة' },e instanceof HttpError ? e.status : 500)
  }
})

// ── Order Sync ────────────────────────────────────────────────────────────────

async function syncOrders(admin: any, merchantCode: string, token: string, payload: any) {
  // If specific order_id provided, fetch just that order
  if (payload?.order_id) {
    const res = await sallaGet(`/orders/${payload.order_id}`, token)
    if (!res.ok) throw new Error(`Salla order fetch failed (${res.status})`)
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
    if (!res.ok) throw new Error(`Salla page fetch failed (${res.status})`)
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
  const {error}=await admin.from('orders').upsert({
    merchant_code: merchantCode,
    platform:      'salla',
    order_id:      String(order.id || order.reference_id),
    status,
    product_name:  order.items?.[0]?.product?.name || null,
    quantity:      order.items?.reduce((s: number, i: any) => s + (i.quantity || 1), 0) || 1,
    unit_price:    order.items?.[0]?.price?.amount || 0,
    total_amount:  order.amounts?.total?.amount || 0,
    shipping_cost: order.amounts?.shipping?.amount || 0,
    currency:      order.currency || 'SAR',
    customer_city: order.customer?.city || null,
    order_date:    order.date?.date ? new Date(order.date.date).toISOString() : new Date().toISOString(),
  }, { onConflict: 'merchant_code,platform,order_id', ignoreDuplicates: false })
  if(error)throw error
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
    if (!res.ok) throw new Error(`Salla product fetch failed (${res.status})`)
    const product = (await res.json()).data
    await upsertProduct(admin, merchantCode, product)
    return { synced: 1 }
  }

  let page = 1
  let synced = 0

  while (true) {
    const res = await sallaGet(`/products?page=${page}&per_page=50`, token)
    if (!res.ok) throw new Error(`Salla page fetch failed (${res.status})`)
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
  await upsertMarketplaceProducts(admin, merchantCode, [{
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
  }])
}

// ── Analytics Sync ────────────────────────────────────────────────────────────

async function syncAnalytics(admin: any, merchantCode: string) {
  // Aggregate persisted account-scoped facts; never label an undated provider
  // lifetime summary as today's revenue or silently discard a failed upsert.
  const {data,error}=await admin.rpc('rebuild_performance_data',{p_merchant_code:merchantCode})
  if(error)throw error
  return {rebuilt:data}
}

// ── Token Refresh ─────────────────────────────────────────────────────────────

async function refreshSallaToken(admin: any, conn: any, credentials: { accessToken: string; refreshToken: string }): Promise<string> {
  const cfg = await getSettings(admin)

  if (!credentials.refreshToken) return credentials.accessToken

  const res = await fetch('https://accounts.salla.sa/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  })

  if (!res.ok) {
    throw new Error(`Salla token refresh failed (${res.status})`)
  }

  const tokens = await res.json()
  const newToken = tokens.access_token
  const expiresIn = tokens.expires_in || 3600
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
  const nextRefreshToken = tokens.refresh_token || credentials.refreshToken

  const storedInVault = await storeSallaTokens(admin, conn.id, newToken, nextRefreshToken, expiresAt)
  if (!storedInVault) {
    await admin.from('salla_connections').update({
      access_token: newToken,
      refresh_token: nextRefreshToken,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq('merchant_code', conn.merchant_code)
  }

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

