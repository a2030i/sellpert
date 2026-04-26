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
    const body = await req.json()

    const supplierId = String(body.supplierId || body.supplier_id || '')
    const eventType  = body.event || body.eventType || 'unknown'

    if (!supplierId) return json({ error: 'supplierId missing' }, 400)

    // Find the merchant who owns this supplierId
    const { data: cred } = await admin
      .from('platform_credentials')
      .select('merchant_code')
      .eq('platform', 'trendyol')
      .eq('seller_id', supplierId)
      .eq('is_active', true)
      .maybeSingle()

    // Log every event to webhook_events (even if merchant not found)
    await admin.from('webhook_events').insert({
      source:        'trendyol',
      event_type:    eventType,
      store_id:      supplierId,
      merchant_code: cred?.merchant_code || null,
      payload:       body,
      status:        cred ? 'processed' : 'unmatched',
      received_at:   new Date().toISOString(),
    })

    if (!cred) {
      console.warn(`[trendyol-webhook] No merchant found for supplierId=${supplierId}`)
      return json({ ok: true, skipped: true })
    }

    const merchantCode = cred.merchant_code

    // Test events — just log, no order processing needed
    const isTestEvent = eventType.includes('test') || eventType === 'unknown' ||
      (!body.order && !body.content && !body.orderNumber)
    if (isTestEvent) {
      console.log(`[trendyol-webhook] test event received for merchant=${merchantCode}`)
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

      await admin.from('orders').upsert({
        merchant_code: merchantCode,
        platform:      'trendyol',
        order_id:      orderId,
        status,
        product_name:  productName,
        quantity:      qty,
        unit_price:    qty > 0 ? Math.round(totalPrice / qty) : totalPrice,
        total_amount:  totalPrice,
        platform_fee:  0,
        shipping_cost: parseFloat(order.cargoFee || 0),
        currency:      'TRY',
        order_date:    orderDate,
      }, { onConflict: 'merchant_code,platform,order_id', ignoreDuplicates: false })

      const today = orderDate.split('T')[0]
      const { data: existing } = await admin
        .from('performance_data')
        .select('total_sales, order_count')
        .eq('merchant_code', merchantCode)
        .eq('platform', 'trendyol')
        .eq('data_date', today)
        .maybeSingle()

      if (existing) {
        await admin.from('performance_data').update({
          total_sales: existing.total_sales + totalPrice,
          order_count: existing.order_count + (eventType === 'order/created' ? 1 : 0),
        }).eq('merchant_code', merchantCode).eq('platform', 'trendyol').eq('data_date', today)
      } else {
        await admin.from('performance_data').insert({
          merchant_code: merchantCode,
          platform:      'trendyol',
          data_date:     today,
          total_sales:   totalPrice,
          order_count:   1,
          margin: 0, ad_spend: 0, platform_fees: 0,
        })
      }

      console.log(`[trendyol-webhook] ${eventType} order=${orderId} merchant=${merchantCode} amount=${totalPrice}`)
    }

    return json({ ok: true })
  } catch (e: any) {
    console.error('[trendyol-webhook] error:', e.message)
    return json({ ok: false, error: e.message }, 500)
  }
})

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
