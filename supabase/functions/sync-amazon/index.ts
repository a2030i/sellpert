import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!
const MARKETPLACE   = 'A17E79C6D8DWNP' // Saudi Arabia

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
    let clientId = '', clientSecret = '', refreshToken = '', sellerId = ''

    if (mapping_id) {
      const { data: mapping } = await db
        .from('merchant_platform_mappings')
        .select('seller_id, platform_connections(api_key, api_secret, extra)')
        .eq('id', mapping_id).single()
      if (!mapping) return json({ error: 'mapping not found' }, 404)
      sellerId      = (mapping as any).seller_id
      const conn    = (mapping as any).platform_connections
      clientId      = conn?.api_key    || ''
      clientSecret  = conn?.api_secret || ''
      refreshToken  = conn?.extra?.refresh_token || ''
    } else {
      const { data: cred } = await db.from('platform_credentials').select('*').eq('merchant_code', merchant_code).eq('platform', 'amazon').single()
      if (!cred) return json({ error: 'لا توجد بيانات ربط لأمازون' }, 400)
      clientId     = cred.api_key    || ''
      clientSecret = cred.api_secret || ''
      refreshToken = cred.extra?.refresh_token || ''
      sellerId     = cred.seller_id  || ''
    }

    if (!clientId || !clientSecret || !refreshToken) return json({ error: 'بيانات Amazon SP-API غير مكتملة' }, 400)

    // ── Start sync log ───────────────────────────────────────────────────────
    const { data: log } = await db.from('sync_logs').insert({ merchant_code, platform: 'amazon', status: 'running', records_synced: 0 }).select().single()
    logId = log?.id || ''

    // ── Get LWA token ────────────────────────────────────────────────────────
    const lwaRes = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    })
    const lwaData = await lwaRes.json()
    if (!lwaData.access_token) throw new Error('Amazon LWA error: ' + JSON.stringify(lwaData))
    const accessToken = lwaData.access_token

    const spHeaders = { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' }
    const since     = new Date(Date.now() - 90 * 86400000).toISOString()
    let nextToken   = ''
    let totalDays   = 0
    const dailyMap: Record<string, { sales: number; orders: number; fees: number }> = {}
    const orderRows: any[] = []

    // ── Fetch orders ─────────────────────────────────────────────────────────
    while (true) {
      let url = `https://sellingpartnerapi-eu.amazon.com/orders/v0/orders?MarketplaceIds=${MARKETPLACE}&CreatedAfter=${since}&MaxResultsPerPage=100`
      if (nextToken) url += `&NextToken=${encodeURIComponent(nextToken)}`
      const res = await fetch(url, { headers: spHeaders })
      if (!res.ok) { const t = await res.text(); throw new Error(`Amazon API ${res.status}: ${t}`) }
      const data = await res.json()
      const orders: any[] = data?.payload?.Orders || []

      for (const order of orders) {
        if (order.OrderStatus === 'Canceled') continue
        const date    = new Date(order.PurchaseDate)
        const dateStr = date.toISOString().split('T')[0]
        const amount  = parseFloat(order.OrderTotal?.Amount || '0')
        const fee     = amount * 0.15

        if (!dailyMap[dateStr]) dailyMap[dateStr] = { sales: 0, orders: 0, fees: 0 }
        dailyMap[dateStr].sales  += amount
        dailyMap[dateStr].orders += 1
        dailyMap[dateStr].fees   += fee

        orderRows.push({
          merchant_code, platform: 'amazon',
          order_id:     order.AmazonOrderId,
          status:       mapAmazonStatus(order.OrderStatus),
          quantity:     order.NumberOfItemsShipped || 1,
          unit_price:   amount,
          total_amount: amount,
          platform_fee: fee,
          currency:     order.OrderTotal?.CurrencyCode || 'SAR',
          customer_city: order.ShippingAddress?.City,
          order_date:   date.toISOString(),
        })
      }

      nextToken = data?.payload?.NextToken || ''
      if (!nextToken) break
    }

    for (const [dateStr, v] of Object.entries(dailyMap)) {
      await db.from('performance_data').upsert({
        merchant_code, platform: 'amazon', data_date: dateStr,
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
      body: JSON.stringify({ merchant_code, event: 'sync_complete', data: { platform: 'amazon', orders: orderRows.length, records: totalDays } }),
    }).catch(() => {})

    return json({ ok: true, records_synced: totalDays, orders: orderRows.length })

  } catch (e: any) {
    if (logId) await db.from('sync_logs').update({ status: 'error', error_message: e.message, finished_at: new Date().toISOString() }).eq('id', logId)
    return json({ error: e.message }, 500)
  }
})

function mapAmazonStatus(s: string) {
  return ({ Pending: 'pending', Unshipped: 'processing', PartiallyShipped: 'processing', Shipped: 'shipped', Delivered: 'delivered', Canceled: 'cancelled' } as Record<string, string>)[s] || 'pending'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
