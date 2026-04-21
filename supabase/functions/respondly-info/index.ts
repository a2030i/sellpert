import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const DEFAULT_BASE = 'https://ovbrrumnqfvtgmqsscat.supabase.co/functions/v1/public-api'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return json({ error: 'Unauthorized' }, 401)
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user } } = await callerClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: caller } = await callerClient.from('merchants').select('role').eq('email', user.email!).single()
    if (!caller || !['admin', 'super_admin'].includes(caller.role)) return json({ error: 'Forbidden' }, 403)

    const body = await req.json()
    const { connection_id, action, instance_name } = body
    if (!connection_id) return json({ error: 'connection_id مطلوب' }, 400)

    const db = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: conn } = await db.from('platform_connections').select('*').eq('id', connection_id).single()
    if (!conn) return json({ error: 'الاتصال غير موجود' }, 404)
    if (!conn.api_key) return json({ error: 'API Key غير موجود' }, 400)

    const apiKey  = conn.api_key
    const baseUrl = (conn.extra?.base_url || DEFAULT_BASE).replace(/\/$/, '')
    const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' }

    // ── Fetch channels + templates (default) ──────────────────────────────────
    if (!action || action === 'info') {
      const [chRes, tplRes] = await Promise.allSettled([
        fetch(`${baseUrl}/channels`, { headers }),
        fetch(`${baseUrl}/templates`, { headers }),
      ])
      const chData  = chRes.status  === 'fulfilled' && chRes.value.ok  ? await chRes.value.json() : {}
      const tplData = tplRes.status === 'fulfilled' && tplRes.value.ok ? await tplRes.value.json() : {}
      return json({ ok: true, channels: chData.channels || [], templates: tplData.templates || [] })
    }

    // ── Create new QR instance ────────────────────────────────────────────────
    if (action === 'create_instance') {
      const res = await fetch(`${baseUrl}/whatsapp/create-instance`, {
        method: 'POST', headers, body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) return json({ error: data.error || 'فشل إنشاء الجلسة' }, res.status)
      return json({ ok: true, instance_name: data.instance_name, qr_code: data.qr_code, status: data.status })
    }

    // ── Get fresh QR for existing instance ───────────────────────────────────
    if (action === 'get_qr') {
      if (!instance_name) return json({ error: 'instance_name مطلوب' }, 400)
      const res = await fetch(`${baseUrl}/whatsapp/qr`, {
        method: 'POST', headers, body: JSON.stringify({ instance_name }),
      })
      const data = await res.json()
      if (!res.ok) return json({ error: data.error || 'فشل جلب QR' }, res.status)
      return json({ ok: true, qr_code: data.qr_code, status: data.status })
    }

    // ── Poll status of all instances ─────────────────────────────────────────
    if (action === 'status') {
      const res = await fetch(`${baseUrl}/whatsapp/status`, { headers })
      const data = await res.json()
      if (!res.ok) return json({ error: data.error || 'فشل جلب الحالة' }, res.status)
      return json({ ok: true, channels: data.channels || [] })
    }

    // ── Logout instance ───────────────────────────────────────────────────────
    if (action === 'logout') {
      if (!instance_name) return json({ error: 'instance_name مطلوب' }, 400)
      const res = await fetch(`${baseUrl}/whatsapp/logout`, {
        method: 'POST', headers, body: JSON.stringify({ instance_name }),
      })
      const data = await res.json()
      if (!res.ok) return json({ error: data.error || 'فشل قطع الاتصال' }, res.status)
      return json({ ok: true })
    }

    // ── Delete instance ───────────────────────────────────────────────────────
    if (action === 'delete_instance') {
      if (!instance_name) return json({ error: 'instance_name مطلوب' }, 400)
      const res = await fetch(`${baseUrl}/whatsapp/instance/${instance_name}`, {
        method: 'DELETE', headers,
      })
      const data = await res.json()
      if (!res.ok) return json({ error: data.error || 'فشل الحذف' }, res.status)
      return json({ ok: true })
    }

    return json({ error: 'action غير معروف' }, 400)

  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
