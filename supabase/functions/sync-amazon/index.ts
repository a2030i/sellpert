import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
const SP_API_BASE = 'https://sellingpartnerapi-eu.amazon.com'
const SAUDI_MARKETPLACE_ID = 'A17E79C6D8DWNP'

async function getLWAToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) throw new Error(`Amazon LWA token error: ${await res.text()}`)
  const { access_token } = await res.json()
  return access_token
}

async function fetchOrders(token: string, createdAfter: string): Promise<any[]> {
  const url = `${SP_API_BASE}/orders/v0/orders?MarketplaceIds=${SAUDI_MARKETPLACE_ID}` +
    `&CreatedAfter=${encodeURIComponent(createdAfter)}` +
    `&OrderStatuses=Shipped,Delivered,Unshipped,PartiallyShipped`

  const res = await fetch(url, {
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) throw new Error(`Amazon Orders API ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.payload?.Orders || []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { merchant_code } = await req.json()
  if (!merchant_code) return new Response(JSON.stringify({ error: 'merchant_code required' }), { status: 400, headers: cors })

  const { data: creds } = await supabase
    .from('platform_credentials')
    .select('*')
    .eq('merchant_code', merchant_code)
    .eq('platform', 'amazon')
    .single()

  if (!creds)
    return new Response(JSON.stringify({ error: 'لا توجد بيانات ربط لـ Amazon' }), { status: 400, headers: cors })

  const { data: log } = await supabase
    .from('sync_logs')
    .insert({ merchant_code, platform: 'amazon', status: 'running' })
    .select().single()

  try {
    const { api_key: clientId, api_secret: clientSecret, extra } = creds
    const refreshToken = extra?.refresh_token
    if (!clientId || !clientSecret || !refreshToken)
      throw new Error('بيانات Amazon ناقصة: Client ID، Client Secret، أو Refresh Token')

    const token = await getLWAToken(clientId, clientSecret, refreshToken)

    const createdAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const orders = await fetchOrders(token, createdAfter)

    // Fetch order items for each order to get amounts (Amazon orders don't include total in list)
    const byDay: Record<string, { total_sales: number; order_count: number; platform_fees: number }> = {}

    for (const order of orders) {
      const day = order.PurchaseDate?.split('T')[0]
      if (!day) continue
      if (!byDay[day]) byDay[day] = { total_sales: 0, order_count: 0, platform_fees: 0 }

      const amount = parseFloat(order.OrderTotal?.Amount || '0')
      byDay[day].total_sales += amount
      byDay[day].order_count += 1
      byDay[day].platform_fees += amount * 0.15 // Amazon ~15% referral fee
    }

    const records = Object.entries(byDay).map(([date, vals]) => ({
      merchant_code,
      created_at: new Date(date + 'T00:00:00Z').toISOString(),
      data_date: date,
      platform: 'amazon',
      total_sales: Math.round(vals.total_sales * 100) / 100,
      order_count: vals.order_count,
      platform_fees: Math.round(vals.platform_fees * 100) / 100,
      margin: 0,
      ad_spend: 0,
    }))

    if (records.length > 0) {
      await supabase.from('performance_data').upsert(records, {
        onConflict: 'merchant_code,platform,data_date',
        ignoreDuplicates: false,
      })
    }

    await supabase.from('platform_credentials')
      .update({ last_sync_at: new Date().toISOString(), records_synced: orders.length, is_active: true, updated_at: new Date().toISOString() })
      .eq('merchant_code', merchant_code).eq('platform', 'amazon')

    await supabase.from('sync_logs')
      .update({ status: 'success', records_synced: records.length, finished_at: new Date().toISOString() })
      .eq('id', log.id)

    return new Response(JSON.stringify({ success: true, days_synced: records.length, orders: orders.length }), { headers: cors })

  } catch (err: any) {
    await supabase.from('sync_logs')
      .update({ status: 'error', error_message: err.message, finished_at: new Date().toISOString() })
      .eq('id', log.id)

    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors })
  }
})
