import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { KeyRound, LifeBuoy, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { normalizeAuthenticatorCode, normalizeRecoveryCode } from '../lib/accountSecurity'
import { callMfaRecovery } from '../lib/mfaRecovery'
import { userErrorMessage } from '../lib/userError'
import './MfaChallenge.css'

export default function MfaChallenge({ onVerified, onSignOut }: { onVerified: (session: Session) => void; onSignOut: () => void }) {
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      const factor = data?.totp?.[0]
      if (error || !factor) setError('تعذر العثور على تطبيق المصادقة المرتبط بالحساب. استخدم رمز استرداد أو سجّل الخروج.')
      else setFactorId(factor.id)
      setLoading(false)
    })
  }, [])

  async function verify() {
    setError('')
    if (mode === 'totp') {
      if (!factorId || code.length !== 6) { setError('أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.'); return }
      setSubmitting(true)
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      setSubmitting(false)
      if (error) { setError('الرمز غير صحيح أو انتهت صلاحيته. انتظر الرمز التالي وحاول مرة أخرى.'); return }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('تم التحقق، لكن تعذر تحديث الجلسة. سجّل الدخول من جديد.'); return }
      onVerified(session)
      return
    }

    if (code.length !== 16) { setError('أدخل رمز الاسترداد الكامل.'); return }
    setSubmitting(true)
    try {
      await callMfaRecovery({ action: 'recover', code })
      await supabase.auth.signOut({ scope: 'local' })
      window.location.replace('/?mfa=recovered')
    } catch (cause) {
      console.error('use MFA recovery code', cause)
      setError(userErrorMessage(cause, 'تعذّر استخدام رمز الاسترداد. تحقق من الرمز ثم حاول مرة أخرى.'))
      setSubmitting(false)
    }
  }

  function switchMode(next: 'totp' | 'recovery') {
    setMode(next); setCode(''); setError('')
  }

  return (
    <main className="mfa-gate" dir="rtl">
      <section className="mfa-gate-card" aria-labelledby="mfa-gate-title">
        <div className="mfa-gate-brand"><span>S</span><strong>Sellpert</strong></div>
        <div className="mfa-gate-icon">{mode === 'totp' ? <ShieldCheck size={27} /> : <LifeBuoy size={26} />}</div>
        <h1 id="mfa-gate-title">{mode === 'totp' ? 'تحقق من هويتك' : 'استرداد الوصول'}</h1>
        <p>{mode === 'totp' ? 'افتح تطبيق المصادقة وأدخل الرمز الظاهر لإكمال الدخول إلى متجرك.' : 'استخدم أحد رموز الاسترداد التي حفظتها عند تفعيل التحقق بخطوتين.'}</p>

        <label htmlFor="mfa-code">{mode === 'totp' ? 'رمز تطبيق المصادقة' : 'رمز الاسترداد'}</label>
        <div className="mfa-code-wrap">
          {mode === 'totp' ? <LockKeyhole size={18} /> : <KeyRound size={18} />}
          <input id="mfa-code" autoFocus inputMode={mode === 'totp' ? 'numeric' : 'text'} autoComplete="one-time-code"
            value={code} disabled={loading || submitting}
            onChange={event => setCode(mode === 'totp' ? normalizeAuthenticatorCode(event.target.value) : normalizeRecoveryCode(event.target.value))}
            onKeyDown={event => event.key === 'Enter' && verify()}
            placeholder={mode === 'totp' ? '000000' : 'XXXX XXXX XXXX XXXX'} />
        </div>
        {error && <div className="mfa-gate-error" role="alert">{error}</div>}
        <button className="mfa-gate-submit" type="button" onClick={verify} disabled={loading || submitting}>{submitting ? 'جاري التحقق…' : 'متابعة إلى المتجر'}</button>
        <button className="mfa-gate-link" type="button" onClick={() => switchMode(mode === 'totp' ? 'recovery' : 'totp')}>
          {mode === 'totp' ? 'لا أستطيع الوصول للتطبيق — استخدام رمز استرداد' : 'العودة إلى رمز تطبيق المصادقة'}
        </button>
        <button className="mfa-gate-signout" type="button" onClick={onSignOut}><LogOut size={15} /> تسجيل الخروج واستخدام حساب آخر</button>
      </section>
    </main>
  )
}
