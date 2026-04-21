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
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user } } = await callerClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: caller } = await callerClient.from('merchants').select('role').eq('email', user.email!).single()
    if (!caller || !['admin', 'super_admin'].includes(caller.role)) return json({ error: 'Forbidden' }, 403)

    const body = await req.json()
    const { merchant_code, mapping_id } = body
    if (!merchant_code) return json({ error: 'merchant_code مطلوب' }, 400)

    // ── Resolve credentials ──────────────────────────────────────────────────
    let serviceAccount: Record<string, any> | null = null
    let sellerId = ''

    if (mapping_id) {
      const { data: mapping } = await db
        .from('merchant_platform_mappings')
        .select('seller_id, platform_connections(extra)')
        .eq('id', mapping_id).single()
      if (!mapping) return json({ error: 'mapping not found' }, 404)
      sellerId      = (mapping as any).seller_id
      serviceAccount = (mapping as any).platform_connections?.extra?.service_account || null
    } else {
      const { data: cred } = await db.from('platform_credentials').select('*').eq('merchant_code', merchant_code).eq('platform', 'noon').single()
      if (!cred) return json({ error: 'لا توجد بيانات ربط لنون' }, 400)
      serviceAccount = cred.extra?.service_account || null
      sellerId       = cred.seller_id || cred.extra?.seller_id || ''
    }

    if (!serviceAccount) return json({ error: 'Service Account JSON غير موجود' }, 400)

    // ── Start sync log ───────────────────────────────────────────────────────
    const { data: log } = await db.from('sync_logs').insert({ merchant_code, platform: 'noon', status: 'running', records_synced: 0 }).select().single()
    logId = log?.id || ''

    // ── Get Noon access token ────────────────────────────────────────────────
    const noonToken = await getNoonToken(serviceAccount)

    const headers = { Authorization: `Bearer ${noonToken}`, 'Content-Type': 'application/json' }
    const since    = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]

    let page = 1, totalDays = 0
    const dailyMap: Record<string, { sales: number; orders: number; fees: number }> = {}
    const orderRows: any[] = []

    while (true) {
      const url = `https://api.noon.partners/seller/v1/order?page=${page}&limit=100&from=${since}`
      const res = await fetch(url, { headers })
      if (!res.ok) { const t = await res.text(); throw new Error(`Noon API ${res.status}: ${t}`) }
      const data = await res.json()
      const items: any[] = data?.value?.orders || data?.orders || []
      if (items.length === 0) break

      for (const order of items) {
        if (order.status === 'CANCELLED') continue
        const date    = new Date(order.created_at || order.date)
        const dateStr = date.toISOString().split('T')[0]
        const amount  = parseFloat(order.grand_total || order.total || 0)
        const fee     = amount * 0.12

        if (!dailyMap[dateStr]) dailyMap[dateStr] = { sales: 0, orders: 0, fees: 0 }
        dailyMap[dateStr].sales  += amount
        dailyMap[dateStr].orders += 1
        dailyMap[dateStr].fees   += fee

        orderRows.push({
          merchant_code, platform: 'noon',
          order_id:     String(order.nr || order.id || order.order_id),
          status:       mapNoonStatus(order.status),
          product_name: order.items?.[0]?.name || order.item_name,
          quantity:     order.items?.reduce((s: number, i: any) => s + (i.quantity || 1), 0) || 1,
          unit_price:   amount,
          total_amount: amount,
          platform_fee: fee,
          currency:     order.currency || 'AED',
          customer_city: order.delivery_address?.city,
          order_date:   date.toISOString(),
        })
      }

      if (items.length < 100) break
      page++
    }

    for (const [dateStr, v] of Object.entries(dailyMap)) {
      await db.from('performance_data').upsert({
        merchant_code, platform: 'noon', data_date: dateStr,
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
      body: JSON.stringify({ merchant_code, event: 'sync_complete', data: { platform: 'noon', orders: orderRows.length, records: totalDays } }),
    }).catch(() => {})

    return json({ ok: true, records_synced: totalDays, orders: orderRows.length })

  } catch (e: any) {
    if (logId) await db.from('sync_logs').update({ status: 'error', error_message: e.message, finished_at: new Date().toISOString() }).eq('id', logId)
    return json({ error: e.message }, 500)
  }
})

async function getNoonToken(sa: Record<string, any>): Promise<string> {
  const now   = Math.floor(Date.now() / 1000)
  const claim = { iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri || 'https://idp.noon.partners/token', iat: now, exp: now + 3600 }
  const header = { alg: 'RS256', typ: 'JWT' }
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const msg  = `${b64(header)}.${b64(claim)}`
  const key  = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const keyBuf = Uint8Array.from(atob(key), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBuf, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(msg))
  const jwt = `${msg}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`
  const res = await fetch(sa.token_uri || 'https://idp.noon.partners/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const d = await res.json()
  if (!d.access_token) throw new Error('Noon token error: ' + JSON.stringify(d))
  return d.access_token
}

function mapNoonStatus(s: string) {
  return ({ CREATED: 'pending', CONFIRMED: 'processing', SHIPPED: 'shipped', DELIVERED: 'delivered', CANCELLED: 'cancelled', RETURNED: 'returned' } as Record<string, string>)[s] || 'pending'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
