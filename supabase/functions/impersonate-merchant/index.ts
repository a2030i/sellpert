import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL       = Deno.env.get('APP_URL') || 'https://sellpert.vercel.app'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    // Verify caller is admin
    const authHeader = req.headers.get('Authorization') || ''
    const callerJwt  = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await admin.auth.getUser(callerJwt)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // Look up by email (auth user ID may differ from merchants.id)
    const { data: caller } = await admin
      .from('merchants')
      .select('role')
      .eq('email', user.email)
      .maybeSingle()

    if (!caller || !['admin', 'super_admin'].includes(caller.role)) {
      return json({ error: 'Forbidden' }, 403)
    }

    const { merchant_code } = await req.json()
    if (!merchant_code) return json({ error: 'merchant_code required' }, 400)

    const { data: merchant } = await admin.from('merchants').select('email').eq('merchant_code', merchant_code).maybeSingle()
    if (!merchant?.email) return json({ error: 'Merchant not found' }, 404)

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: merchant.email,
      options: { redirectTo: APP_URL },
    })

    if (linkErr || !linkData) return json({ error: linkErr?.message || 'Failed to generate link' }, 500)

    const token = linkData.properties?.hashed_token
    const loginUrl = token
      ? `${APP_URL}/auth/callback?token_hash=${token}&type=magiclink&next=/`
      : linkData.properties?.action_link || ''

    return json({ url: loginUrl }, 200)
  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
