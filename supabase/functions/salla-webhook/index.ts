/**
 * salla-webhook
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives ALL webhook events from Salla and processes them.
 * Critical events handled atomically via DB functions.
 *
 * Event → Action mapping:
 *  app.installed            → (handled by OAuth callback, but also here as fallback)
 *  app.uninstalled          → suspend_merchant()
 *  app.subscription.paid    → reactivate_merchant()
 *  app.subscription.updated → update plan tier
 *  app.subscription.cancelled / expired → suspend_merchant()
 *  order.created            → queue sync_orders job
 *  order.updated            → queue sync_orders job
 *  product.created/updated  → queue sync_products job
 *  store.updated            → update salla_connections
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSettings } from '../_shared/getSettings.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Plan tier config
const PLAN_CHANNELS: Record<string, string[]> = {
  salla:      ['salla'],
  growth:     ['salla', 'amazon', 'noon', 'trendyol'],
  pro:        ['salla', 'amazon', 'noon', 'trendyol'],
  enterprise: ['salla', 'amazon', 'noon', 'trendyol'],
}

const PLAN_PRICES: Record<string, number> = {
  salla: 99, growth: 299, pro: 599, enterprise: 999,
}

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

  // ── Verify webhook signature ──────────────────────────────────────────────
  if (cfg.webhookSecret) {
    const signature = req.headers.get('X-Salla-Signature') || ''
    const expected  = await computeHmac(rawBody, cfg.webhookSecret)
    if (signature !== expected) {
      console.warn('Invalid webhook signature')
      return json({ error: 'Invalid signature' }, 401)
    }
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
    // ── SUBSCRIPTION EVENTS (most critical) ──────────────────────────────────

    case 'app.subscription.cancelled':
    case 'app.subscription.expired':
    case 'app.uninstalled': {
      if (!merchantCode) return
      console.log(`[CRITICAL] Suspending merchant ${merchantCode} — event: ${event}`)
      await admin.rpc('suspend_merchant', {
        p_merchant_code: merchantCode,
        p_reason:        event,
      })
      // Notify merchant
      await admin.from('notifications').insert({
        merchant_code: merchantCode,
        title:         '⚠️ تم إيقاف الاشتراك',
        body:          'تم إيقاف اشتراكك في Sellpert. لإعادة التفعيل، جدد اشتراكك من متجر سلة.',
        type:          'subscription_cancelled',
      }).catch(() => {})
      break
    }

    case 'app.subscription.paid': {
      if (!merchantCode) return
      const periodEnd = payload.data?.expired_at
        ? new Date(payload.data.expired_at * 1000).toISOString()
        : null
      await admin.rpc('reactivate_merchant', {
        p_merchant_code: merchantCode,
        p_period_end:    periodEnd,
      })
      // Create invoice
      const plan  = payload.data?.plan_name?.toLowerCase() || 'salla'
      const amount = PLAN_PRICES[plan] || 99
      await createInvoice(admin, merchantCode, plan, amount, storeId)
      await admin.from('notifications').insert({
        merchant_code: merchantCode,
        title:         '✅ تم تجديد الاشتراك',
        body:          `تم تجديد باقة ${planLabel(plan)} بنجاح. استمتع بخدمات Sellpert.`,
        type:          'subscription_renewed',
      }).catch(() => {})
      break
    }

    case 'app.subscription.updated': {
      if (!merchantCode) return
      const newPlan   = normalizePlan(payload.data?.plan_name || 'salla')
      const amount    = PLAN_PRICES[newPlan] || 99
      const periodEnd = payload.data?.expired_at
        ? new Date(payload.data.expired_at * 1000).toISOString()
        : new Date(Date.now() + 30 * 86400000).toISOString()

      await admin.from('subscriptions').update({
        plan:               newPlan,
        status:             'active',
        amount,
        current_period_end: periodEnd,
        updated_at:         new Date().toISOString(),
      }).eq('merchant_code', merchantCode)

      await admin.from('merchants').update({
        subscription_status: 'active',
        subscription_plan:   newPlan,
      }).eq('merchant_code', merchantCode)

      await admin.from('notifications').insert({
        merchant_code: merchantCode,
        title:         '🚀 تم ترقية باقتك',
        body:          `تم ترقية اشتراكك إلى ${planLabel(newPlan)}. القنوات المتاحة: ${PLAN_CHANNELS[newPlan]?.join(', ')}`,
        type:          'subscription_upgraded',
      }).catch(() => {})
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
      // Primary install is handled by OAuth callback.
      // Here we just ensure subscription is active if merchant exists.
      if (merchantCode) {
        await admin.from('merchants').update({ subscription_status: 'active' })
          .eq('merchant_code', merchantCode)
      }
      break
    }

    default:
      console.log(`Unhandled event: ${event}`)
  }
}

// ── Invoice Generator ─────────────────────────────────────────────────────────

async function createInvoice(
  admin: any,
  merchantCode: string,
  plan: string,
  amount: number,
  storeId: string
) {
  const tax    = Math.round(amount * 0.15 * 100) / 100
  const total  = amount + tax
  const num    = `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`
  const start  = new Date()
  const end    = new Date(Date.now() + 30 * 86400000)

  const { data: sub } = await admin.from('subscriptions')
    .select('id').eq('merchant_code', merchantCode).maybeSingle()

  await admin.from('invoices').insert({
    merchant_code:   merchantCode,
    subscription_id: sub?.id || null,
    invoice_number:  num,
    type:            'subscription',
    amount,
    tax_amount:      tax,
    total_amount:    total,
    status:          'paid',
    paid_at:         new Date().toISOString(),
    payment_ref:     storeId,
    period_start:    start.toISOString().split('T')[0],
    period_end:      end.toISOString().split('T')[0],
  }).catch(() => {})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePlan(raw: string): string {
  const r = raw.toLowerCase()
  if (r.includes('pro') || r.includes('professional')) return 'pro'
  if (r.includes('growth') || r.includes('نمو'))       return 'growth'
  if (r.includes('enterprise'))                          return 'enterprise'
  return 'salla'
}

function planLabel(plan: string): string {
  return { salla: 'باقة سلة', growth: 'باقة النمو', pro: 'باقة المحترف', enterprise: 'المؤسسات' }[plan] || plan
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
