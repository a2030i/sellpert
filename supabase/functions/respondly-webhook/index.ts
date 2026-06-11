import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-respondly-signature',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return j({ error: 'POST only' }, 405)

  const db = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    const body = await req.json()
    const { event_type, data } = body

    // تسجيل كل webhook في webhook_events
    await db.from('webhook_events').insert({
      source: 'respondly',
      event_type: event_type || 'unknown',
      payload: body,
      status: 'received',
    })

    // رد تلقائي لرسائل تحوي 'sellpert' أو 'سلبيرت' — إرسال لفريق الدعم أو تحويل
    if (event_type === 'message.received' && data?.from && data?.text) {
      const text = String(data.text).toLowerCase()
      const fromPhone = String(data.from).replace(/[^0-9]/g, '')

      // بحث عن تاجر برقم الواتساب
      const { data: m } = await db.from('merchants').select('merchant_code, name')
        .or(`whatsapp_phone.eq.${fromPhone},whatsapp_phone.eq.+${fromPhone},whatsapp_phone.eq.${data.from}`)
        .maybeSingle()

      if (m && (text.includes('sellpert') || text.includes('سلبيرت') || text.includes('تقرير') || text.includes('أداء'))) {
        // إنشاء تذكرة دعم تلقائية
        await db.from('merchant_requests').insert({
          merchant_code: m.merchant_code,
          type: 'inquiry',
          category: 'inquiry',
          title: 'رسالة واتساب من ' + m.name,
          note: data.text,
          priority: 'medium',
          status: 'pending',
          created_by: 'whatsapp',
          created_by_role: 'merchant',
        })
      }
    }

    return j({ ok: true, received: event_type })
  } catch (e: any) {
    return j({ error: e.message }, 500)
  }
})

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
