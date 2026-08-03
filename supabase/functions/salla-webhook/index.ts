/**
 * salla-webhook
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives ALL webhook events from Salla and processes them.
 * Store events are isolated per merchant and translated into sync jobs.
 *
 * Event → Action mapping:
 *  app.installed            → (handled by OAuth callback, but also here as fallback)
 *  app.uninstalled          → disconnect Salla only (the Sellpert account remains available)
 *  app.subscription.*       → acknowledged without billing changes (single free service)
 *  order.created            → queue sync_orders job
 *  order.updated            → queue sync_orders job
 *  product.created/updated  → queue sync_products job
 *  store.updated            → update salla_connections
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSettings } from '../_shared/getSettings.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const rawBody = await req.text()
  let payload: any

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── Load settings from DB (admin panel) ──────────────────────────────────
  const cfg = await getSettings(admin)

  // ── Verify webhook signature (fail closed) ────────────────────────────────
  // بدون سر مضبوط لا نعالج أي حدث؛ حمولة مزورة قد تغيّر اتصال متجر أو
  // تدرج وظائف مزامنة باسم متجر آخر.
  if (!cfg.webhookSecret) {
    console.error('SALLA_WEBHOOK_SECRET not configured — rejecting webhook (fail closed)')
    return json({ error: 'Webhook secret not configured' }, 401)
  }
  const signature = req.headers.get('X-Salla-Signature') || ''
  const expected  = await computeHmac(rawBody, cfg.webhookSecret)
  if (!timingSafeEqual(signature, expected)) {
    console.warn('Invalid webhook signature')
    return json({ error: 'Invalid signature' }, 401)
  }
  const event    = payload.event    || payload.type || ''
  const storeId  = String(payload.merchant?.id || payload.store_id || '')
  const eventId  = String(payload.id || crypto.randomUUID())

  // Log the event first (idempotency: skip if already processed)
  const { data: existing } = await admin
    .from('webhook_events')
    .select('id, status')
    .eq('id', eventId)
    .maybeSingle()

  if (existing?.status === 'processed') {
    return json({ ok: true, skipped: true })
  }

  await admin.from('webhook_events').upsert({
    id:         eventId,
    source:     'salla',
    event_type: event,
    store_id:   storeId,
    payload:    payload,
    status:     'received',
    received_at: new Date().toISOString(),
  }).catch(() => {})

  // Find merchant_code from salla_store_id
  const { data: conn } = await admin
    .from('salla_connections')
    .select('merchant_code')
    .eq('salla_store_id', storeId)
    .maybeSingle()

  const merchantCode = conn?.merchant_code || null

  try {
    await handleEvent(admin, event, storeId, merchantCode, payload)

    // Mark processed
    await admin.from('webhook_events').update({
      status:       'processed',
      merchant_code: merchantCode,
      processed_at: new Date().toISOString(),
    }).eq('id', eventId)

    return json({ ok: true })

  } catch (e: any) {
    console.error(`Webhook error [${event}]:`, e)
    await admin.from('webhook_events').update({
      status: 'failed',
      error:  e.message,
    }).eq('id', eventId)
    return json({ ok: false, error: e.message }, 500)
  }
})

// ── Event Handlers ────────────────────────────────────────────────────────────

async function handleEvent(
  admin: any,
  event: string,
  storeId: string,
  merchantCode: string | null,
  payload: any
) {
  switch (event) {
    case 'app.uninstalled': {
      if (!merchantCode) return
      await admin.from('salla_connections').update({
        uninstalled_at: new Date().toISOString(),
        sync_status: 'disconnected',
        updated_at: new Date().toISOString(),
      }).eq('merchant_code', merchantCode).eq('salla_store_id', storeId)
      await admin.from('notifications').insert({
        merchant_code: merchantCode,
        title: 'تم فصل متجر سلة',
        body: 'توقفت مزامنة سلة فقط. ما زال حساب Sellpert وبقية مصادر البيانات متاحًا.',
        type: 'integration_disconnected',
      }).catch(() => {})
      break
    }

    case 'app.subscription.cancelled':
    case 'app.subscription.expired':
    case 'app.subscription.paid':
    case 'app.subscription.updated': {
      // Sellpert currently has one free service. Salla billing events must not
      // suspend accounts, create invoices, or change feature access.
      console.log(`Acknowledged legacy Salla billing event without account changes: ${event}`)
      break
    }

    // ── ORDER EVENTS ─────────────────────────────────────────────────────────

    case 'order.created':
    case 'order.updated':
    case 'order.status.updated': {
      if (!merchantCode) return
      // Queue a sync job (high priority for real-time orders)
      await admin.from('sync_queue').insert({
        merchant_code: merchantCode,
        platform:      'salla',
        job_type:      'sync_orders',
        payload:       {
          order_id:   payload.data?.id,
          order_ref:  payload.data?.reference_id,
          event_type: event,
        },
        priority:    1,  // High priority
        status:      'pending',
        scheduled_at: new Date().toISOString(),
      })
      break
    }

    // ── PRODUCT EVENTS ───────────────────────────────────────────────────────

    case 'product.created':
    case 'product.updated':
    case 'product.quantity.low': {
      if (!merchantCode) return
      await admin.from('sync_queue').insert({
        merchant_code: merchantCode,
        platform:      'salla',
        job_type:      'sync_products',
        payload:       {
          product_id:  payload.data?.id,
          event_type:  event,
        },
        priority:    3,
        status:      'pending',
        scheduled_at: new Date().toISOString(),
      })
      break
    }

    // ── STORE EVENTS ─────────────────────────────────────────────────────────

    case 'store.updated': {
      if (!storeId) return
      const s = payload.data || {}
      await admin.from('salla_connections').update({
        store_name:     s.name     || undefined,
        store_domain:   s.domain   || undefined,
        store_logo:     s.logo?.url || undefined,
        store_currency: s.currency?.currency_iso || undefined,
        updated_at:     new Date().toISOString(),
      }).eq('salla_store_id', storeId)
      break
    }

    // ── APP INSTALLED (fallback if OAuth callback failed) ────────────────────

    case 'app.installed': {
      // Primary install and account ownership are handled by the OAuth callback.
      break
    }

    default:
      console.log(`Unhandled event: ${event}`)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

async function computeHmac(body: string, secret: string): Promise<string> {
  const key  = new TextEncoder().encode(secret)
  const msg  = new TextEncoder().encode(body)
  const ck   = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig  = await crypto.subtle.sign('HMAC', ck, msg)
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
