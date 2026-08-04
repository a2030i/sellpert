type AuthErrorLike = { code?: string; message?: string; status?: number } | null | undefined

const REDIRECT_ERROR_KEYS = ['error', 'error_code', 'error_description', 'auth_error'] as const

type AuthRedirectLocation = {
  pathname: string
  search: string
  hash: string
}

export function registrationErrorMessage(error: AuthErrorLike) {
  const code = String(error?.code || '').toLowerCase()
  const message = String(error?.message || '').toLowerCase()

  if (code === 'over_email_send_rate_limit' || error?.status === 429 || /rate limit|too many/.test(message)) {
    return 'تم إرسال عدد كبير من رسائل التحقق مؤخرًا. انتظر بضع دقائق ثم حاول مرة أخرى.'
  }
  if (code === 'user_already_exists' || /already|registered/.test(message)) {
    return 'هذا البريد مسجل مسبقًا. استخدم تسجيل الدخول أو استعادة كلمة المرور.'
  }
  if (code === 'email_address_invalid' || /invalid email/.test(message)) {
    return 'عنوان البريد الإلكتروني غير صالح. تحقق منه ثم حاول مرة أخرى.'
  }
  if (code === 'weak_password' || /password/.test(message)) {
    return 'كلمة المرور لا تحقق متطلبات الأمان الموضحة.'
  }
  return 'تعذر إنشاء الحساب الآن. حاول مرة أخرى بعد قليل.'
}

export function authRedirectErrorMessage(location: AuthRedirectLocation) {
  const query = new URLSearchParams(location.search)
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  const code = String(
    query.get('auth_error')
    || query.get('error_code')
    || fragment.get('error_code')
    || query.get('error')
    || fragment.get('error')
    || '',
  ).toLowerCase()
  const description = String(
    query.get('error_description') || fragment.get('error_description') || '',
  ).toLowerCase()

  if (!code && !description) return ''
  if (/expired|otp_expired|flow_state/.test(`${code} ${description}`)) {
    return 'انتهت صلاحية رابط التحقق أو الاستعادة. اطلب رسالة جديدة ثم استخدم أحدث رابط وصلك.'
  }
  if (/access_denied|bad_code|invalid|verification_failed/.test(`${code} ${description}`)) {
    return 'رابط التحقق أو الاستعادة غير صالح أو تم استخدامه سابقًا. اطلب رسالة جديدة وحاول مرة أخرى.'
  }
  return 'تعذر إكمال التحقق من الرابط. اطلب رسالة جديدة، وإذا استمرت المشكلة تواصل مع الدعم.'
}

export function cleanAuthRedirectUrl(location: AuthRedirectLocation) {
  const query = new URLSearchParams(location.search)
  for (const key of REDIRECT_ERROR_KEYS) query.delete(key)

  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  const hasAuthFragmentError = REDIRECT_ERROR_KEYS.some(key => fragment.has(key))
  const pathname = location.pathname === '/auth/recovery' ? '/' : location.pathname
  const search = query.toString()

  return `${pathname}${search ? `?${search}` : ''}${hasAuthFragmentError ? '' : location.hash}`
}
