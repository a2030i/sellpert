import { createClient } from 'npm:@supabase/supabase-js@2.104.0'

import { isStrongAccountPassword } from '../_shared/accountSecurity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'الطلب غير مدعوم.' }, 405)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token) throw new HttpError(401, 'يرجى تسجيل الدخول من جديد.')

    const { data: { user: caller }, error: callerAuthError } = await admin.auth.getUser(token)
    if (callerAuthError || !caller) throw new HttpError(401, 'انتهت جلسة الدخول. يرجى تسجيل الدخول من جديد.')

    const { data: callerAccount, error: callerAccountError } = await admin
      .from('merchants')
      .select('role,is_active')
      .eq('id', caller.id)
      .maybeSingle()
    if (callerAccountError) throw callerAccountError
    if (!callerAccount?.is_active || !['admin', 'super_admin'].includes(callerAccount.role)) {
      throw new HttpError(403, 'هذا الإجراء متاح لمدير النظام فقط.')
    }

    const body = await request.json().catch(() => ({}))
    const merchantId = typeof body?.merchant_id === 'string' ? body.merchant_id.trim() : ''
    if (!UUID_PATTERN.test(merchantId)) throw new HttpError(400, 'معرّف التاجر غير صالح.')
    if (!isStrongAccountPassword(body?.password)) {
      throw new HttpError(400, 'كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا وتحتوي على حرف ورقم ورمز، وألا تكون كلمة شائعة.')
    }

    const { data: target, error: targetError } = await admin
      .from('merchants')
      .select('id,merchant_code,role,is_active')
      .eq('id', merchantId)
      .maybeSingle()
    if (targetError) throw targetError
    if (!target || target.role !== 'merchant') throw new HttpError(404, 'تعذر العثور على حساب التاجر.')
    if (target.is_active === false) throw new HttpError(409, 'فعّل حساب التاجر قبل تغيير كلمة المرور.')

    const { data: authUser, error: authLookupError } = await admin.auth.admin.getUserById(target.id)
    if (authLookupError || !authUser.user) throw new HttpError(404, 'حساب دخول التاجر غير موجود.')

    const { error: passwordError } = await admin.auth.admin.updateUserById(target.id, {
      password: body.password,
    })
    if (passwordError) {
      console.error('admin merchant password update failed', passwordError.code || passwordError.name)
      throw new HttpError(502, 'تعذر تغيير كلمة المرور الآن. حاول مرة أخرى.')
    }

    const { error: auditError } = await admin.from('audit_log').insert({
      merchant_code: target.merchant_code,
      action: 'update',
      table_name: 'auth_security',
      record_id: target.id,
      old_values: null,
      new_values: { event: 'password_changed_by_admin' },
      performed_by: caller.email || caller.id,
      performed_at: new Date().toISOString(),
    })
    if (auditError) console.error('admin merchant password audit failed', auditError.code || 'unknown')

    return json({ ok: true, audit_logged: !auditError })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof HttpError ? error.message : 'تعذر تنفيذ تغيير كلمة المرور.'
    if (!(error instanceof HttpError)) console.error('admin merchant password reset failed', error instanceof Error ? error.name : 'unknown')
    return json({ error: message }, status)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
