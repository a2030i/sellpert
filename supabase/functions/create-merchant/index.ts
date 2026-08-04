import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import {
  generateAccountCode,
  isStrongAccountPassword,
  normalizeEmail,
  normalizeName,
} from '../_shared/accountSecurity.ts'

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
    // Verify caller identity using service role + explicit token
    const adminClient = createClient(supabaseUrl, serviceKey)
    const { data: { user: caller }, error: authErr } = await adminClient.auth.getUser(callerToken)
    if (authErr || !caller) return json({ error: 'Unauthorized' }, 401)

    // Check caller is admin/super_admin
    const { data: callerMerchant } = await adminClient
      .from('merchants').select('role,permissions,is_active').eq('id', caller.id).maybeSingle()
    if (!callerMerchant?.is_active) return json({ error: 'Forbidden: inactive account' }, 403)
    const callerIsManager = !!callerMerchant && ['admin', 'super_admin'].includes(callerMerchant.role)
    const callerCanCreateStaff = callerMerchant?.role === 'staff'
      && Array.isArray(callerMerchant.permissions)
      && callerMerchant.permissions.includes('create_staff')
    if (!callerIsManager && !callerCanCreateStaff) {
      return json({ error: 'Forbidden: admin only' }, 403)
    }

    const body = await req.json()
    const { password, currency = 'SAR', role = 'merchant', whatsapp_phone } = body
    const name = normalizeName(body.name)
    const email = normalizeEmail(body.email)

    // الدور من جسم الطلب يجب أن يكون ضمن قائمة مسموحة — منع حقن super_admin
    const ALLOWED_ROLES = ['merchant', 'admin', 'staff']
    if (!ALLOWED_ROLES.includes(role)) {
      return json({ error: 'Invalid role' }, 400)
    }
    if (!callerIsManager && role !== 'staff') {
      return json({ error: 'Forbidden: staff accounts cannot create managers or merchants' }, 403)
    }

    if (!name || !email) {
      return json({ error: 'الاسم أو البريد الإلكتروني غير صالح' }, 400)
    }
    if (!isStrongAccountPassword(password)) {
      return json({ error: 'كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا وتحتوي على حرف ورقم ورمز، وألا تكون كلمة شائعة' }, 400)
    }
    if (currency !== 'SAR') return json({ error: 'Invalid currency' }, 400)
    if (whatsapp_phone != null && (typeof whatsapp_phone !== 'string' || whatsapp_phone.trim().length > 32)) {
      return json({ error: 'رقم الجوال غير صالح' }, 400)
    }

    // Never reuse an existing Auth identity or reset its password from this endpoint.
    const { data: authData, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr) {
      const isAlreadyRegistered =
        createErr.message.includes('already registered') ||
        createErr.message.includes('already been registered') ||
        createErr.message.includes('User already registered')
      return json({
        error: isAlreadyRegistered
          ? 'هذا البريد الإلكتروني مسجل مسبقاً. استخدم بريدًا آخر أو استعد الحساب الحالي.'
          : createErr.message,
      }, 400)
    }
    const userId = authData.user!.id

    // 64 bits of entropy removes the 9,000-account ceiling and makes collisions negligible.
    const prefix = role === 'merchant' ? 'M' : role === 'staff' ? 'S' : 'A'
    let code = ''
    let dbErr: { code?: string; message: string } | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      code = generateAccountCode(prefix)
      const merchantRow: Record<string, unknown> = {
        id: userId,
        name,
        email,
        currency,
        role,
        merchant_code: code,
        subscription_plan: 'free',
      }
      if (whatsapp_phone?.trim()) merchantRow.whatsapp_phone = whatsapp_phone.trim()
      const result = await adminClient.from('merchants').insert(merchantRow)
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
