import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const PLATFORM_AR: Record<string, string> = {
  trendyol: 'تراندايول', noon: 'نون', amazon: 'أمازون',
}

function buildMessage(event: string, data: Record<string, any>, merchantName: string): string {
  const now = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
  switch (event) {
    case 'sync_complete':
      return `✅ *${merchantName}*\nاكتملت مزامنة ${PLATFORM_AR[data.platform] || data.platform}\n📦 ${data.orders || 0} طلب | 📅 ${data.records || 0} يوم\n🕐 ${now}`
    case 'low_stock':
      return `⚠️ *${merchantName}* — تحذير مخزون\n${(data.products || []).slice(0, 5).map((p: string) => `• ${p}`).join('\n') || 'منتجات منخفضة المخزون'}\n🕐 ${now}`
    case 'new_order':
      return `🛍️ *${merchantName}* — طلب جديد\nالمنصة: ${PLATFORM_AR[data.platform] || data.platform}\nالقيمة: ${data.amount?.toLocaleString()} ${data.currency || 'ر.س'}\n🕐 ${now}`
    case 'ai_ready':
      return `🤖 *${merchantName}*\nالتحليل الذكي جاهز — افتح Sellpert لعرض الرؤى والتوصيات\n🕐 ${now}`
    case 'daily_report':
      return `📊 *${merchantName}* — تقرير اليوم\n💰 المبيعات: ${data.sales?.toLocaleString()} ${data.currency || 'ر.س'}\n📦 الطلبات: ${data.orders || 0}\n🕐 ${now}`
    default:
      return data.message || `إشعار من Sellpert: ${event}\n🕐 ${now}`
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    const body = await req.json()
    const { merchant_code, event, data = {} } = body

    if (!merchant_code || !event) return json({ error: 'merchant_code و event مطلوبان' }, 400)

    // Get Respondly connection
    const { data: conn } = await db
      .from('platform_connections')
      .select('*')
      .eq('platform', 'respondly')
      .eq('is_active', true)
      .limit(1)
      .single()

    if (!conn?.api_key) return json({ skipped: true, reason: 'Respondly غير مربوط أو بدون API Key' })

    // Get merchant info
    const { data: merchant } = await db
      .from('merchants')
      .select('name, whatsapp_phone')
      .eq('merchant_code', merchant_code)
      .single()

    if (!merchant?.whatsapp_phone) return json({ skipped: true, reason: 'لا يوجد رقم واتساب للتاجر' })

    const apiKey   = conn.api_key
    const baseUrl  = (conn.extra?.base_url || 'https://ovbrrumnqfvtgmqsscat.supabase.co/functions/v1/public-api').replace(/\/$/, '')
    const channelId = conn.extra?.channel_id || null

    const message = buildMessage(event, data, merchant.name)

    const payload: Record<string, any> = {
      to: merchant.whatsapp_phone,
      message,
    }
    if (channelId) payload.channel_id = channelId

    const res = await fetch(`${baseUrl}/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(payload),
    })

    const result = await res.json()

    if (!res.ok) {
      console.error('Respondly error:', result)
      return json({ error: result.error || 'فشل الإرسال', status: res.status }, res.status)
    }

    return json({ ok: true, message_id: result.message_id, event, merchant_code })

  } catch (e: any) {
    console.error('notify-whatsapp error:', e.message)
    return json({ error: e.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
