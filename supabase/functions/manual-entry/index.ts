import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json('ok', 200)

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user } } = await callerClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { data: caller } = await callerClient
      .from('merchants').select('role').eq('email', user.email!).single()

    const allowed = ['admin', 'super_admin', 'employee']
    if (!caller || !allowed.includes(caller.role))
      return json({ error: 'Forbidden' }, 403)

    const db   = createClient(SUPABASE_URL, SERVICE_KEY)
    const body = await req.json()
    const { action, rows, merchant_code, platform, data_date,
            total_sales, order_count,
            platform_fees = 0, ad_spend = 0, margin = 0 } = body

    // ── Get merchants list (for employee / admin entry form) ─────────────────
    if (action === 'get_merchants') {
      const { data } = await db
        .from('merchants').select('merchant_code, name')
        .eq('role', 'merchant').order('name')
      return json({ ok: true, merchants: data || [] })
    }

    // ── Bulk mode ─────────────────────────────────────────────────────────────
    if (Array.isArray(rows) && rows.length > 0) {
      const validated = rows.map((r: any) => ({
        merchant_code: r.merchant_code,
        platform:      r.platform,
        data_date:     r.data_date,
        total_sales:   Number(r.total_sales)   || 0,
        order_count:   Number(r.order_count)   || 0,
        platform_fees: Number(r.platform_fees) || 0,
        ad_spend:      Number(r.ad_spend)      || 0,
        margin:        Number(r.margin)        || 0,
      }))

      const { error } = await db.from('performance_data')
        .upsert(validated, { onConflict: 'merchant_code,platform,data_date' })
      if (error) return json({ error: error.message }, 500)

      const combos = [...new Map(
        validated.map((r: any) => [`${r.merchant_code}|${r.platform}`, r])
      ).values()]
      for (const r of combos as any[]) {
        const now = new Date().toISOString()
        await db.from('sync_logs').insert({
          merchant_code: r.merchant_code, platform: r.platform,
          status: 'success',
          records_synced: validated.filter((v: any) =>
            v.merchant_code === r.merchant_code && v.platform === r.platform).length,
          started_at: now, finished_at: now, error_message: null,
        })
      }
      return json({ ok: true, inserted: validated.length })
    }

    // ── Single row mode ───────────────────────────────────────────────────────
    if (!merchant_code || !platform || !data_date)
      return json({ error: 'merchant_code و platform و data_date مطلوبة' }, 400)

    const { data: merchant } = await db.from('merchants')
      .select('merchant_code, name').eq('merchant_code', merchant_code).single()
    if (!merchant) return json({ error: 'التاجر غير موجود' }, 404)

    const { error } = await db.from('performance_data').upsert({
      merchant_code, platform, data_date,
      total_sales:   Number(total_sales)   || 0,
      order_count:   Number(order_count)   || 0,
      platform_fees: Number(platform_fees) || 0,
      ad_spend:      Number(ad_spend)      || 0,
      margin:        Number(margin)        || 0,
    }, { onConflict: 'merchant_code,platform,data_date' })
    if (error) return json({ error: error.message }, 500)

    const now = new Date().toISOString()
    await db.from('sync_logs').insert({
      merchant_code, platform, status: 'success',
      records_synced: 1, started_at: now, finished_at: now, error_message: null,
    })

    return json({ ok: true, merchant_name: merchant.name, merchant_code, platform, data_date })

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
