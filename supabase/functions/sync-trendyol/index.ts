import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = createClient(SUPABASE_URL, SERVICE_KEY)
  let logId = ''

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Unauthorized' }, 401)
    const { data: { user } } = await db.auth.getUser(token)
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: caller } = await db.from('merchants').select('role').eq('email', user.email!).single()
    if (!caller || !['admin', 'super_admin'].includes(caller.role)) return json({ error: 'Forbidden' }, 403)

    const body = await req.json()
    const { merchant_code, mapping_id } = body
    if (!merchant_code) return json({ error: 'merchant_code مطلوب' }, 400)

    // ── Resolve credentials ──────────────────────────────────────────────────
    let apiKey = '', apiSecret = '', sellerId = ''

    if (mapping_id) {
      const { data: mapping } = await db
        .from('merchant_platform_mappings')
        .select('seller_id, platform_connections(api_key, api_secret)')
        .eq('id', mapping_id).single()
      if (!mapping) return json({ error: 'mapping not found' }, 404)
      sellerId  = (mapping as any).seller_id
      const conn = (mapping as any).platform_connections
      apiKey    = conn?.api_key    || ''
      apiSecret = conn?.api_secret || ''
    } else {
      const { data: cred } = await db.from('platform_credentials').select('*')
        .eq('merchant_code', merchant_code).eq('platform', 'trendyol').single()
      if (!cred) return json({ error: 'لا توجد بيانات ربط لتراندايول' }, 400)
      apiKey = cred.api_key || ''; apiSecret = cred.api_secret || ''; sellerId = cred.seller_id || ''
    }

    if (!apiKey || !apiSecret || !sellerId) return json({ error: 'بيانات API غير مكتملة (apiKey / apiSecret / sellerId)' }, 400)

    // ── Start sync log ───────────────────────────────────────────────────────
    const { data: log } = await db.from('sync_logs').insert({ merchant_code, platform: 'trendyol', status: 'running', records_synced: 0 }).select().single()
    logId = log?.id || ''

    // ── Fetch from Trendyol ──────────────────────────────────────────────────
    const headers = {
      Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
      'User-Agent':  `${sellerId} - SellpertIntegration`,
      'Content-Type': 'application/json',
    }
    const endDate   = Date.now()
    const startDate = endDate - 90 * 86400000
    let page = 0, totalDays = 0
    const dailyMap: Record<string, { sales: number; orders: number; fees: number }> = {}
    const orderRows: any[] = []

    while (true) {
      const url = `https://apigw.trendyol.com/sapigw/suppliers/${sellerId}/orders?startDate=${startDate}&endDate=${endDate}&orderByField=CreatedDate&orderByDirection=DESC&page=${page}&size=200`
      const res = await fetch(url, { headers })
      if (!res.ok) { const t = await res.text(); throw new Error(`Trendyol API ${res.status}: ${t}`) }
      const data = await res.json()
      const content: any[] = data.content || []
      if (content.length === 0) break

      for (const order of content) {
        if (order.status === 'Cancelled') continue
        const date    = new Date(order.orderDate)
        const dateStr = date.toISOString().split('T')[0]
        const amount  = order.totalPrice || 0
        const fee     = amount * 0.15

        if (!dailyMap[dateStr]) dailyMap[dateStr] = { sales: 0, orders: 0, fees: 0 }
        dailyMap[dateStr].sales  += amount
        dailyMap[dateStr].orders += 1
        dailyMap[dateStr].fees   += fee

        for (const line of (order.lines || [])) {
          orderRows.push({
            merchant_code, platform: 'trendyol',
            order_id:     String(order.orderNumber),
            status:       mapTrendyolStatus(order.status),
            product_name: line.productName,
            sku:          line.merchantSku || line.barcode,
            quantity:     line.quantity || 1,
            unit_price:   line.price || 0,
            total_amount: (line.price || 0) * (line.quantity || 1),
            platform_fee: (line.price || 0) * (line.quantity || 1) * 0.15,
            currency:     'TRY',
            order_date:   date.toISOString(),
          })
        }
      }
      if (!data.totalElements || (page + 1) * 200 >= data.totalElements) break
      page++
    }

    // ── Upsert to DB ─────────────────────────────────────────────────────────
    for (const [dateStr, v] of Object.entries(dailyMap)) {
      await db.from('performance_data').upsert({
        merchant_code, platform: 'trendyol', data_date: dateStr,
        total_sales: Math.round(v.sales), order_count: v.orders,
        platform_fees: Math.round(v.fees), margin: 0, ad_spend: 0,
      }, { onConflict: 'merchant_code,platform,data_date' })
      totalDays++
    }
    for (let i = 0; i < orderRows.length; i += 100) {
      await db.from('orders').upsert(orderRows.slice(i, i + 100), { onConflict: 'merchant_code,platform,order_id', ignoreDuplicates: true })
    }

    const now = new Date().toISOString()
    await db.from('sync_logs').update({ status: 'success', records_synced: totalDays, finished_at: now }).eq('id', logId)
    if (mapping_id) {
      await db.from('merchant_platform_mappings').update({ last_sync_at: now, last_sync_status: 'success', records_synced: orderRows.length, last_sync_error: null }).eq('id', mapping_id)
    }

    // Non-blocking WhatsApp notification
    fetch(`${SUPABASE_URL}/functions/v1/notify-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ merchant_code, event: 'sync_complete', data: { platform: 'trendyol', orders: orderRows.length, records: totalDays } }),
    }).catch(() => {})

    return json({ ok: true, records_synced: totalDays, orders: orderRows.length })

  } catch (e: any) {
    if (logId) await db.from('sync_logs').update({ status: 'error', error_message: e.message, finished_at: new Date().toISOString() }).eq('id', logId)
    return json({ error: e.message }, 500)
  }
})

function mapTrendyolStatus(s: string) {
  return ({ Created: 'pending', Picking: 'processing', Invoiced: 'processing', Shipped: 'shipped', Delivered: 'delivered', Cancelled: 'cancelled', UnDelivered: 'returned' } as Record<string, string>)[s] || 'pending'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
