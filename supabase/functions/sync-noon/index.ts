import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getNoonToken(serviceAccountJson: any): Promise<string> {
  const { client_email, private_key, token_uri } = serviceAccountJson
  const tokenEndpoint = token_uri || 'https://idp.noon.partners/token'

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: client_email,
    sub: client_email,
    aud: tokenEndpoint,
    iat: now,
    exp: now + 3600,
  }

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const signingInput = `${encode(header)}.${encode(payload)}`

  // Import private key for RS256 signing
  const pemBody = private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '')

  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  const jwt = `${signingInput}.${sigB64}`

  const tokenRes = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!tokenRes.ok) throw new Error(`Noon token error: ${await tokenRes.text()}`)
  const { access_token } = await tokenRes.json()
  return access_token
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
    .eq('platform', 'noon')
    .single()

  if (!creds)
    return new Response(JSON.stringify({ error: 'لا توجد بيانات ربط لـ Noon' }), { status: 400, headers: cors })

  const { data: log } = await supabase
    .from('sync_logs')
    .insert({ merchant_code, platform: 'noon', status: 'running' })
    .select().single()

  try {
    const serviceAccount = creds.extra?.service_account
    if (!serviceAccount) throw new Error('Service account JSON مفقود')

    const token = await getNoonToken(serviceAccount)
    const sellerId = creds.seller_id

    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const ordersRes = await fetch(
      `https://api.noon.partners/v2/orders?from=${startDate}&to=${endDate}&status=delivered&limit=1000`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Seller-ID': sellerId,
        },
      }
    )

    if (!ordersRes.ok) throw new Error(`Noon Orders API ${ordersRes.status}: ${await ordersRes.text()}`)
    const ordersData = await ordersRes.json()
    const orders = ordersData.orders || ordersData.data || []

    const byDay: Record<string, { total_sales: number; order_count: number; platform_fees: number }> = {}

    for (const order of orders) {
      const orderDate = order.created_at || order.orderDate || order.date
      if (!orderDate) continue
      const day = orderDate.split('T')[0]
      if (!byDay[day]) byDay[day] = { total_sales: 0, order_count: 0, platform_fees: 0 }
      const amount = order.total_price || order.totalPrice || order.amount || 0
      byDay[day].total_sales += amount
      byDay[day].order_count += 1
      byDay[day].platform_fees += amount * 0.12 // Noon ~12% commission
    }

    const records = Object.entries(byDay).map(([date, vals]) => ({
      merchant_code,
      created_at: new Date(date + 'T00:00:00Z').toISOString(),
      data_date: date,
      platform: 'noon',
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
      .eq('merchant_code', merchant_code).eq('platform', 'noon')

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
