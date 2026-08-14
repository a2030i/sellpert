import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { isStrongPassword, passwordChecks, PASSWORD_POLICY_MESSAGE } from '../lib/passwordPolicy'
import { authRedirectErrorMessage, cleanAuthRedirectUrl, registrationErrorMessage } from '../lib/authErrors'
import { authCooldownRemaining, startAuthCooldown } from '../lib/authCooldown'
import { hasAcceptedCurrentLegalDocuments, LEGAL_DOCUMENT_VERSION } from '../lib/legal'

export default function Login() {
  const [redirectError] = useState(() => authRedirectErrorMessage(window.location))
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [legalAccepted, setLegalAccepted] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(redirectError)
  const [success, setSuccess] = useState(() => new URLSearchParams(window.location.search).get('mfa') === 'recovered'
    ? 'تم استرداد الوصول وإيقاف التحقق بخطوتين. سجّل الدخول ثم فعّله من جديد واحفظ الرموز الجديدة.'
    : '')
  const [verificationPending, setVerificationPending] = useState(false)
  const [verificationEmail, setVerificationEmail] = useState('')
  const [registerCooldown, setRegisterCooldown] = useState(() => authCooldownRemaining(window.localStorage, 'register'))
  const [recoverCooldown, setRecoverCooldown] = useState(() => authCooldownRemaining(window.localStorage, 'recover'))
  const [resendCooldown, setResendCooldown] = useState(() => authCooldownRemaining(window.localStorage, 'resend'))

  useEffect(() => {
    const refresh = () => {
      setRegisterCooldown(authCooldownRemaining(window.localStorage, 'register'))
      setRecoverCooldown(authCooldownRemaining(window.localStorage, 'recover'))
      setResendCooldown(authCooldownRemaining(window.localStorage, 'resend'))
    }
    const timer = window.setInterval(refresh, 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!redirectError) return
    window.history.replaceState(null, '', cleanAuthRedirectUrl(window.location))
  }, [redirectError])

  async function handleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('البريد الإلكتروني أو كلمة المرور غير صحيحة')
    setLoading(false)
  }

  async function handleRegister() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('أدخل اسم المتجر وبريدًا إلكترونيًا صحيحًا')
      return
    }
    if (!isStrongPassword(password)) {
      setError(PASSWORD_POLICY_MESSAGE)
      return
    }
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين')
      return
    }
    if (!hasAcceptedCurrentLegalDocuments(legalAccepted)) {
      setError('يجب قراءة شروط الاستخدام وسياسة الخصوصية والموافقة عليهما لإنشاء المتجر')
      return
    }
    const remaining = authCooldownRemaining(window.localStorage, 'register')
    if (remaining > 0) {
      setRegisterCooldown(remaining)
      setError(`انتظر ${remaining} ثانية قبل إعادة محاولة إنشاء المتجر.`)
      return
    }
    startAuthCooldown(window.localStorage, 'register')
    setRegisterCooldown(60)
    setLoading(true)
    setError('')
    setSuccess('')
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          name: name.trim(),
          whatsapp_phone: phone.trim(),
          signup_source: 'self_service',
          terms_accepted: true,
          privacy_accepted: true,
          legal_version: LEGAL_DOCUMENT_VERSION,
        },
      },
    })
    if (signUpError) setError(registrationErrorMessage(signUpError))
    else if (!data.session) {
      setVerificationPending(true)
      setVerificationEmail(normalizedEmail)
      setSuccess('تم إنشاء متجرك. افتح رسالة التحقق في بريدك ثم سجّل الدخول.')
    }
    setLoading(false)
  }

  async function handleResendVerification() {
    const normalizedEmail = verificationEmail || email.trim().toLowerCase()
    const remaining = authCooldownRemaining(window.localStorage, 'resend')
    if (remaining > 0) { setResendCooldown(remaining); return }
    startAuthCooldown(window.localStorage, 'resend')
    setResendCooldown(60); setLoading(true); setError('')
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup', email: normalizedEmail,
      options: { emailRedirectTo: window.location.origin },
    })
    if (resendError) setError(registrationErrorMessage(resendError))
    else setSuccess('أُرسلت رسالة تحقق جديدة. افحص صندوق الوارد والبريد غير المرغوب.')
    setLoading(false)
  }

  async function handleForgotPassword() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('أدخل بريدك الإلكتروني أولًا لاستعادة كلمة المرور')
      return
    }
    const remaining = authCooldownRemaining(window.localStorage, 'recover')
    if (remaining > 0) {
      setRecoverCooldown(remaining)
      setError(`انتظر ${remaining} ثانية قبل طلب رابط استعادة جديد.`)
      return
    }
    startAuthCooldown(window.localStorage, 'recover')
    setRecoverCooldown(60)
    setLoading(true)
    setError('')
    setSuccess('')
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/auth/recovery`,
    })
    if (resetError) setError('تعذر إرسال رابط الاستعادة الآن. حاول مرة أخرى لاحقًا.')
    else setSuccess('إذا كان البريد مسجلًا فسيصلك رابط آمن لتعيين كلمة مرور جديدة.')
    setLoading(false)
  }

  const switchMode = (next:'login'|'register') => {
    setMode(next); setError(''); setSuccess(''); setVerificationPending(false)
  }

  return (
    <main className="auth-page" dir="rtl">
      <aside className="auth-brand-panel" aria-label="عن Sellpert">
        <div className="auth-brand-mark"><span>S</span><strong>Sellpert</strong></div>
        <div className="auth-brand-copy">
          <h1>كل قرارات متجرك<br/>في مكان واحد</h1>
          <p>
            تابع المبيعات والطلبات وربحية المنتجات ببيانات موحدة وواضحة.
            <bdi className="auth-channel-list" dir="ltr">Amazon · Noon · Trendyol</bdi>
          </p>
        </div>
        <dl className="auth-brand-facts">
          <div><dt>قنوات بيع في لوحة واحدة</dt><dd>3</dd></div>
          <div><dt>دليل منتجات موحد</dt><dd>1</dd></div>
          <div><dt>وضوح لحالة المزامنة</dt><dd>24/7</dd></div>
        </dl>
      </aside>

      <section className="auth-form-area">
        <form className={`auth-card ${mode === 'register' ? 'auth-card--register' : ''}`} onSubmit={event => { event.preventDefault(); void (mode === 'login' ? handleLogin() : handleRegister()) }}>
          <div className="auth-mobile-brand"><span>S</span><strong>Sellpert</strong></div>
          <span className="auth-kicker">الدخول إلى مساحة العمل</span>
          <h2>{mode === 'login' ? 'مرحبًا بعودتك' : 'أنشئ مساحة متجرك'}</h2>
          <p className="auth-intro">{mode === 'login' ? 'أدخل بيانات الحساب وسيتعرّف النظام على صلاحياتك تلقائيًا.' : 'أنشئ حساب التاجر ثم ابدأ بإضافة بيانات قنوات البيع.'}</p>

          <div className="auth-tabs" role="tablist" aria-label="نوع العملية">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>تسجيل الدخول</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>إنشاء متجر</button>
          </div>

          {mode === 'register' && <div className="auth-two-columns">
            <label className="auth-field" htmlFor="store-name"><span>اسم المتجر</span><input id="store-name" name="store-name" autoComplete="organization" value={name} onChange={e => setName(e.target.value)} placeholder="مثال: متجر النخبة" /></label>
            <label className="auth-field" htmlFor="store-phone"><span>رقم الجوال (اختياري)</span><input id="store-phone" name="phone" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="05xxxxxxxx" inputMode="tel" /></label>
          </div>}

          <label className="auth-field" htmlFor="auth-email"><span>البريد الإلكتروني</span><input id="auth-email" name="email" autoComplete="email" type="email" placeholder="merchant@example.com" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="auth-field auth-password" htmlFor="auth-password">
            <span>كلمة المرور</span>
            <input id="auth-password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
          </label>

          {mode === 'register' && <>
            <label className="auth-field" htmlFor="auth-password-confirmation"><span>تأكيد كلمة المرور</span><input id="auth-password-confirmation" name="password-confirmation" autoComplete="new-password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
            <div className="auth-security-note"><ShieldCheck size={17}/><span>بيانات كل متجر معزولة بالكامل عن المتاجر الأخرى.</span></div>
            <div className="auth-password-rules">{passwordChecks(password).map(check => <span key={check.key} className={check.passed ? 'passed' : ''}><CheckCircle2 size={13}/>{check.label}</span>)}<span className={confirmPassword && password === confirmPassword ? 'passed' : ''}><CheckCircle2 size={13}/>كلمتا المرور متطابقتان</span></div>
            <label className="auth-legal"><input type="checkbox" checked={legalAccepted} onChange={event => setLegalAccepted(event.target.checked)}/><span>قرأت وأوافق على <a href="/terms" target="_blank" rel="noreferrer">شروط الاستخدام</a> و<a href="/privacy" target="_blank" rel="noreferrer">سياسة الخصوصية</a> — الإصدار {LEGAL_DOCUMENT_VERSION}</span></label>
          </>}

          {mode === 'login' && <button type="button" className="auth-forgot" onClick={handleForgotPassword} disabled={loading || recoverCooldown > 0}>{recoverCooldown > 0 ? `يمكن طلب رابط جديد بعد ${recoverCooldown} ث` : 'نسيت كلمة المرور؟'}</button>}
          {error && <div role="alert" className="auth-message error">{error}</div>}
          {success && <div role="status" className="auth-message success">{success}</div>}
          {mode === 'register' && verificationPending ? <button type="button" className="auth-forgot auth-resend" onClick={handleResendVerification} disabled={loading || resendCooldown > 0}>{resendCooldown > 0 ? `يمكن إعادة إرسال التحقق بعد ${resendCooldown} ث` : 'لم تصل الرسالة؟ إعادة إرسال التحقق'}</button> : null}

          <button className="auth-submit" type="submit" disabled={loading || (mode === 'register' && registerCooldown > 0)}>{loading ? 'جاري التنفيذ...' : mode === 'login' ? 'تسجيل الدخول' : registerCooldown > 0 ? `إعادة المحاولة بعد ${registerCooldown} ث` : 'إنشاء المتجر والبدء'}</button>
          <div className="auth-footer"><span>اتصال آمن · بيانات كل متجر معزولة بالكامل</span><p><a href="/privacy">سياسة الخصوصية</a><span> · </span><a href="/terms">شروط الاستخدام</a></p></div>
        </form>
      </section>
    </main>
  )
}
