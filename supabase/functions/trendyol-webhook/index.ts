/**
 * trendyol-webhook
 * Receives real-time order events from Trendyol.
 * Trendyol sends supplierId in every payload — used to identify the merchant.
 * Every received event (including test events) is logged to webhook_events.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    // ── التحقق من سر الـ webhook (إغلاق آمن) — بدون توقيع يمكن تزوير
    // طلبات وإيرادات بمجرد معرفة supplierId. السر في app_settings
    // (مفتاح TRENDYOL_WEBHOOK_SECRET) أو env، ويُمرر من ترندیول عبر
    // ترويسة x-webhook-secret أو ?secret= في رابط الـ webhook.
    let expectedSecret = Deno.env.get('TRENDYOL_WEBHOOK_SECRET') || ''
    if (!expectedSecret) {
      const { data: s } = await admin.from('app_settings')
        .select('value').eq('key', 'TRENDYOL_WEBHOOK_SECRET').maybeSingle()
      expectedSecret = s?.value || ''
    }
    if (!expectedSecret) {
      console.error('[trendyol-webhook] TRENDYOL_WEBHOOK_SECRET not configured — rejecting (fail closed)')
      return json({ error: 'Webhook not configured' }, 401)
    }
    const authHeader = req.headers.get('Authorization') || ''
    const provided = req.headers.get('x-webhook-secret')
      || new URL(req.url).searchParams.get('secret')
      || (authHeader.startsWith('Basic ') ? (atob(authHeader.slice(6)).split(':')[1] || '') : '')
      || ''
    if (!timingSafeEqual(provided, expectedSecret)) {
      return json({ error: 'Invalid webhook secret' }, 401)
    }

    const body = await req.json()

    const supplierId = String(body.supplierId || body.supplier_id || '')
    const eventType  = body.event || body.eventType || 'unknown'

    if (!supplierId) return json({ error: 'supplierId missing' }, 400)

    // Find the merchant who owns this supplierId
    const { data: directCredential } = await admin
      .from('platform_credentials')
      .select('merchant_code')
      .eq('platform', 'trendyol')
      .eq('seller_id', supplierId)
      .eq('is_active', true)
      .maybeSingle()

    let merchantCode = directCredential?.merchant_code || null
    if (!merchantCode) {
      const { data: mapping } = await admin.from('merchant_platform_mappings')
        .select('merchant_code').eq('platform', 'trendyol').eq('seller_id', supplierId)
        .eq('is_active', true).maybeSingle()
      merchantCode = mapping?.merchant_code || null
    }

    const orderPayload = body.order || body.content || body
    const providerEventId = String(body.eventId || body.event_id || body.id || '')
    const eventKey = providerEventId || await stableEventKey({
      supplierId, eventType,
      orderId: orderPayload.orderNumber || orderPayload.orderId || orderPayload.id || '',
      status: orderPayload.status || orderPayload.orderStatus || '',
      modifiedAt: orderPayload.lastModifiedDate || orderPayload.packageLastModifiedDate || orderPayload.updatedAt || '',
      amount: orderPayload.grossAmount || orderPayload.totalPrice || orderPayload.amount || 0,
    })

    // Log every event to webhook_events (even if merchant not found)
    const { data: insertedEvent, error: eventError } = await admin.from('webhook_events').upsert({
      source:        'trendyol',
      event_key:     eventKey,
      event_type:    eventType,
      store_id:      supplierId,
      merchant_code: merchantCode,
      payload:       body,
      status:        merchantCode ? 'processing' : 'unmatched',
      received_at:   new Date().toISOString(),
    }, { onConflict: 'source,event_key', ignoreDuplicates: true }).select('id').maybeSingle()
    if (eventError) throw eventError
    if (!insertedEvent) return json({ ok: true, duplicate: true })

    if (!merchantCode) {
      console.warn(`[trendyol-webhook] No merchant found for supplierId=${supplierId}`)
      return json({ ok: true, skipped: true })
    }

    // Test events — just log, no order processing needed
    const isTestEvent = eventType.includes('test') || eventType === 'unknown' ||
      (!body.order && !body.content && !body.orderNumber)
    if (isTestEvent) {
      console.log(`[trendyol-webhook] test event received for merchant=${merchantCode}`)
      await admin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', insertedEvent.id)
      return json({ ok: true, test: true })
    }

    // Handle real order events
    if (eventType === 'order/created' || eventType === 'order/statusChanged' || eventType.startsWith('order/')) {
      const order = body.order || body.content || body

      const orderId     = String(order.orderNumber || order.id || order.orderId || Date.now())
      const status      = mapStatus(order.status || order.orderStatus || 'pending')
      const totalPrice  = parseFloat(order.grossAmount || order.totalPrice || order.amount || 0)
      const orderDate   = order.orderDate ? new Date(order.orderDate).toISOString() : new Date().toISOString()
      const lines       = order.lines || order.orderItems || []
      const productName = lines[0]?.productName || lines[0]?.name || null
      const qty         = lines.reduce((s: number, l: any) => s + (l.quantity || 1), 0) || 1

      const currency = String(order.currencyCode || order.currency || lines[0]?.currencyCode || 'SAR').toUpperCase()
      const { error: orderError } = await admin.from('orders').upsert({
        merchant_code: merchantCode,
        platform:      'trendyol',
        order_id:      orderId,
        status,
        product_name:  productName,
        quantity:      qty,
        unit_price:    qty > 0 ? totalPrice / qty : totalPrice,
        total_amount:  totalPrice,
        platform_fee:  0,
        shipping_cost: parseFloat(order.cargoFee || 0),
        currency,
        order_date:    orderDate,
      }, { onConflict: 'merchant_code,platform,order_id', ignoreDuplicates: false })
      if (orderError) throw orderError

      const today = orderDate.split('T')[0]
      await rebuildDay(admin, merchantCode, today)
      await admin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', insertedEvent.id)

      console.log(`[trendyol-webhook] ${eventType} order=${orderId} merchant=${merchantCode} amount=${totalPrice}`)
    }

    return json({ ok: true })
  } catch (e: any) {
    console.error('[trendyol-webhook] error:', e.message)
    return json({ ok: false, error: e.message }, 500)
  }
})

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

async function stableEventKey(value: Record<string, unknown>) {
  const input = new TextEncoder().encode(JSON.stringify(value))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function rebuildDay(admin: any, merchantCode: string, date: string) {
  const from = `${date}T00:00:00.000Z`
  const until = new Date(from); until.setUTCDate(until.getUTCDate() + 1)
  const { data, error } = await admin.from('orders')
    .select('total_amount,platform_fee,status').eq('merchant_code', merchantCode).eq('platform', 'trendyol')
    .gte('order_date', from).lt('order_date', until.toISOString())
  if (error) throw error
  const valid = (data || []).filter((row: any) => !['cancelled', 'returned'].includes(row.status))
  const totalSales = valid.reduce((sum: number, row: any) => sum + Number(row.total_amount || 0), 0)
  const platformFees = valid.reduce((sum: number, row: any) => sum + Number(row.platform_fee || 0), 0)
  const { error: performanceError } = await admin.from('performance_data').upsert({
    merchant_code: merchantCode, platform: 'trendyol', data_date: date,
    total_sales: totalSales, order_count: valid.length, platform_fees: platformFees,
    margin: totalSales - platformFees, ad_spend: 0,
  }, { onConflict: 'merchant_code,platform,data_date' })
  if (performanceError) throw performanceError
}

function mapStatus(raw: string): string {
  const r = raw?.toLowerCase()
  if (['delivered','teslim'].some(s => r?.includes(s))) return 'delivered'
  if (['cancel','iptal'].some(s => r?.includes(s)))     return 'cancelled'
  if (['return','iade'].some(s => r?.includes(s)))      return 'returned'
  if (['ship','kargo'].some(s => r?.includes(s)))       return 'shipped'
  return 'pending'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
