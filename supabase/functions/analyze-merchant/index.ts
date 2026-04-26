import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const ANALYSIS_MODEL = 'google/gemini-2.5-pro-preview'
const PARSE_MODEL    = 'google/gemini-2.5-flash-preview'
const CACHE_HOURS    = 6

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({}, 200)

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: { user } } = await adminClient.auth.getUser(token)
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { data: callerRecord } = await adminClient
      .from('merchants').select('*').eq('email', user.email!).maybeSingle()
    if (!callerRecord) return json({ error: 'merchant not found' }, 404)

    // Parse body early for permission checks
    let body: any = {}
    try { body = await req.json() } catch { /* no body */ }

    const mode: string = body?.mode || 'analysis'
    const isAdmin = ['admin', 'super_admin'].includes(callerRecord.role)
    const isMerchant = callerRecord.role === 'merchant'

    if (!isAdmin) {
      if (mode === 'parse_report') {
        // parse_report allowed for any authenticated merchant
        if (!isMerchant) return json({ error: 'Unauthorized' }, 403)
      } else {
        // analysis mode: merchant can only request their own code
        const reqCodes: string[] = Array.isArray(body?.merchant_codes) ? body.merchant_codes
          : body?.target_merchant_code ? [body.target_merchant_code]
          : []
        const isMerchantOwn = isMerchant && reqCodes.length === 1 && reqCodes[0] === callerRecord.merchant_code
        if (!isMerchantOwn) return json({ error: 'Admin only' }, 403)
      }
    }

    // Resolve API key: env first, then platform_connections table
    let openrouterKey = Deno.env.get('OPENROUTER_API_KEY') || ''
    if (!openrouterKey) {
      const { data: conn } = await adminClient
        .from('platform_connections')
        .select('api_key')
        .eq('platform', 'openrouter')
        .eq('is_active', true)
        .maybeSingle()
      openrouterKey = conn?.api_key || ''
    }
    if (!openrouterKey) {
      return json({ error: 'مفتاح OpenRouter غير مضبوط — أضفه من تبويب AI في لوحة الإدارة' }, 500)
    }

    // ── Mode: parse_report ────────────────────────────────────────────────────
    if (mode === 'parse_report') {
      const reportText: string = body?.report_text || ''
      const platform: string   = body?.platform    || ''
      const merchant_code: string = body?.merchant_code || ''

      if (!reportText.trim()) return json({ error: 'report_text مطلوب' }, 400)

      const prompt = `أنت محلل بيانات تجارة إلكترونية متخصص. مهمتك استخراج بيانات المبيعات اليومية من تقارير المنصات.

النص المُرسل هو تقرير مبيعات من منصة ${platform || 'غير محددة'}.
رمز التاجر: ${merchant_code || 'غير محدد'}

النص:
${reportText}

استخرج البيانات وأعد JSON بهذا الشكل بالضبط (بدون أي نص خارج الـ JSON):
{
  "platform": "${platform || 'تخمين من البيانات'}",
  "data_date": "YYYY-MM-DD أو null إذا غير واضح",
  "merchant_code": "${merchant_code || 'null'}",
  "products": [
    {"name": "اسم المنتج", "sku": "رقم SKU أو فارغ", "qty": 0, "revenue": 0.0}
  ],
  "total_sales": 0.0,
  "platform_fees": 0.0,
  "ad_spend": 0.0,
  "notes": "أي ملاحظات من التقرير",
  "confidence": "high|medium|low",
  "parse_warnings": ["أي تحذيرات أو بيانات غير واضحة"]
}

ملاحظات:
- qty هو عدد الوحدات المباعة
- revenue هو إجمالي الإيرادات قبل خصم رسوم المنصة
- إذا لم تجد منتجات فردية، اجعل products مصفوفة فارغة
- الأرقام دائماً numbers وليست strings
- إذا كانت هناك عملات غير SAR حوّلها إذا أمكن أو اذكر ذلك في parse_warnings`

      const aiRes = await callOpenRouter(openrouterKey, prompt, 1500, PARSE_MODEL)
      if (!aiRes.ok) return json({ error: 'OpenRouter error: ' + await aiRes.text() }, 500)
      const aiJson = await aiRes.json()
      const rawContent = aiJson.choices?.[0]?.message?.content || '{}'
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(rawContent) }
      catch { return json({ error: 'لم يتمكن AI من قراءة التقرير — تأكد أن النص واضح وكامل' }, 500) }

      return json({ ok: true, parsed })
    }

    // ── Mode: analysis (single or batch) ─────────────────────────────────────
    const rawCodes: string[] = Array.isArray(body?.merchant_codes) ? body.merchant_codes
      : body?.target_merchant_code ? [body.target_merchant_code]
      : []

    if (rawCodes.length === 0) return json({ error: 'merchant_codes مطلوب' }, 400)

    // Run analysis for each merchant (parallel for small batches)
    const results = await Promise.all(
      rawCodes.map(code => analyzeOne(adminClient, openrouterKey, code))
    )

    if (rawCodes.length === 1) {
      const r = results[0]
      if (r.error) return json({ error: r.error }, 500)
      return json({ ok: true, insight: r.insight, cached: r.cached, model: ANALYSIS_MODEL })
    }

    return json({ ok: true, results })

  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
})

