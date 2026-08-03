import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, CheckCircle2, Clock3, Copy, Download, KeyRound, Laptop, LockKeyhole, LogOut, Plus, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react'
import type { Merchant } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { describeBrowser, normalizeAuthenticatorCode, summarizeCurrentSession, type CurrentSessionSummary } from '../lib/accountSecurity'
import { callMfaRecovery } from '../lib/mfaRecovery'
import { userErrorMessage } from '../lib/userError'
import './AccountSecurity.css'

type TotpFactor = { id: string; friendly_name?: string; status: string; created_at: string }
type Enrollment = { id: string; qrCode: string; secret: string }
const dateTime = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })

export default function AccountSecurity({ merchant }: { merchant: Merchant | null }) {
  const [session, setSession] = useState<CurrentSessionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [factors, setFactors] = useState<TotpFactor[]>([])
  const [allFactors, setAllFactors] = useState<TotpFactor[]>([])
  const [mfaLoading, setMfaLoading] = useState(true)
  const [mfaBusy, setMfaBusy] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [factorToRemove, setFactorToRemove] = useState<TotpFactor | null>(null)
  const device = useMemo(() => describeBrowser(window.navigator.userAgent), [])

  const refreshMfa = useCallback(async () => {
    const [{ data: factorData }, { data: assurance }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
    setAllFactors((factorData?.all || []).filter(item => item.factor_type === 'totp') as TotpFactor[])
    setFactors((factorData?.totp || []) as TotpFactor[])
    const { data: { session: activeSession } } = await supabase.auth.getSession()
    if (activeSession) {
      const summary = summarizeCurrentSession(activeSession)
      if (summary) setSession({ ...summary, authenticationLevel: assurance?.currentLevel === 'aal2' ? 'verified' : 'standard' })
    }
    setMfaLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]).then(([sessionResult, userResult]) => {
      if (!active) return
      setSession(summarizeCurrentSession(sessionResult.data.session, userResult.data.user))
      setLoading(false)
    })
    refreshMfa()
    return () => { active = false }
  }, [refreshMfa])

  async function revokeOtherSessions() {
    setRevoking(true); setNotice(null)
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    setRevoking(false); setConfirmOpen(false)
    setNotice(error
      ? { kind: 'error', text: 'تعذر إنهاء الجلسات الأخرى. حاول مرة أخرى، وإذا استمرت المشكلة غيّر كلمة المرور.' }
      : { kind: 'success', text: 'تم إنهاء جميع جلسات الدخول الأخرى، وستبقى هذه الجلسة مفتوحة.' })
  }

  async function sendPasswordReset() {
    const email = merchant?.account_email || merchant?.email
    if (!email) return
    setResetting(true); setNotice(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/recovery` })
    setResetting(false)
    setNotice(error
      ? { kind: 'error', text: 'تعذر إرسال رابط تغيير كلمة المرور. حاول مرة أخرى.' }
      : { kind: 'success', text: `أرسلنا رابط تغيير كلمة المرور إلى ${email}.` })
  }

  async function startEnrollment() {
    setMfaBusy(true); setNotice(null)
    try {
      for (const factor of allFactors.filter(item => item.status === 'unverified')) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Sellpert ${factors.length + 1}` })
      if (error || !data?.totp) throw error || new Error('تعذر بدء الإعداد.')
      setEnrollment({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
      setVerificationCode('')
    } catch {
      setNotice({ kind: 'error', text: 'تعذر بدء إعداد تطبيق المصادقة. أعد تحميل الصفحة وحاول مرة أخرى.' })
    }
    setMfaBusy(false)
  }

  async function verifyEnrollment() {
    if (!enrollment || verificationCode.length !== 6) return
    setMfaBusy(true); setNotice(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code: verificationCode })
    if (error) {
      setNotice({ kind: 'error', text: 'رمز المصادقة غير صحيح. انتظر ظهور رمز جديد ثم حاول مرة أخرى.' })
      setMfaBusy(false)
      return
    }
    try {
      const result = await callMfaRecovery<{ codes: string[] }>({ action: 'generate', reason: 'enabled' })
      setRecoveryCodes(result.codes)
      setEnrollment(null); setVerificationCode('')
      setNotice({ kind: 'success', text: 'تم تفعيل التحقق بخطوتين. احفظ رموز الاسترداد قبل المتابعة.' })
      await refreshMfa()
    } catch (cause) {
      console.error('create initial MFA recovery codes', cause)
      setNotice({ kind: 'error', text: `تم تفعيل تطبيق المصادقة، لكن ${userErrorMessage(cause, 'تعذّر إنشاء رموز الاسترداد. حاول إنشاءها الآن.')}` })
      setEnrollment(null)
      await refreshMfa()
    }
    setMfaBusy(false)
  }

  async function regenerateRecoveryCodes() {
    setMfaBusy(true); setNotice(null)
    try {
      const result = await callMfaRecovery<{ codes: string[] }>({ action: 'generate' })
      setRecoveryCodes(result.codes)
      setNotice({ kind: 'success', text: 'تم إنشاء رموز جديدة وإلغاء الرموز السابقة.' })
    } catch (cause) {
      console.error('regenerate MFA recovery codes', cause)
      setNotice({ kind: 'error', text: userErrorMessage(cause, 'تعذّر إنشاء رموز الاسترداد.') })
    }
    setMfaBusy(false)
  }

  async function removeFactor() {
    if (!factorToRemove) return
    setMfaBusy(true); setNotice(null)
    const isLastFactor = factors.length === 1
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factorToRemove.id })
    if (error) {
      setNotice({ kind: 'error', text: 'تعذر إيقاف تطبيق المصادقة. تحقق بالرمز أولًا ثم حاول مرة أخرى.' })
    } else {
      if (isLastFactor) await callMfaRecovery({ action: 'clear' }).catch(() => undefined)
      setNotice({ kind: 'success', text: isLastFactor ? 'تم إيقاف التحقق بخطوتين وإلغاء رموز الاسترداد.' : 'تم حذف تطبيق المصادقة المحدد.' })
      await refreshMfa()
    }
    setFactorToRemove(null); setMfaBusy(false)
  }

  async function copyRecoveryCodes() {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'))
    setCopied(true); window.setTimeout(() => setCopied(false), 1800)
  }

  function downloadRecoveryCodes() {
    const content = `Sellpert — رموز استرداد التحقق بخطوتين\nاحفظها في مكان آمن. كل رمز صالح لمرة واحدة.\n\n${recoveryCodes.join('\n')}`
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'sellpert-recovery-codes.txt'
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
  }

  return (
    <div className="security-page" dir="rtl">
      <header className="security-header"><span className="security-eyebrow">حماية الحساب</span><h1>الأمان والجلسات</h1><p>راجع دخولك الحالي، فعّل التحقق بخطوتين، وتحكّم بجلسات الحساب.</p></header>
      {notice && <div className={`security-notice ${notice.kind}`} role="status">{notice.kind === 'success' && <CheckCircle2 size={18} />}{notice.text}</div>}

      <section className="security-overview" aria-label="ملخص أمان الحساب">
        <div className="security-score-icon"><ShieldCheck size={27} /></div>
        <div><h2>{factors.length ? 'الحساب محمي بخطوتين' : 'الحساب محمي بكلمة المرور'}</h2><p>{factors.length ? 'سيُطلب رمز تطبيق المصادقة بعد كلمة المرور عند كل تسجيل دخول جديد.' : 'فعّل تطبيق المصادقة لمنع الدخول حتى إذا انكشفت كلمة المرور.'}</p></div>
        <span className={`security-state ${factors.length ? '' : 'attention'}`}>{factors.length ? 'حماية قوية' : 'تحسين موصى به'}</span>
      </section>

      <section className="security-card mfa-card">
        <div className="mfa-section-head">
          <div className="password-lead"><span className="security-card-icon"><Smartphone size={19} /></span><div><h2>التحقق بخطوتين</h2><p>استخدم Google Authenticator أو Microsoft Authenticator أو أي تطبيق TOTP متوافق.</p></div></div>
          <button className="security-primary-btn" type="button" onClick={startEnrollment} disabled={mfaBusy || mfaLoading || factors.length >= 3}><Plus size={16} /> {factors.length ? 'إضافة تطبيق آخر' : 'تفعيل الآن'}</button>
        </div>
        {mfaLoading ? <div className="security-skeleton" /> : factors.length ? <div className="factor-list">
          {factors.map((factor, index) => <div className="factor-row" key={factor.id}>
            <span className="factor-status"><Check size={15} /></span>
            <div><strong>{factor.friendly_name || `تطبيق المصادقة ${index + 1}`}</strong><small>مفعّل منذ {formatDate(factor.created_at)}</small></div>
            <button type="button" onClick={() => setFactorToRemove(factor)} aria-label="حذف تطبيق المصادقة"><Trash2 size={16} /></button>
          </div>)}
          <div className="recovery-action"><div><strong>رموز الاسترداد</strong><span>أنشئ مجموعة جديدة إذا فقدت الرموز السابقة. ستُلغى الرموز القديمة فورًا.</span></div><button className="security-secondary-btn" type="button" onClick={regenerateRecoveryCodes} disabled={mfaBusy}>إنشاء رموز جديدة</button></div>
        </div> : <div className="mfa-empty"><LockKeyhole size={22} /><div><strong>التحقق بخطوتين غير مفعّل</strong><span>بعد التفعيل لن تكفي كلمة المرور وحدها للدخول إلى بيانات المتجر.</span></div></div>}
      </section>

      <div className="security-grid">
        <section className="security-card"><div className="security-card-head"><div><span className="security-card-icon"><Laptop size={19} /></span><h2>الجلسة الحالية</h2></div><span className="current-badge">هذا الجهاز</span></div>{loading ? <div className="security-skeleton" /> : session ? <div className="session-details"><div className="session-device"><strong>{device}</strong><span>جلسة الدخول المستخدمة الآن</span></div><dl><div><dt><Clock3 size={15} /> آخر تسجيل دخول</dt><dd>{formatDate(session.signedInAt)}</dd></div><div><dt><ShieldCheck size={15} /> مستوى التحقق</dt><dd>{session.authenticationLevel === 'verified' ? 'تحقق بخطوتين' : 'كلمة المرور'}</dd></div></dl></div> : <p className="security-muted">تعذر قراءة الجلسة الحالية. أعد تحميل الصفحة أو سجّل الدخول مجددًا.</p>}</section>
        <section className="security-card"><div className="security-card-head"><div><span className="security-card-icon"><LogOut size={19} /></span><h2>الجلسات الأخرى</h2></div></div><p className="security-card-copy">إذا دخلت من جهاز عام أو فقدت جهازًا، أنهِ جميع جلسات الدخول الأخرى مع إبقاء هذا الجهاز متصلًا.</p><button className="security-secondary-btn" type="button" onClick={() => setConfirmOpen(true)}>إنهاء الجلسات الأخرى</button><small>قد يستغرق توقف بعض الجلسات دقائق قليلة حتى تنتهي صلاحية الوصول الحالي.</small></section>
      </div>

      <section className="security-card password-card"><div className="password-lead"><span className="security-card-icon"><KeyRound size={19} /></span><div><h2>كلمة المرور</h2><p>سنرسل رابطًا آمنًا إلى {merchant?.account_email || merchant?.email} لتعيين كلمة مرور جديدة.</p></div></div><button className="security-primary-btn" type="button" onClick={sendPasswordReset} disabled={resetting}>{resetting ? 'جاري الإرسال…' : 'إرسال رابط تغيير كلمة المرور'}</button></section>
      <section className="security-guidance"><h2>متى تتخذ إجراءً؟</h2><ul><li>إذا لم تتعرف على وقت آخر تسجيل دخول، أنهِ الجلسات الأخرى وغيّر كلمة المرور.</li><li>احتفظ برموز الاسترداد خارج جهاز العمل، ولا تشاركها مع أي شخص.</li><li>استخدم كلمة مرور مختلفة عن حساباتك في المنصات التجارية.</li></ul></section>

      {(enrollment || recoveryCodes.length > 0) && <div className="security-modal-backdrop"><div className="security-modal mfa-enroll-modal" role="dialog" aria-modal="true" aria-labelledby="mfa-enroll-title">
        {recoveryCodes.length > 0 ? <><span className="security-modal-icon safe"><KeyRound size={22} /></span><h2 id="mfa-enroll-title">احفظ رموز الاسترداد</h2><p>كل رمز صالح لمرة واحدة. لن نعرض هذه المجموعة مرة أخرى بعد إغلاق النافذة.</p><div className="recovery-codes" dir="ltr">{recoveryCodes.map(code => <code key={code}>{code}</code>)}</div><div className="recovery-buttons"><button className="security-secondary-btn" type="button" onClick={copyRecoveryCodes}>{copied ? <><Check size={15} /> تم النسخ</> : <><Copy size={15} /> نسخ</>}</button><button className="security-secondary-btn" type="button" onClick={downloadRecoveryCodes}><Download size={15} /> تنزيل ملف</button></div><button className="security-primary-btn full" type="button" onClick={() => setRecoveryCodes([])}>حفظت الرموز في مكان آمن</button></> : enrollment ? <><button className="security-modal-close" type="button" aria-label="إلغاء الإعداد" onClick={() => setEnrollment(null)}><X size={18} /></button><span className="security-modal-icon safe"><Smartphone size={22} /></span><h2 id="mfa-enroll-title">اربط تطبيق المصادقة</h2><p>امسح الرمز بالكاميرا داخل تطبيق المصادقة، ثم أدخل الرمز المكوّن من 6 أرقام.</p><img className="mfa-qr" src={enrollment.qrCode} alt="رمز QR لإضافة Sellpert إلى تطبيق المصادقة" /><details className="mfa-secret"><summary>تعذر مسح الرمز؟</summary><code dir="ltr">{enrollment.secret}</code></details><label className="mfa-code-label" htmlFor="enrollment-code">رمز التطبيق</label><input className="mfa-code-input" id="enrollment-code" inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={event => setVerificationCode(normalizeAuthenticatorCode(event.target.value))} onKeyDown={event => event.key === 'Enter' && verifyEnrollment()} placeholder="000000" autoFocus /><button className="security-primary-btn full" type="button" disabled={mfaBusy || verificationCode.length !== 6} onClick={verifyEnrollment}>{mfaBusy ? 'جاري التحقق…' : 'تأكيد وتفعيل الحماية'}</button></> : null}
      </div></div>}

      {confirmOpen && <ConfirmDialog title="إنهاء جميع الجلسات الأخرى؟" text="ستحتاج الأجهزة والمتصفحات الأخرى إلى تسجيل الدخول من جديد. لن يتم تسجيل خروجك من هذا الجهاز." confirmLabel="إنهاء الجلسات" busy={revoking} onCancel={() => setConfirmOpen(false)} onConfirm={revokeOtherSessions} />}
      {factorToRemove && <ConfirmDialog title="حذف تطبيق المصادقة؟" text={factors.length === 1 ? 'سيتم إيقاف التحقق بخطوتين وإلغاء جميع رموز الاسترداد.' : 'لن تتمكن من استخدام الرموز الصادرة من هذا التطبيق بعد الحذف.'} confirmLabel="حذف التطبيق" busy={mfaBusy} onCancel={() => setFactorToRemove(null)} onConfirm={removeFactor} />}
    </div>
  )
}

function ConfirmDialog({ title, text, confirmLabel, busy, onCancel, onConfirm }: { title: string; text: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="security-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}><div className="security-modal" role="dialog" aria-modal="true"><button className="security-modal-close" type="button" aria-label="إغلاق" onClick={onCancel}><X size={18} /></button><span className="security-modal-icon"><Trash2 size={22} /></span><h2>{title}</h2><p>{text}</p><div className="security-modal-actions"><button className="security-secondary-btn" type="button" onClick={onCancel}>تراجع</button><button className="security-danger-btn" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'جاري التنفيذ…' : confirmLabel}</button></div></div></div>
}

function formatDate(value: string | null) { if (!value) return 'غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'غير متاح' : dateTime.format(date) }
