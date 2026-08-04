import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.104.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CODE_COUNT = 10
const MAX_ATTEMPTS = 5
const ATTEMPT_WINDOW_MINUTES = 15

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
})

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'الطلب غير مدعوم.' }, 405)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token) throw new HttpError(401, 'يرجى تسجيل الدخول من جديد.')
    const { data: { user }, error: userError } = await admin.auth.getUser(token)
    if (userError || !user) throw new HttpError(401, 'انتهت جلسة الدخول. يرجى تسجيل الدخول من جديد.')

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '').trim()
    if (action === 'generate') return json(await generateCodes(admin, token, user.id, body?.reason))
    if (action === 'clear') return json(await clearCodes(admin, token, user.id))
    if (action === 'recover') return json(await recoverWithCode(admin, user.id, body?.code))
    throw new HttpError(400, 'الإجراء المطلوب غير معروف.')
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'تعذر إكمال إجراء الأمان.'
    return json({ error: status >= 500 ? 'تعذر إكمال إجراء الأمان الآن. حاول مرة أخرى.' : message }, status)
  }
})

async function generateCodes(admin: any, token: string, userId: string, reasonValue: unknown) {
  await requireAal2(admin, token)

  const codes = Array.from({ length: CODE_COUNT }, () => randomRecoveryCode())
  const hashes = await Promise.all(codes.map(code => sha256(normalizeCode(code))))
  const batchId = crypto.randomUUID()
  const { error: deleteError } = await admin.from('mfa_recovery_codes').delete().eq('user_id', userId)
  if (deleteError) throw deleteError
  const { error: insertError } = await admin.from('mfa_recovery_codes').insert(
    hashes.map(codeHash => ({ user_id: userId, batch_id: batchId, code_hash: codeHash })),
  )
  if (insertError) throw insertError
  await clearAttempts(admin, userId)
  await audit(admin, userId, reasonValue === 'enabled' ? 'mfa_enabled' : 'mfa_recovery_codes_regenerated')
  return { ok: true, codes }
}

async function clearCodes(admin: any, token: string, userId: string) {
  await requireAal2(admin, token)
  const { error } = await admin.from('mfa_recovery_codes').delete().eq('user_id', userId)
  if (error) throw error
  await clearAttempts(admin, userId)
  await audit(admin, userId, 'mfa_disabled')
  return { ok: true }
}

async function recoverWithCode(admin: any, userId: string, rawCode: unknown) {
  const code = normalizeCode(rawCode)
  if (!/^[A-Z0-9]{16}$/.test(code)) throw new HttpError(400, 'رمز الاسترداد غير صحيح.')
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60_000).toISOString()
  const { count, error: countError } = await admin.from('mfa_recovery_attempts')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('attempted_at', since)
  if (countError) throw countError
  if ((count || 0) >= MAX_ATTEMPTS) throw new HttpError(429, 'تم إيقاف المحاولات مؤقتًا. حاول بعد 15 دقيقة.')

  const codeHash = await sha256(code)
  const { data: matched, error: matchError } = await admin.from('mfa_recovery_codes')
    .select('id').eq('user_id', userId).eq('code_hash', codeHash).is('used_at', null).maybeSingle()
  if (matchError) throw matchError
  if (!matched) {
    await admin.from('mfa_recovery_attempts').insert({ user_id: userId })
    throw new HttpError(400, 'رمز الاسترداد غير صحيح أو سبق استخدامه.')
  }

  const usedAt = new Date().toISOString()
  const { data: consumed, error: consumeError } = await admin.from('mfa_recovery_codes')
    .update({ used_at: usedAt }).eq('id', matched.id).eq('user_id', userId).is('used_at', null)
    .select('id').maybeSingle()
  if (consumeError) throw consumeError
  if (!consumed) throw new HttpError(409, 'سبق استخدام رمز الاسترداد. استخدم رمزًا آخر.')

  const { data: factorsData, error: factorsError } = await admin.auth.admin.mfa.listFactors({ userId })
  if (factorsError) throw factorsError
  const verifiedFactors = (factorsData?.factors || []).filter((factor: any) => factor.status === 'verified')
  for (const factor of verifiedFactors) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id })
    if (error) throw error
  }
  await admin.from('mfa_recovery_codes').delete().eq('user_id', userId)
  await clearAttempts(admin, userId)
  await audit(admin, userId, 'mfa_recovered')
  return { ok: true, signed_out: true }
}

async function audit(admin: any, userId: string, action: string) {
  const { data: identity } = await admin.from('merchants')
    .select('merchant_code,owner_merchant_code').eq('id', userId).maybeSingle()
  const merchantCode = identity?.owner_merchant_code || identity?.merchant_code || null
  await admin.from('audit_log').insert({
    merchant_code: merchantCode,
    action,
    table_name: 'auth_security',
    record_id: userId,
    new_values: {},
    performed_by: userId,
  })
}

async function clearAttempts(admin: any, userId: string) {
  await admin.from('mfa_recovery_attempts').delete().eq('user_id', userId)
}

async function requireAal2(admin: any, token: string) {
  const { data: assurance, error } = await admin.auth.mfa.getAuthenticatorAssuranceLevel(token)
  if (error || assurance?.currentLevel !== 'aal2') {
    throw new HttpError(403, 'أدخل رمز تطبيق المصادقة أولًا لإكمال هذا الإجراء.')
  }
}

function randomRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const raw = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
}

function normalizeCode(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
