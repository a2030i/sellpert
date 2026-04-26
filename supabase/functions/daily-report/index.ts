import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    // Get all active merchants with WhatsApp numbers
    const { data: merchants } = await db
      .from('merchants')
      .select('merchant_code, name, whatsapp_phone, currency')
      .eq('role', 'merchant')
      .not('whatsapp_phone', 'is', null)

    if (!merchants || merchants.length === 0) return json({ ok: true, sent: 0 })

    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0]

    let sent = 0

    for (const merchant of merchants) {
      try {
        // Get yesterday's performance data
        const { data: perf } = await db
          .from('performance_data')
          .select('total_sales, order_count, platform')
          .eq('merchant_code', merchant.merchant_code)
          .eq('data_date', yesterdayStr)

        if (!perf || perf.length === 0) continue

        const totalSales  = perf.reduce((s: number, r: any) => s + (r.total_sales || 0), 0)
        const totalOrders = perf.reduce((s: number, r: any) => s + (r.order_count || 0), 0)

        await fetch(`${SUPABASE_URL}/functions/v1/notify-whatsapp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            merchant_code: merchant.merchant_code,
            event: 'daily_report',
            data: {
              sales: Math.round(totalSales),
              orders: totalOrders,
              currency: merchant.currency || 'ر.س',
              date: yesterdayStr,
            },
          }),
        })
        sent++
      } catch { /* skip failed merchants */ }
    }

    return json({ ok: true, sent, merchants: merchants.length })

  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
