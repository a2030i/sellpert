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

    // Verify caller identity using service role + explicit token
    const adminClient = createClient(supabaseUrl, serviceKey)
    const { data: { user: caller }, error: authErr } = await adminClient.auth.getUser(callerToken)
    if (authErr || !caller) return json({ error: 'Unauthorized' }, 401)

    // Check caller is admin/super_admin
    const { data: callerMerchant } = await adminClient
      .from('merchants').select('role').eq('email', caller.email!).maybeSingle()
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

    // Create auth user (or reuse existing if email already registered)
    let userId: string
    const { data: authData, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    })
    if (createErr) {
      const isAlreadyRegistered =
        createErr.message.includes('already registered') ||
        createErr.message.includes('already been registered') ||
        createErr.message.includes('User already registered')
      if (!isAlreadyRegistered) return json({ error: createErr.message }, 400)

      // Find existing auth user to reuse their ID
      const { data: listData } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
      const existing = listData?.users?.find(
        u => u.email?.toLowerCase() === email.trim().toLowerCase()
      )
      if (!existing) return json({ error: createErr.message }, 400)

      // Check if a merchants record already exists (active merchant)
      const { data: existingMerchant } = await adminClient
        .from('merchants').select('id').eq('id', existing.id).maybeSingle()
      if (existingMerchant) {
        return json({ error: 'هذا البريد الإلكتروني مسجل مسبقاً وله حساب نشط' }, 400)
      }

      // Auth user exists but no merchant record — safe to reuse
      userId = existing.id
      // Update password to the new one
      await adminClient.auth.admin.updateUserById(userId, { password })
    } else {
      userId = authData.user!.id
    }

    // Generate merchant code
    const prefix = role === 'merchant' ? 'M' : role === 'employee' ? 'E' : 'A'
    const code   = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`

    // Insert merchants record
    const merchantRow: Record<string, any> = {
      id:                userId,
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
      // Only rollback if we created a new auth user (not reused)
      if (authData?.user) await adminClient.auth.admin.deleteUser(userId)
      return json({ error: 'خطأ في قاعدة البيانات: ' + dbErr.message }, 500)
    }

    return json({ ok: true, merchant_code: code, user_id: userId })

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

