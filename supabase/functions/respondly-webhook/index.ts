import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.104.0'
import { stableWebhookEventKey, timingSafeEqual } from '../_shared/webhookSecurity.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-respondly-signature',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_BODY_BYTES = 1_000_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const db = createClient(SUPABASE_URL, SERVICE_KEY)
  let eventLogId: number | null = null

  try {
    const declaredSize = Number(req.headers.get('content-length') || 0)
    if (declaredSize > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413)

    const { data: secretSetting } = await db.from('app_settings').select('value')
      .eq('key', 'RESPONDLY_WEBHOOK_SECRET').maybeSingle()
    const expectedSecret = Deno.env.get('RESPONDLY_WEBHOOK_SECRET') || String(secretSetting?.value || '')
    if (expectedSecret.length < 32) {
      console.error('[respondly-webhook] RESPONDLY_WEBHOOK_SECRET is not configured; rejecting')
      return json({ error: 'Webhook not configured' }, 503)
    }
    const providedSecret = req.headers.get('x-respondly-signature') || ''
    if (!timingSafeEqual(providedSecret, expectedSecret)) return json({ error: 'Invalid signature' }, 401)

    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
      return json({ error: 'Payload too large' }, 413)
    }

    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    const { event_type: eventType, data } = body
    const eventKey = await stableWebhookEventKey(
      'respondly',
      body?.event_id || body?.id || data?.event_id || data?.message_id || data?.id,
      rawBody,
    )

    const { data: eventLog, error: eventError } = await db.from('webhook_events').insert({
      source: 'respondly',
      event_type: eventType || 'unknown',
      payload: body,
      status: 'received',
      event_key: eventKey,
    }).select('id').single()
    if (eventError?.code === '23505') return json({ ok: true, skipped: true })
    if (eventError) throw eventError
    eventLogId = Number(eventLog.id)

    if (eventType === 'message.received' && data?.from && data?.text) {
      const messageText = String(data.text)
      const normalizedText = messageText.toLowerCase()
      const fromPhone = String(data.from).replace(/[^0-9]/g, '')
      const { data: merchant } = fromPhone
        ? await db.from('merchants').select('merchant_code, name')
          .in('whatsapp_phone', [fromPhone, `+${fromPhone}`]).maybeSingle()
        : { data: null }

      if (merchant && ['sellpert', 'سلبيرت', 'تقرير', 'أداء'].some(term => normalizedText.includes(term))) {
        const { error: requestError } = await db.from('merchant_requests').insert({
          merchant_code: merchant.merchant_code,
          type: 'inquiry',
          category: 'inquiry',
          title: `رسالة واتساب من ${merchant.name}`.slice(0, 180),
          note: messageText.slice(0, 2000),
          priority: 'medium',
          status: 'pending',
          created_by: 'whatsapp',
          created_by_role: 'merchant',
        })
        if (requestError) throw requestError
      }
    }

    await db.from('webhook_events').update({
      status: 'processed',
      processed_at: new Date().toISOString(),
    }).eq('id', eventLogId)
    return json({ ok: true, received: eventType })
  } catch (error: any) {
    if (eventLogId) await db.from('webhook_events').update({
      status: 'failed',
      error: String(error?.message || error).slice(0, 1000),
      processed_at: new Date().toISOString(),
    }).eq('id', eventLogId)
    return json({ error: error?.message || 'Webhook processing failed' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
