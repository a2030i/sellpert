import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL = 'google/gemini-2.5-pro-preview'

const SECTOR_TIPS: Record<string, string> = {
  food_groceries: 'البقالة والأغذية حساسة للتواريخ والتخزين. ركّز على: الصلاحية، الأوزان، الفئة بالدقيق في Amazon/Noon، وتوابل الموسم (رمضان/حج).' ,
  electronics: 'الإلكترونيات تعتمد على Buy Box والأسعار التنافسية. ركّز على: سعر السوق، الضمان، MFN vs FBA للتدوير السريع.',
  fashion: 'الأزياء عالية الإرجاع. ركّز على: المقاسات والألوان الأكثر إرجاعاً، جدول مقاسات في الوصف، الموسمية (عيد، رمضان، صيف).',
  beauty: 'الجمال تعتمد على العلامة التجارية. ركّز على: العروض الموسمية، التوصيات عبر المؤثرين، الإعلانات على إنستغرام.',
  home_decor: 'ديكور المنزل يعتمد على الصور العالية. ركّز على: صور lifestyle، الأبعاد، الاتجاهات الموسمية، الجمع عبر تراندايول.',
  toys: 'الألعاب موسمية (عيد/إجازة). ركّز على: العمر المستهدف، شهادات السلامة، المخزون قبل المواسم.',
  pets: 'مستلزمات الحيوانات. ركّز على: التكرار الشهري (طعام) - LTV.',
  sports: 'الرياضة تعتمد على الديموغرافية والموسم. ركّز على: المدرسة/الجامعة، الصيف للسباحة، الشتاء للصالات.',
  books: 'الكتب بطيئة الدوران. ركّز على: العناوين الجديدة، موسم المدارس، بوندلات.',
  jewelry: 'المجوهرات AOV عالي. ركّز على: جودة الصور، الشهادات، الإعلانات على Snap/Instagram.',
  baby: 'منتجات الأطفال عالية الثقة. ركّز على: سلامة، عمر مستهدف، البراندات المعروفة، الدفع بالتقسيط (Tabby).',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return j({ error: 'Unauthorized' }, 401)
    const db = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: { user } } = await db.auth.getUser(token)
    if (!user) return j({ error: 'Unauthorized' }, 401)
    const { data: m } = await db.from('merchants').select('*').eq('email', user.email!).maybeSingle()
    if (!m) return j({ error: 'merchant not found' }, 404)

    const body = await req.json()
    const question: string = body.question || ''
    const targetCode: string = body.merchant_code || m.merchant_code
    const isAdmin = ['admin','super_admin','employee'].includes(m.role)
    if (!isAdmin && targetCode !== m.merchant_code) return j({ error: 'Forbidden' }, 403)

    let openrouterKey = Deno.env.get('OPENROUTER_API_KEY') || ''
    if (!openrouterKey) {
      const { data: c } = await db.from('platform_connections').select('api_key').eq('platform', 'openrouter').eq('is_active', true).maybeSingle()
      openrouterKey = c?.api_key || ''
    }
    if (!openrouterKey) return j({ error: 'مفتاح OpenRouter غير مضبوط' }, 500)

    const since = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
    const [{ data: tm }, perfR, ordersR, prodsR, invR, retR, adsR, healthR, fcastR] = await Promise.all([
      db.from('merchants').select('name, sector, sub_sector, currency').eq('merchant_code', targetCode).maybeSingle(),
      db.from('performance_data').select('platform, data_date, total_sales, order_count, ad_spend, platform_fees').eq('merchant_code', targetCode).gte('data_date', since),
      db.from('orders').select('platform, status, total_amount, order_date, product_name').eq('merchant_code', targetCode).gte('order_date', since).limit(500),
      db.from('products').select('id, name, sku, cost_price, sale_price, brand, category').eq('merchant_code', targetCode).limit(200),
      db.from('inventory_health').select('platform, health_status, daily_velocity, days_of_stock, product_name, quantity').eq('merchant_code', targetCode).limit(100),
      db.from('returns').select('platform, return_amount, reason, return_date').eq('merchant_code', targetCode).limit(100),
      db.from('ad_metrics').select('platform, campaign_name, spend, revenue, orders, sku').eq('merchant_code', targetCode).order('spend', { ascending: false }).limit(50),
      db.rpc('merchant_health_score', { p_merchant_code: targetCode }),
      db.rpc('revenue_forecast', { p_merchant_code: targetCode }),
    ])

    const perf = perfR.data || []
    const orders = ordersR.data || []
    const totalSales = perf.reduce((s: number, r: any) => s + (Number(r.total_sales) || 0), 0)
    const totalOrders = perf.reduce((s: number, r: any) => s + (r.order_count || 0), 0)
    const totalAd = perf.reduce((s: number, r: any) => s + (Number(r.ad_spend) || 0), 0)
    const totalFees = perf.reduce((s: number, r: any) => s + (Number(r.platform_fees) || 0), 0)

    const byPlatform: Record<string, any> = {}
    for (const p of perf) {
      const k = p.platform
      if (!byPlatform[k]) byPlatform[k] = { sales: 0, orders: 0, ad: 0 }
      byPlatform[k].sales  += Number(p.total_sales) || 0
      byPlatform[k].orders += p.order_count || 0
      byPlatform[k].ad     += Number(p.ad_spend) || 0
    }

    const sector = tm?.sector || 'general'
    const sectorTip = SECTOR_TIPS[sector] || ''

    const ctx = {
      merchant: { name: tm?.name || targetCode, code: targetCode, currency: tm?.currency || 'SAR', sector, sub_sector: tm?.sub_sector },
      period: 'آخر 90 يوم',
      summary: { sales: Math.round(totalSales), orders: totalOrders, ad_spend: Math.round(totalAd), fees: Math.round(totalFees), net: Math.round(totalSales - totalAd - totalFees) },
      by_platform: Object.entries(byPlatform).map(([k, v]: any) => ({ platform: k, sales: Math.round(v.sales), orders: v.orders, ad: Math.round(v.ad) })),
      health_score: healthR.data,
      forecast: fcastR.data,
      total_products: (prodsR.data || []).length,
      inventory_summary: {
        out_of_stock: (invR.data || []).filter((i: any) => i.health_status === 'out_of_stock').length,
        low_stock:    (invR.data || []).filter((i: any) => i.health_status === 'low_stock').length,
        slow_movers:  (invR.data || []).filter((i: any) => i.health_status === 'slow_mover').length,
      },
      returns_count: (retR.data || []).length,
      returns_total: (retR.data || []).reduce((s: number, r: any) => s + (Number(r.return_amount) || 0), 0),
      top_ad_campaigns: (adsR.data || []).slice(0, 10).map((a: any) => ({ campaign: a.campaign_name, spend: Math.round(Number(a.spend)), revenue: Math.round(Number(a.revenue)), platform: a.platform })),
    }

    const sysPrompt = `أنت محلل بيانات تجارة إلكترونية في Sellpert.
${sectorTip ? 'التاجر في قطاع: ' + sector + '. اعرف أن: ' + sectorTip : ''}
بيانات التاجر:
${JSON.stringify(ctx, null, 2)}

إرشادات:
- أجب بالعربية باختصار (3-6 جمل).
- استخدم أرقام فعلية من البيانات.
- عند التوصيات راعِ خصائص القطاع المذكور أعلاه.
- لو البيانات غير كافية، قل بصراحة.`

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sellpert.com',
        'X-Title': 'Sellpert AI Chat',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: sysPrompt },
          ...((body.history || []) as any[]).slice(-8),
          { role: 'user', content: question },
        ],
        temperature: 0.4,
        max_tokens: 1200,
      }),
    })
    if (!aiRes.ok) {
      const t = await aiRes.text()
      return j({ error: 'OpenRouter: ' + t }, 500)
    }
    const data = await aiRes.json()
    const answer = data.choices?.[0]?.message?.content || 'لم أتمكن من توليد إجابة'
    return j({ ok: true, answer, sector })
  } catch (e: any) {
    return j({ error: e.message }, 500)
  }
})

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
