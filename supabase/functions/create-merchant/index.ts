import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is admin
    const callerToken = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!callerToken) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!

    // Verify caller identity via anon client
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    })
    const { data: { user: caller }, error: authErr } = await callerClient.auth.getUser()
    if (authErr || !caller) return json({ error: 'Unauthorized' }, 401)

    // Check caller is admin/super_admin
    const { data: callerMerchant } = await callerClient
      .from('merchants').select('role').eq('email', caller.email!).single()
    if (!callerMerchant || !['admin', 'super_admin'].includes(callerMerchant.role)) {
      return json({ error: 'Forbidden: admin only' }, 403)
    }

    const body = await req.json()
    const { name, email, password, currency = 'SAR', role = 'merchant', whatsapp_phone } = body

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return json({ error: 'name, email, password مطلوبة' }, 400)
    }
    if (password.length < 8) {
      return json({ error: 'الباسورد يجب أن يكون 8 أحرف على الأقل' }, 400)
    }

    // Use service role client for admin operations
    const adminClient = createClient(supabaseUrl, serviceKey)

    // Create auth user
    const { data: authData, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    })
    if (createErr) {
      const msg = createErr.message.includes('already registered')
        ? 'هذا البريد الإلكتروني مسجل مسبقاً'
        : createErr.message
      return json({ error: msg }, 400)
    }

    // Generate merchant code
    const prefix = role === 'merchant' ? 'M' : 'A'
    const code   = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`

    // Insert merchants record
    const merchantRow: Record<string, any> = {
      id:                authData.user!.id,
      name:              name.trim(),
      email:             email.trim().toLowerCase(),
      currency,
      role,
      merchant_code:     code,
      subscription_plan: 'free',
    }
    if (whatsapp_phone?.trim()) merchantRow.whatsapp_phone = whatsapp_phone.trim()

    const { error: dbErr } = await adminClient.from('merchants').insert(merchantRow)

    if (dbErr) {
      // Rollback auth user if DB insert failed
      await adminClient.auth.admin.deleteUser(authData.user!.id)
      return json({ error: 'خطأ في قاعدة البيانات: ' + dbErr.message }, 500)
    }

    return json({ ok: true, merchant_code: code, user_id: authData.user!.id })

  } catch (e: any) {
    return json({ error: e.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