async function analyzeOne(adminClient: any, openrouterKey: string, merchantCode: string) {
  const { data: merchant } = await adminClient
    .from('merchants').select('*').eq('merchant_code', merchantCode).maybeSingle()
  if (!merchant) return { error: `تاجر غير موجود: ${merchantCode}` }

  // Cache check
  const { data: cached } = await adminClient
    .from('ai_insights')
    .select('*')
    .eq('merchant_code', merchantCode)
    .eq('insight_type', 'full_quick')
    .gte('created_at', new Date(Date.now() - CACHE_HOURS * 3600000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (cached) return { insight: cached, cached: true }

  const since = new Date(Date.now() - 90 * 86400000).toISOString()
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
  const lowStock   = inventory.filter((i: any) => i.quantity > 0 && i.quantity <= i.low_stock_threshold).map((i: any) => i.product_name)
  const outOfStock = inventory.filter((i: any) => i.quantity === 0).map((i: any) => i.product_name)
  const topProducts = Object.entries(
    orders.reduce((acc: Record<string, number>, o: any) => {
      if (o.product_name) acc[o.product_name] = (acc[o.product_name] || 0) + (o.total_amount || 0)
      return acc
    }, {})
  ).sort(([,a],[,b]) => (b as number) - (a as number)).slice(0, 5)

  const now = Date.now()
  const last7Rev = orders.filter((o: any) => now - new Date(o.order_date).getTime() < 7 * 86400000).reduce((s: number, o: any) => s + (o.total_amount || 0), 0)
  const prev7Rev = orders.filter((o: any) => { const age = now - new Date(o.order_date).getTime(); return age >= 7 * 86400000 && age < 14 * 86400000 }).reduce((s: number, o: any) => s + (o.total_amount || 0), 0)
  const weekTrend = prev7Rev > 0 ? Math.round(((last7Rev - prev7Rev) / prev7Rev) * 100) : 0

  // Also include performance_data summary
  const perfByPlatform: Record<string, { sales: number; count: number }> = {}
  for (const p of perf) {
    if (!perfByPlatform[p.platform]) perfByPlatform[p.platform] = { sales: 0, count: 0 }
    perfByPlatform[p.platform].sales += p.total_sales || 0
    perfByPlatform[p.platform].count++
  }

  const dataSummary = {
    period: 'آخر 90 يوم',
    total_orders: orders.length,
    total_revenue: Math.round(totalRevenue),
    performance_entries: perf.length,
    currency: merchant.currency || 'SAR',
    week_over_week_change_pct: weekTrend,
    revenue_by_platform: Object.entries(byPlatform).map(([p, v]) => ({
      platform: p, revenue: Math.round(v.revenue), orders: v.count,
      cancel_rate: v.count > 0 ? Math.round((v.cancelled / v.count) * 100) : 0,
    })),
    perf_by_platform: Object.entries(perfByPlatform).map(([p, v]) => ({ platform: p, sales: Math.round(v.sales), entries: v.count })),
    revenue_by_day_of_week: Object.entries(byDay).map(([day, rev]) => ({ day, revenue: Math.round(rev) })),
    top_products: topProducts.map(([name, rev]) => ({ name, revenue: Math.round(rev as number) })),
    low_stock_products: lowStock.slice(0, 10),
    out_of_stock_products: outOfStock.slice(0, 10),
    total_sku_count: inventory.length,
  }

  const prompt = `أنت محلل بيانات تجارة إلكترونية خبير في السوق السعودي والخليجي.
حلّل بيانات التاجر وقدّم رؤى عملية مختصرة.

بيانات التاجر (${merchant.name}) - ${dataSummary.period}:
${JSON.stringify(dataSummary, null, 2)}

أعد JSON بهذا الشكل بالضبط (بدون أي نص خارج الـ JSON):
{
  "summary": "ملخص موجز 2-3 جمل عن أداء التاجر",
  "best_days": ["يوم1", "يوم2"],
  "best_platforms": [{"platform": "اسم المنصة", "reason": "سبب مع أرقام"}],
  "seasonal_insights": ["ملاحظة موسمية 1"],
  "forecast_next_week": {"amount": 0, "confidence": "عالية|متوسطة|منخفضة", "reasoning": "شرح التوقع"},
  "top_products": [{"name": "اسم المنتج", "revenue": 0, "trend": "up|down|stable"}],
  "recommendations": ["توصية عملية 1", "توصية 2", "توصية 3"],
  "low_stock_alert": ["منتج1"]
}`

  const aiRes = await callOpenRouter(openrouterKey, prompt, 1500)
  if (!aiRes.ok) {
    const errText = await aiRes.text()
    return { error: 'OpenRouter error: ' + errText }
  }

  const aiJson = await aiRes.json()
  const rawContent = aiJson.choices?.[0]?.message?.content || '{}'
  let content: Record<string, unknown>
  try { content = JSON.parse(rawContent) }
  catch { content = { summary: rawContent, recommendations: [] } }

  const { data: saved } = await adminClient.from('ai_insights').insert({
    merchant_code: merchantCode,
    insight_type:  'full_quick',
    content,
    model_used:    ANALYSIS_MODEL,
  }).select().maybeSingle()

  return { insight: saved, cached: false }
}

function callOpenRouter(apiKey: string, prompt: string, maxTokens: number, model = ANALYSIS_MODEL) {
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://sellpert.com',
      'X-Title': 'Sellpert AI',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

