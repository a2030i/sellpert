import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { verifyTrendyolCredentials } from '../_shared/trendyolConnection.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // Auth check
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user }, error: authErr } = await caller.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // يجب أن يكون للمستدعي حساب في النظام (تاجر أو طاقم) — ليس مجرد توكن صالح
    const { data: callerRow } = await caller
      .from('merchants').select('role,is_active').eq('id', user.id).maybeSingle()
    if (!callerRow || callerRow.is_active === false) return json({ error: 'Forbidden' }, 403)

    const { platform, seller_id, api_key, api_secret } = await req.json()
    if (!platform) return json({ error: 'platform required' }, 400)

    switch (platform) {
      case 'trendyol':  return json(await testTrendyol(seller_id, api_key, api_secret))
      default:          return json({ ok: false, error: 'منصة غير مدعومة' })
    }
  } catch (e: any) {
    return json({ ok: false, error: e.message })
  }
})

// ── Trendyol ─────────────────────────────────────────────────────────────────
// Test: GET the international orders endpoint with a one-item page.
// Auth: Basic base64(apiKey:apiSecret)

async function testTrendyol(sellerId: string, apiKey: string, apiSecret: string) {
  try {
    await verifyTrendyolCredentials(sellerId, apiKey, apiSecret)
    return { ok: true, message: '✅ تم التحقق بنجاح — حساب Trendyol متصل وجاهز للمزامنة' }
  } catch (error: any) {
    return { ok: false, error: error.message }
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
