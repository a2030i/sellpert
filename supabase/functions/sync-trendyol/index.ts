import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { merchant_code } = await req.json()
  if (!merchant_code) return new Response(JSON.stringify({ error: 'merchant_code required' }), { status: 400, headers: cors })

  const { data: creds, error: credErr } = await supabase
    .from('platform_credentials')
    .select('*')
    .eq('merchant_code', merchant_code)
    .eq('platform', 'trendyol')
    .single()

  if (credErr || !creds)
    return new Response(JSON.stringify({ error: 'لا توجد بيانات ربط لـ Trendyol' }), { status: 400, headers: cors })

  const { data: log } = await supabase
    .from('sync_logs')
    .insert({ merchant_code, platform: 'trendyol', status: 'running' })
    .select().single()

  try {
    const { seller_id, api_key, api_secret } = creds
    const authHeader = 'Basic ' + btoa(`${api_key}:${api_secret}`)
    const endDate = Date.now()
    const startDate = endDate - 30 * 24 * 60 * 60 * 1000

    let allOrders: any[] = []
    let page = 0
    const pageSize = 200

    while (true) {
      const url = `https://apigw.trendyol.com/integration/order/sellers/${seller_id}/orders` +
        `?startDate=${startDate}&endDate=${endDate}&size=${pageSize}&page=${page}`

      const res = await fetch(url, {
        headers: {
          Authorization: authHeader,
          'User-Agent': `${seller_id} - SellpertIntegration`,
          'Content-Type': 'application/json',
        },
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`Trendyol API ${res.status}: ${errText}`)
      }

      const json = await res.json()
      const orders = json.content || []
      allOrders = allOrders.concat(orders)

      if (orders.length < pageSize || page >= (json.totalPages || 1) - 1) break
      page++
    }

    // Aggregate by day (skip cancelled)
    const byDay: Record<string, { total_sales: number; order_count: number; platform_fees: number }> = {}

    for (const order of allOrders) {
      if (order.status === 'Cancelled') continue
      const day = new Date(order.orderDate).toISOString().split('T')[0]
      if (!byDay[day]) byDay[day] = { total_sales: 0, order_count: 0, platform_fees: 0 }
      const amount = order.totalPrice || 0
      byDay[day].total_sales += amount
      byDay[day].order_count += 1
      byDay[day].platform_fees += amount * 0.15 // Trendyol ~15% commission
    }

    const records = Object.entries(byDay).map(([date, vals]) => ({
      merchant_code,
      created_at: new Date(date + 'T00:00:00Z').toISOString(),
      data_date: date,
      platform: 'trendyol',
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
      .update({ last_sync_at: new Date().toISOString(), records_synced: allOrders.length, is_active: true, updated_at: new Date().toISOString() })
      .eq('merchant_code', merchant_code).eq('platform', 'trendyol')

    await supabase.from('sync_logs')
      .update({ status: 'success', records_synced: records.length, finished_at: new Date().toISOString() })
      .eq('id', log.id)

    return new Response(JSON.stringify({ success: true, days_synced: records.length, orders: allOrders.length }), { headers: cors })

  } catch (err: any) {
    await supabase.from('sync_logs')
      .update({ status: 'error', error_message: err.message, finished_at: new Date().toISOString() })
      .eq('id', log.id)

    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors })
  }
})
