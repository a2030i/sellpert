import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY') || ''
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Model routing: quick = fast daily check, deep = thorough monthly report
const MODELS = {
  quick: { id: 'google/gemini-2.0-flash-001', label: 'Gemini Flash',   cacheHours: 6,  maxTokens: 1500 },
  deep:  { id: 'anthropic/claude-opus-4',      label: 'Claude Opus 4', cacheHours: 24, maxTokens: 3000 },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user } } = await callerClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { data: callerRecord } = await callerClient
      .from('merchants').select('*').eq('email', user.email!).single()
    if (!callerRecord) return json({ error: 'merchant not found' }, 404)

    let merchantCode = callerRecord.merchant_code
    let merchant = callerRecord
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY)

    let body: any = {}
    try { body = await req.clone().json() } catch { /* no body */ }

    // Admins can analyze any merchant
    if (['admin', 'super_admin'].includes(callerRecord.role) && body?.target_merchant_code) {
      const { data: targetMerchant } = await adminClient
        .from('merchants').select('*').eq('merchant_code', body.target_merchant_code).single()
      if (targetMerchant) { merchant = targetMerchant; merchantCode = targetMerchant.merchant_code }
    }

    // mode: 'quick' (default) or 'deep'
    const mode = body?.mode === 'deep' ? 'deep' : 'quick'
    const model = MODELS[mode]
    const insightType = `full_${mode}`

    // Cache check
    const { data: cached } = await adminClient
      .from('ai_insights')
      .select('*')
      .eq('merchant_code', merchantCode)
      .eq('insight_type', insightType)
      .gte('created_at', new Date(Date.now() - model.cacheHours * 3600000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (cached) return json({ ok: true, insight: cached, cached: true, mode, model: model.label })

    // Gather data — deep mode uses 180 days for richer seasonal context
    const dayRange = mode === 'deep' ? 180 : 90
    const since = new Date(Date.now() - dayRange * 86400000).toISOString()

    const [ordersRes, perfRes, inventoryRes] = await Promise.all([
      adminClient.from('orders').select('*').eq('merchant_code', merchantCode).gte('order_date', since),
      adminClient.from('performance_data').select('*').eq('merchant_code', merchantCode).gte('created_at', since),
      adminClient.from('inventory').select('*').eq('merchant_code', merchantCode).eq('is_active', true),
    ])

    const orders    = ordersRes.data    || []
    const perf      = perfRes.data      || []
    const inventory = inventoryRes.data || []

    const totalRevenue = orders.reduce((s: number, o: any) => s + (o.total_amount || 0), 0)
    const byPlatform: Record<string, { revenue: number; count: number; cancelled: number }> = {}
    for (const o of orders) {
      if (!byPlatform[o.platform]) byPlatform[o.platform] = { revenue: 0, count: 0, cancelled: 0 }
      byPlatform[o.platform].revenue += o.total_amount || 0
      byPlatform[o.platform].count++
      if (o.status === 'cancelled') byPlatform[o.platform].cancelled++
    }
    const byDay: Record<string, number> = {}
    for (const o of orders) {
      const day = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][new Date(o.order_date).getDay()]
      byDay[day] = (byDay[day] || 0) + (o.total_amount || 0)
    }
    const byMonth: Record<string, number> = {}
    for (const o of orders) {
      const m = new Date(o.order_date).toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' })
      byMonth[m] = (byMonth[m] || 0) + (o.total_amount || 0)
    }
    const lowStock  = inventory.filter((i: any) => i.quantity > 0 && i.quantity <= i.low_stock_threshold).map((i: any) => i.product_name)
    const outOfStock = inventory.filter((i: any) => i.quantity === 0).map((i: any) => i.product_name)
    const topProducts = Object.entries(
      orders.reduce((acc: Record<string, number>, o: any) => {
        if (o.product_name) acc[o.product_name] = (acc[o.product_name] || 0) + (o.total_amount || 0)
        return acc
      }, {})
    ).sort(([,a],[,b]) => (b as number) - (a as number)).slice(0, 5)

    // Weekly trend: compare last 7 days vs prior 7
    const now = Date.now()
    const last7Rev = orders.filter((o: any) => now - new Date(o.order_date).getTime() < 7 * 86400000).reduce((s: number, o: any) => s + (o.total_amount || 0), 0)
    const prev7Rev = orders.filter((o: any) => {
      const age = now - new Date(o.order_date).getTime()
      return age >= 7 * 86400000 && age < 14 * 86400000
    }).reduce((s: number, o: any) => s + (o.total_amount || 0), 0)
    const weekTrend = prev7Rev > 0 ? Math.round(((last7Rev - prev7Rev) / prev7Rev) * 100) : 0

    const dataSummary = {
      period: `آخر ${dayRange} يوم`,
      total_orders: orders.length,
      total_revenue: Math.round(totalRevenue),
      currency: merchant.currency || 'SAR',
      week_over_week_change_pct: weekTrend,
      revenue_by_platform: Object.entries(byPlatform).map(([p, v]) => ({
        platform: p, revenue: Math.round(v.revenue), orders: v.count,
        cancel_rate: v.count > 0 ? Math.round((v.cancelled / v.count) * 100) : 0,
      })),
      revenue_by_day_of_week: Object.entries(byDay).map(([day, rev]) => ({ day, revenue: Math.round(rev) })),
      revenue_by_month: Object.entries(byMonth).map(([month, rev]) => ({ month, revenue: Math.round(rev) })),
      top_products: topProducts.map(([name, rev]) => ({ name, revenue: Math.round(rev as number) })),
      low_stock_products: lowStock.slice(0, 10),
      out_of_stock_products: outOfStock.slice(0, 10),
      total_sku_count: inventory.length,
    }

    if (!OPENROUTER_KEY) {
      return json({ error: 'OPENROUTER_API_KEY غير مضبوط في متغيرات البيئة — اذهب إلى Supabase Dashboard → Edge Functions → Secrets وأضف المفتاح' }, 500)
    }

    const depthNote = mode === 'deep'
      ? 'هذا تحليل عميق مفصّل. استخدم البيانات الكاملة لتقديم رؤى استراتيجية موسعة وتوقعات دقيقة.'
      : 'هذا تحليل سريع. ركّز على أبرز النقاط والتوصيات الفورية.'

    const prompt = `أنت محلل بيانات تجارة إلكترونية خبير في السوق السعودي والخليجي.
${depthNote}

بيانات التاجر (${merchant.name}) - ${dataSummary.period}:
${JSON.stringify(dataSummary, null, 2)}

أعد JSON بالشكل التالي بالضبط (بدون أي نص خارج الـ JSON):
{
  "summary": "ملخص نصي ${mode === 'deep' ? 'وافٍ بـ 4-5 جمل' : 'موجز بـ 2-3 جمل'} عن أداء التاجر",
  "best_days": ["يوم1", "يوم2"],
  "best_platforms": [{"platform": "اسم المنصة", "reason": "سبب واضح مع أرقام"}],
  "seasonal_insights": ["ملاحظة موسمية 1", "ملاحظة 2"${mode === 'deep' ? ', "ملاحظة 3"' : ''}],
  "forecast_next_week": {"amount": 0, "confidence": "عالية|متوسطة|منخفضة", "reasoning": "شرح التوقع بناءً على البيانات"},
  "top_products": [{"name": "اسم المنتج", "revenue": 0, "trend": "up|down|stable"}],
  "recommendations": ["توصية عملية 1", "توصية 2", "توصية 3"${mode === 'deep' ? ', "توصية 4", "توصية 5"' : ''}],
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
        model: model.id,
        messages: [{ role: 'user', content: prompt }],
        temperature: mode === 'deep' ? 0.4 : 0.3,
        max_tokens: model.maxTokens,
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
    try { content = JSON.parse(rawContent) }
    catch { content = { summary: rawContent, recommendations: [] } }

    const { data: saved } = await adminClient.from('ai_insights').insert({
      merchant_code: merchantCode,
      insight_type:  insightType,
      content,
      model_used:    model.id,
    }).select().single()

    return json({ ok: true, insight: saved, cached: false, mode, model: model.label })

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
