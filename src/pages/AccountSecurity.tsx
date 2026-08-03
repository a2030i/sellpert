import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, KeyRound, Laptop, LogOut, ShieldCheck, X } from 'lucide-react'
import type { Merchant } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { describeBrowser, summarizeCurrentSession, type CurrentSessionSummary } from '../lib/accountSecurity'
import './AccountSecurity.css'

const dateTime = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })

export default function AccountSecurity({ merchant }: { merchant: Merchant | null }) {
  const [session, setSession] = useState<CurrentSessionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const device = useMemo(() => describeBrowser(window.navigator.userAgent), [])

  useEffect(() => {
    let active = true
    Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]).then(([sessionResult, userResult]) => {
      if (!active) return
      setSession(summarizeCurrentSession(sessionResult.data.session, userResult.data.user))
      setLoading(false)
    })
    return () => { active = false }
  }, [])

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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/recovery`,
    })
    setResetting(false)
    setNotice(error
      ? { kind: 'error', text: 'تعذر إرسال رابط تغيير كلمة المرور. حاول مرة أخرى.' }
      : { kind: 'success', text: `أرسلنا رابط تغيير كلمة المرور إلى ${email}.` })
  }

  return (
    <div className="security-page" dir="rtl">
      <header className="security-header">
        <span className="security-eyebrow">حماية الحساب</span>
        <h1>الأمان والجلسات</h1>
        <p>راجع دخولك الحالي، أغلق أي جلسات أخرى، وحدّث كلمة المرور من مكان واحد.</p>
      </header>

      {notice && <div className={`security-notice ${notice.kind}`} role="status">{notice.kind === 'success' && <CheckCircle2 size={18} />}{notice.text}</div>}

      <section className="security-overview" aria-label="ملخص أمان الحساب">
        <div className="security-score-icon"><ShieldCheck size={27} /></div>
        <div>
          <h2>الحساب محمي بجلسة موثقة</h2>
          <p>لا نعرض عناوين الشبكة أو الرموز التقنية. يمكنك إنهاء بقية الجلسات فورًا إذا لم تتعرف على نشاط ما.</p>
        </div>
        <span className="security-state">نشط الآن</span>
      </section>

      <div className="security-grid">
        <section className="security-card">
          <div className="security-card-head">
            <div><span className="security-card-icon"><Laptop size={19} /></span><h2>الجلسة الحالية</h2></div>
            <span className="current-badge">هذا الجهاز</span>
          </div>
          {loading ? <div className="security-skeleton" /> : session ? (
            <div className="session-details">
              <div className="session-device"><strong>{device}</strong><span>جلسة الدخول المستخدمة الآن</span></div>
              <dl>
                <div><dt><Clock3 size={15} /> آخر تسجيل دخول</dt><dd>{formatDate(session.signedInAt)}</dd></div>
                <div><dt><ShieldCheck size={15} /> مستوى التحقق</dt><dd>{session.authenticationLevel === 'verified' ? 'تحقق إضافي' : 'كلمة المرور'}</dd></div>
              </dl>
            </div>
          ) : <p className="security-muted">تعذر قراءة الجلسة الحالية. أعد تحميل الصفحة أو سجّل الدخول مجددًا.</p>}
        </section>

        <section className="security-card">
          <div className="security-card-head">
            <div><span className="security-card-icon"><LogOut size={19} /></span><h2>الجلسات الأخرى</h2></div>
          </div>
          <p className="security-card-copy">إذا دخلت من جهاز عام، أو فقدت جهازًا، أنهِ جميع جلسات الدخول الأخرى مع إبقاء هذا الجهاز متصلًا.</p>
          <button className="security-secondary-btn" type="button" onClick={() => setConfirmOpen(true)}>إنهاء الجلسات الأخرى</button>
          <small>قد يستغرق توقف بعض الجلسات دقائق قليلة حتى تنتهي صلاحية الوصول الحالي.</small>
        </section>
      </div>

      <section className="security-card password-card">
        <div className="password-lead"><span className="security-card-icon"><KeyRound size={19} /></span><div><h2>كلمة المرور</h2><p>سنرسل رابطًا آمنًا إلى {merchant?.account_email || merchant?.email} لتعيين كلمة مرور جديدة.</p></div></div>
        <button className="security-primary-btn" type="button" onClick={sendPasswordReset} disabled={resetting}>{resetting ? 'جاري الإرسال…' : 'إرسال رابط تغيير كلمة المرور'}</button>
      </section>

      <section className="security-guidance">
        <h2>متى تتخذ إجراءً؟</h2>
        <ul>
          <li>إذا لم تتعرف على وقت آخر تسجيل دخول، أنهِ الجلسات الأخرى وغيّر كلمة المرور.</li>
          <li>لا تشارك كلمة المرور أو رموز تسجيل الدخول مع أي موظف أو جهة دعم.</li>
          <li>استخدم كلمة مرور مختلفة عن حساباتك في المنصات التجارية.</li>
        </ul>
      </section>

      {confirmOpen && <div className="security-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setConfirmOpen(false)}>
        <div className="security-modal" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
          <button className="security-modal-close" type="button" aria-label="إغلاق" onClick={() => setConfirmOpen(false)}><X size={18} /></button>
          <span className="security-modal-icon"><LogOut size={22} /></span>
          <h2 id="revoke-title">إنهاء جميع الجلسات الأخرى؟</h2>
          <p>ستحتاج الأجهزة والمتصفحات الأخرى إلى تسجيل الدخول من جديد. لن يتم تسجيل خروجك من هذا الجهاز.</p>
          <div className="security-modal-actions">
            <button className="security-secondary-btn" type="button" onClick={() => setConfirmOpen(false)}>تراجع</button>
            <button className="security-danger-btn" type="button" onClick={revokeOtherSessions} disabled={revoking}>{revoking ? 'جاري الإنهاء…' : 'إنهاء الجلسات'}</button>
          </div>
        </div>
      </div>}
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return 'غير متاح'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'غير متاح' : dateTime.format(date)
}
