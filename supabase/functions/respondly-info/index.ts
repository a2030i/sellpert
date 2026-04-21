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
    const { connection_id } = body
    if (!connection_id) return json({ error: 'connection_id مطلوب' }, 400)

    const db = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: conn } = await db.from('platform_connections').select('*').eq('id', connection_id).single()
    if (!conn) return json({ error: 'الاتصال غير موجود' }, 404)
    if (!conn.api_key) return json({ error: 'API Key غير موجود' }, 400)

    const apiKey  = conn.api_key
    const baseUrl = (conn.extra?.base_url || DEFAULT_BASE).replace(/\/$/, '')
    const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' }

    const [chRes, tplRes] = await Promise.allSettled([
      fetch(`${baseUrl}/channels`, { headers }),
      fetch(`${baseUrl}/templates`, { headers }),
    ])

    const channels  = chRes.status  === 'fulfilled' && chRes.value.ok  ? await chRes.value.json()  : []
    const templates = tplRes.status === 'fulfilled' && tplRes.value.ok ? await tplRes.value.json() : []

    return json({ ok: true, channels, templates })

  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
