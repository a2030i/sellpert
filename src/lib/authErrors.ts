type AuthErrorLike = { code?: string; message?: string; status?: number } | null | undefined

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

