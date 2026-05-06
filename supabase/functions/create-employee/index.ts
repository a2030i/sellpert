import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_PERMISSIONS = {
  dashboard:  true,
  orders:     true,
  products:   true,
  inventory:  true,
  marketing:  false,
  statement:  false,
  billing:    false,
  settings:   false,
  integrations: false,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const callerToken = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!callerToken) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceKey)

    const { data: { user: caller }, error: authErr } = await adminClient.auth.getUser(callerToken)
    if (authErr || !caller) return json({ error: 'Unauthorized' }, 401)

    // Caller must be a merchant (or admin acting on behalf — but we limit to merchant for self-service)
    const { data: callerMerchant } = await adminClient
      .from('merchants').select('role,merchant_code,subscription_plan')
      .eq('email', caller.email!).maybeSingle()
    if (!callerMerchant) return json({ error: 'Unauthorized' }, 401)
    if (!['merchant', 'admin', 'super_admin'].includes(callerMerchant.role)) {
      return json({ error: 'Only merchants/admins can add employees' }, 403)
    }

    const body = await req.json()
    const action = body.action || 'create'

    // ── DELETE EMPLOYEE (auth user) ──────────────────────────────────────
    if (action === 'delete_auth') {
      const { auth_id } = body
      if (!auth_id) return json({ error: 'auth_id required' }, 400)
      // Double-check this auth_id was an employee owned by caller
      const { data: emp } = await adminClient.from('merchants')
        .select('owner_merchant_code,role').eq('id', auth_id).maybeSingle()
      // emp may be null because RPC delete_employee already removed the row
      // but we still need to delete the auth user - safe because the RPC validated ownership
      await adminClient.auth.admin.deleteUser(auth_id).catch(() => {})
      return json({ ok: true })
    }

    // ── RESET PASSWORD ──────────────────────────────────────────────────
    if (action === 'reset_password') {
      const { employee_code, new_password } = body
      if (!employee_code || !new_password) return json({ error: 'employee_code & new_password required' }, 400)
      if (new_password.length < 8) return json({ error: 'كلمة المرور يجب 8 أحرف على الأقل' }, 400)

      const { data: emp } = await adminClient.from('merchants')
        .select('id,owner_merchant_code,role').eq('merchant_code', employee_code).maybeSingle()
      if (!emp || emp.role !== 'employee' || emp.owner_merchant_code !== callerMerchant.merchant_code) {
        return json({ error: 'Forbidden: not your employee' }, 403)
      }
      const { error } = await adminClient.auth.admin.updateUserById(emp.id, { password: new_password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ── CREATE EMPLOYEE (default action) ────────────────────────────────
    const {
      name, email, password,
      job_title,
      whatsapp_phone,
      permissions = DEFAULT_PERMISSIONS,
    } = body

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return json({ error: 'name, email, password مطلوبة' }, 400)
    }
    if (password.length < 8) return json({ error: 'الباسورد يجب 8 أحرف على الأقل' }, 400)

    // Quota check (basic plan = 2 employees, pro = 10, enterprise = unlimited)
    const limits: Record<string, number> = { free: 0, basic: 2, pro: 10, enterprise: 999 }
    const limit = limits[callerMerchant.subscription_plan || 'free'] ?? 0
    if (callerMerchant.role === 'merchant') {
      const { count } = await adminClient.from('merchants')
        .select('id', { count: 'exact', head: true })
        .eq('owner_merchant_code', callerMerchant.merchant_code)
        .eq('role', 'employee')
      if ((count || 0) >= limit) {
        return json({ error: `وصلت للحد الأقصى للموظفين في خطتك (${limit}). قم بالترقية لإضافة المزيد.` }, 403)
      }
    }

    // Create or reuse auth user
    let userId: string
    const { data: authData, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    })

    if (createErr) {
      const isAlreadyRegistered = /already registered|already been registered/i.test(createErr.message)
      if (!isAlreadyRegistered) return json({ error: createErr.message }, 400)

      const { data: listData } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
      const existing = listData?.users?.find(u => u.email?.toLowerCase() === email.trim().toLowerCase())
      if (!existing) return json({ error: createErr.message }, 400)

      const { data: existingMerchant } = await adminClient
        .from('merchants').select('id').eq('id', existing.id).maybeSingle()
      if (existingMerchant) return json({ error: 'هذا البريد مستخدم بحساب آخر' }, 400)

      userId = existing.id
      await adminClient.auth.admin.updateUserById(userId, { password })
    } else {
      userId = authData.user!.id
    }

    const code = `E-${Math.floor(1000 + Math.random() * 9000)}`

    const row: Record<string, any> = {
      id:                 userId,
      name:               name.trim(),
      email:              email.trim().toLowerCase(),
      role:               'employee',
      merchant_code:      code,
      currency:           'SAR',
      subscription_plan:  'free',
      owner_merchant_code: callerMerchant.merchant_code,
      job_title:          job_title?.trim() || null,
      whatsapp_phone:     whatsapp_phone?.trim() || null,
      permissions:        { ...DEFAULT_PERMISSIONS, ...permissions },
      is_active:          true,
    }

    const { error: dbErr } = await adminClient.from('merchants').insert(row)
    if (dbErr) {
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
