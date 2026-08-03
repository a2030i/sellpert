/**
 * trendyol-webhook
 * Receives real-time order events from Trendyol.
 * Trendyol sends supplierId in every payload — used to identify the merchant.
 * Every received event (including test events) is logged to webhook_events.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { commissionFromLines, mapTrendyolOrderStatus, numberOrNull, validIso } from '../_shared/trendyolWebhook.ts'
import { PayloadTooLargeError, readBoundedText } from '../_shared/webhookSecurity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_BODY_BYTES = 1_000_000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  let eventLogId = ''

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

    const rawBody = await readBoundedText(req, MAX_BODY_BYTES)
    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    const supplierId = String(body.supplierId || body.supplier_id || '')
    const eventType  = String(body.event || body.eventType || 'unknown')

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
    eventLogId = String(insertedEvent.id)

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

    // Handle real order events immediately, but preserve the canonical values
    // already fetched by the full sync when a status-only webhook omits them.
    if (eventType === 'order/created' || eventType === 'order/statusChanged' || eventType.startsWith('order/')) {
      const order = body.order || body.content || body

      const orderId = String(order.orderNumber || order.orderId || order.id || '')
      if (!orderId) throw new Error('Order event is missing its order number')
      const { data: existing, error: existingError } = await admin.from('orders')
        .select('status,total_amount,platform_fee,shipping_cost,currency,order_date,product_name,quantity,unit_price')
        .eq('merchant_code', merchantCode).eq('platform', 'trendyol').eq('order_id', orderId).maybeSingle()
      if (existingError) throw existingError
      const lines       = order.lines || order.orderItems || []
      const payloadTotal = numberOrNull(order.grossAmount ?? order.totalPrice ?? order.amount)
      const totalPrice = payloadTotal ?? Number(existing?.total_amount || 0)
      const payloadQuantity = lines.length
        ? lines.reduce((sum: number, line: any) => sum + Number(line.quantity || 1), 0)
        : null
      const qty = payloadQuantity ?? Number(existing?.quantity || 1)
      const payloadFee = commissionFromLines(lines)
      const rawStatus = String(order.status || order.orderStatus || '')
      const status = rawStatus ? mapTrendyolOrderStatus(rawStatus, existing?.status || 'pending') : existing?.status || 'pending'
      const orderDate = validIso(order.orderDate || order.createdDate) || existing?.order_date || new Date().toISOString()
      const productName = lines[0]?.productName || lines[0]?.name || existing?.product_name || null

      const currency = String(order.currencyCode || order.currency || lines[0]?.currencyCode || existing?.currency || 'SAR').toUpperCase()
      const { error: orderError } = await admin.from('orders').upsert({
        merchant_code: merchantCode,
        platform:      'trendyol',
        order_id:      orderId,
        status,
        product_name:  productName,
        quantity:      qty,
        unit_price:    lines.length && qty > 0 ? totalPrice / qty : Number(existing?.unit_price || (qty > 0 ? totalPrice / qty : totalPrice)),
        total_amount:  totalPrice,
        platform_fee:  payloadFee ?? Number(existing?.platform_fee || 0),
        shipping_cost: numberOrNull(order.cargoFee) ?? Number(existing?.shipping_cost || 0),
        currency,
        order_date:    orderDate,
        raw:            body,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'merchant_code,platform,order_id', ignoreDuplicates: false })
      if (orderError) throw orderError

      console.log(`[trendyol-webhook] ${eventType} order=${orderId} merchant=${merchantCode} amount=${totalPrice}`)
    }

    // The canonical sync enriches lines, packages, claims, products and finance.
    // Dedupe bursts so a batch of status events schedules one high-priority job.
    await enqueueCanonicalSync(admin, merchantCode, eventType)
    const { error: rebuildError } = await admin.rpc('rebuild_performance_data', {
      p_merchant_code: merchantCode,
    })
    if (rebuildError) throw rebuildError
    await admin.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', insertedEvent.id)

    return json({ ok: true })
  } catch (e: any) {
    if (e instanceof PayloadTooLargeError) return json({ error: 'Payload too large' }, 413)
    console.error('[trendyol-webhook] error:', e.message)
    if (eventLogId) {
      await admin.from('webhook_events').update({
        status: 'failed', error: String(e?.message || e).slice(0, 2000), processed_at: new Date().toISOString(),
      }).eq('id', eventLogId)
    }
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

async function enqueueCanonicalSync(admin: any, merchantCode: string, eventType: string) {
  const cutoff = new Date(Date.now() - 120_000).toISOString()
  const { count, error: lookupError } = await admin.from('sync_queue')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_code', merchantCode).eq('platform', 'trendyol')
    .in('status', ['pending', 'running']).gte('created_at', cutoff)
  if (lookupError) throw lookupError
  if ((count || 0) > 0) return
  const { error } = await admin.from('sync_queue').insert({
    merchant_code: merchantCode,
    platform: 'trendyol',
    job_type: 'sync_all',
    payload: { trigger: 'webhook', event_type: eventType },
    priority: 1,
    status: 'pending',
    scheduled_at: new Date().toISOString(),
  })
  if (error) throw error
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
