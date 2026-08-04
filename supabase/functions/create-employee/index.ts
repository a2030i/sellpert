import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import {
  generateAccountCode,
  isStrongAccountPassword,
  normalizeEmail,
  normalizeMerchantPermissions,
  normalizeName,
} from '../_shared/accountSecurity.ts'

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
      .from('merchants').select('role,merchant_code,permissions,is_active')
      .eq('id', caller.id).maybeSingle()
    if (!callerMerchant) return json({ error: 'Unauthorized' }, 401)
    if (!callerMerchant.is_active) return json({ error: 'Forbidden: inactive account' }, 403)

    const body = await req.json()
    const action = body.action || 'create'
    const callerCanManageStaff = callerMerchant.role === 'staff'
      && Array.isArray(callerMerchant.permissions)
      && callerMerchant.permissions.includes('create_staff')
    if (!['merchant', 'admin', 'super_admin'].includes(callerMerchant.role)
        && !(callerCanManageStaff && action === 'delete_auth')) {
      return json({ error: 'Only merchants/admins can add employees' }, 403)
    }

    // ── DELETE EMPLOYEE (auth user + merchants row) ─────────────────────
    // Ownership is verified HERE because this endpoint is directly callable:
    // the target row must still exist so we can check who owns it.
    if (action === 'delete_auth') {
      const { auth_id } = body
      if (!auth_id) return json({ error: 'auth_id required' }, 400)
      const { data: emp } = await adminClient.from('merchants')
        .select('id,owner_merchant_code,role').eq('id', auth_id).maybeSingle()
      if (!emp) return json({ error: 'Forbidden: target not found' }, 403)
      if (emp.id === caller.id) return json({ error: 'Forbidden: cannot delete own account' }, 403)

      const callerIsAdmin = ['admin', 'super_admin'].includes(callerMerchant.role)
      const ownsTarget = emp.role === 'employee' && emp.owner_merchant_code === callerMerchant.merchant_code
      if (callerCanManageStaff && emp.role !== 'staff') {
        return json({ error: 'Forbidden: staff accounts can only delete platform staff' }, 403)
      }
      if (!callerIsAdmin && !callerCanManageStaff && !ownsTarget) return json({ error: 'Forbidden: not your employee' }, 403)
      if (callerIsAdmin && !['employee', 'staff', 'admin'].includes(emp.role)) {
        return json({ error: 'Forbidden: cannot delete this account type' }, 403)
      }
      if (emp.role === 'admin') {
        const { count } = await adminClient.from('merchants')
          .select('id', { count: 'exact', head: true }).eq('role', 'admin')
        if ((count || 0) <= 1) return json({ error: 'لا يمكن حذف آخر مدير' }, 403)
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(auth_id)
      if (deleteError) return json({ error: 'تعذر حذف حساب الدخول. لم يتم حذف ملف الموظف.' }, 500)
      return json({ ok: true })
    }

    // ── RESET PASSWORD ──────────────────────────────────────────────────
    if (action === 'reset_password') {
      const { employee_code, new_password } = body
      if (!employee_code || !new_password) return json({ error: 'employee_code & new_password required' }, 400)
      if (!isStrongAccountPassword(new_password)) {
        return json({ error: 'كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا وتحتوي على حرف ورقم ورمز، وألا تكون كلمة شائعة' }, 400)
      }

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
    if (callerMerchant.role !== 'merchant') {
      return json({ error: 'Only merchant owners can add store employees' }, 403)
    }

    const {
      password,
      job_title,
      whatsapp_phone,
      permissions = DEFAULT_PERMISSIONS,
    } = body
    const name = normalizeName(body.name)
    const email = normalizeEmail(body.email)
    const safePermissions = normalizeMerchantPermissions(permissions, DEFAULT_PERMISSIONS)

    if (!name || !email) {
      return json({ error: 'الاسم أو البريد الإلكتروني غير صالح' }, 400)
    }
    if (!isStrongAccountPassword(password)) {
      return json({ error: 'كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا وتحتوي على حرف ورقم ورمز، وألا تكون كلمة شائعة' }, 400)
    }
    if (!safePermissions) return json({ error: 'الصلاحيات المرسلة غير صالحة' }, 400)
    if (job_title != null && (typeof job_title !== 'string' || job_title.trim().length > 100)) {
      return json({ error: 'المسمى الوظيفي غير صالح' }, 400)
    }
    if (whatsapp_phone != null && (typeof whatsapp_phone !== 'string' || whatsapp_phone.trim().length > 32)) {
      return json({ error: 'رقم الجوال غير صالح' }, 400)
    }

    // An existing identity must be recovered by its owner, never claimed here.
    const { data: authData, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createErr) {
      const isAlreadyRegistered = /already registered|already been registered/i.test(createErr.message)
      return json({
        error: isAlreadyRegistered
          ? 'هذا البريد مستخدم بحساب موجود. استخدم بريدًا مختلفًا أو اطلب من صاحبه استعادة الحساب.'
          : createErr.message,
      }, 400)
    }
    const userId = authData.user!.id

    let code = ''
    let dbErr: { code?: string; message: string } | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      code = generateAccountCode('E')
      const row: Record<string, unknown> = {
        id: userId,
        name,
        email,
        role: 'employee',
        merchant_code: code,
        currency: 'SAR',
        owner_merchant_code: callerMerchant.merchant_code,
        job_title: job_title?.trim() || null,
        whatsapp_phone: whatsapp_phone?.trim() || null,
        permissions: safePermissions,
        is_active: true,
      }
      const result = await adminClient.from('merchants').insert(row)
      dbErr = result.error
      if (!dbErr) break
      const codeCollision = dbErr.code === '23505' && /merchant_code/i.test(dbErr.message)
      if (!codeCollision) break
    }
    if (dbErr) {
      await adminClient.auth.admin.deleteUser(userId)
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
