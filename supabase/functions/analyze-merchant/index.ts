import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY') || ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    // Identify caller
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user } } = await callerClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { data: callerRecord } = await callerClient
      .from('merchants').select('*').eq('email', user.email!).single()
    if (!callerRecord) return json({ error: 'merchant not found' }, 404)

    // Admins can analyze any merchant by passing target_merchant_code
    let merchantCode = callerRecord.merchant_code
    let merchant = callerRecord
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY)

    if (['admin', 'super_admin'].includes(callerRecord.role)) {
      let body: any = {}
      try { body = await req.clone().json() } catch { /* no body */ }
      if (body?.target_merchant_code) {
        const { data: targetMerchant } = await adminClient
          .from('merchants').select('*').eq('merchant_code', body.target_merchant_code).single()
        if (targetMerchant) { merchant = targetMerchant; merchantCode = targetMerchant.merchant_code }
      }
    }

    // Check cache — if insights generated in last 6 hours, return cached
    const { data: cached } = await adminClient
      .from('ai_insights')
      .select('*')
      .eq('merchant_code', merchantCode)
      .eq('insight_type', 'full')
      .gte('created_at', new Date(Date.now() - 6 * 3600000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (cached) return json({ ok: true, insight: cached, cached: true })

    // Gather last 90 days of data
    const since = new Date(Date.now() - 90 * 86400000).toISOString()

    const [ordersRes, perfRes, inventoryRes] = await Promise.all([
      adminClient.from('orders').select('*').eq('merchant_code', merchantCode).gte('order_date', since),
      adminClient.from('performance_data').select('*').eq('merchant_code', merchantCode).gte('created_at', since),
      adminClient.from('inventory').select('*').eq('merchant_code', merchantCode).eq('is_active', true),
    ])

    const orders    = ordersRes.data    || []
    const perf      = perfRes.data      || []
    const inventory = inventoryRes.data || []

    // Build compact summary for AI
    const totalRevenue = orders.reduce((s: number, o: any) => s + (o.total_amount || 0), 0)
    const byPlatform: Record<string, { revenue: number; count: number }> = {}
    for (const o of orders) {
      if (!byPlatform[o.platform]) byPlatform[o.platform] = { revenue: 0, count: 0 }
      byPlatform[o.platform].revenue += o.total_amount || 0
      byPlatform[o.platform].count++
    }
    const byDay: Record<string, number> = {}
    for (const o of orders) {
      const d = new Date(o.order_date)
      const day = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][d.getDay()]
      byDay[day] = (byDay[day] || 0) + (o.total_amount || 0)
    }
    const byMonth: Record<string, number> = {}
    for (const o of orders) {
      const m = new Date(o.order_date).toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' })
      byMonth[m] = (byMonth[m] || 0) + (o.total_amount || 0)
    }
    const lowStock = inventory.filter((i: any) => i.quantity <= i.low_stock_threshold).map((i: any) => i.product_name)
    const outOfStock = inventory.filter((i: any) => i.quantity === 0).map((i: any) => i.product_name)
    const topProducts = Object.entries(
      orders.reduce((acc: Record<string, number>, o: any) => {
        if (o.product_name) acc[o.product_name] = (acc[o.product_name] || 0) + (o.total_amount || 0)
        return acc
      }, {})
    ).sort(([,a],[,b]) => b - a).slice(0, 5)

    const dataSummary = {
      period: 'آخر 90 يوم',
      total_orders: orders.length,
      total_revenue: Math.round(totalRevenue),
      currency: merchant.currency || 'SAR',
      revenue_by_platform: Object.entries(byPlatform).map(([p,v]) => ({
        platform: p, revenue: Math.round(v.revenue), orders: v.count
      })),
      revenue_by_day_of_week: Object.entries(byDay).map(([day,rev]) => ({ day, revenue: Math.round(rev) })),
      revenue_by_month: Object.entries(byMonth).map(([month,rev]) => ({ month, revenue: Math.round(rev) })),
      top_products: topProducts.map(([name,rev]) => ({ name, revenue: Math.round(rev as number) })),
      low_stock_products: lowStock.slice(0, 10),
      out_of_stock_products: outOfStock.slice(0, 10),
      total_sku_count: inventory.length,
    }

    if (!OPENROUTER_KEY) {
      return json({ error: 'OPENROUTER_API_KEY غير مضبوط في متغيرات البيئة' }, 500)
    }

    const prompt = `أنت محلل بيانات تجارة إلكترونية خبير في السوق السعودي والخليجي.

بيانات التاجر (${merchant.name}) للـ 90 يوم الماضية:
${JSON.stringify(dataSummary, null, 2)}

حلل هذه البيانات وأعد JSON بالشكل التالي بالضبط (بدون أي نص خارج الـ JSON):
{
  "summary": "ملخص نصي موجز بـ 2-3 جمل عن أداء التاجر",
  "best_days": ["يوم1", "يوم2"],
  "best_platforms": [{"platform": "trendyol|noon|amazon", "reason": "سبب واضح"}],
  "seasonal_insights": ["ملاحظة موسمية 1", "ملاحظة 2"],
  "forecast_next_week": {"amount": 0, "confidence": "عالية|متوسطة|منخفضة", "reasoning": "سبب التوقع"},
  "top_products": [{"name": "اسم المنتج", "revenue": 0, "trend": "up|down|stable"}],
  "recommendations": ["توصية عملية 1", "توصية 2", "توصية 3"],
  "low_stock_alert": ["منتج1", "منتج2"]
}`

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sellpert.com',
        'X-Title': 'Sellpert AI Analysis',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    })

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      return json({ error: 'OpenRouter error: ' + errText }, 500)
    }

    const aiJson = await aiRes.json()
    const rawContent = aiJson.choices?.[0]?.message?.content || '{}'
    let content: Record<string, unknown>
    try {
      content = JSON.parse(rawContent)
    } catch {
      content = { summary: rawContent, recommendations: [] }
    }

    // Save to DB
    const { data: saved } = await adminClient.from('ai_insights').insert({
      merchant_code: merchantCode,
      insight_type:  'full',
      content,
      model_used:    'google/gemini-2.0-flash-001',
    }).select().single()

    return json({ ok: true, insight: saved, cached: false })

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
