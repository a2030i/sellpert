import { useMemo, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isStrongPassword, passwordChecks } from '../lib/passwordPolicy'

export default function PasswordRecovery({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const checks = useMemo(() => passwordChecks(password), [password])

  async function save() {
    if (!isStrongPassword(password)) {
      setError('اختر كلمة مرور تحقق جميع متطلبات الأمان')
      return
    }
    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين')
      return
    }

    setSaving(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message.toLowerCase().includes('same password')
        ? 'اختر كلمة مرور مختلفة عن كلمة المرور الحالية'
        : 'تعذر تحديث كلمة المرور. اطلب رابط استعادة جديدًا وحاول مرة أخرى.')
      setSaving(false)
      return
    }

    // Revoke other active sessions after a credential reset while preserving
    // the verified recovery session on this device.
    await supabase.auth.signOut({ scope: 'others' })
    window.history.replaceState(null, '', '/')
    setSaving(false)
    onComplete()
  }

  return (
    <main dir="rtl" style={styles.wrap}>
      <section style={styles.card} aria-labelledby="recovery-title">
        <div style={styles.icon}><KeyRound size={26} /></div>
        <h1 id="recovery-title" style={styles.title}>تعيين كلمة مرور جديدة</h1>
        <p style={styles.sub}>تم التحقق من رابط الاستعادة. اختر كلمة قوية لحماية بيانات متجرك.</p>

        <label style={styles.label}>كلمة المرور الجديدة</label>
        <div style={styles.passwordWrap}>
          <input
            autoFocus
            autoComplete="new-password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            style={styles.input}
          />
          <button type="button" aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} onClick={() => setShow(value => !value)} style={styles.eye}>
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>

        <div style={styles.checks}>
          {checks.map(check => (
            <span key={check.key} style={{ color: check.passed ? 'var(--success-text)' : 'var(--text3)' }}>
              <CheckCircle2 size={13} /> {check.label}
            </span>
          ))}
        </div>

        <label style={styles.label}>تأكيد كلمة المرور</label>
        <input
          autoComplete="new-password"
          type={show ? 'text' : 'password'}
          value={confirm}
          onChange={event => setConfirm(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && save()}
          style={styles.input}
        />

        <div style={styles.security}><ShieldCheck size={17} /> سيتم إنهاء الجلسات المفتوحة على الأجهزة الأخرى بعد التحديث.</div>
        {error && <div role="alert" style={styles.error}>{error}</div>}
        <button type="button" disabled={saving} onClick={save} style={{ ...styles.submit, opacity: saving ? .65 : 1 }}>
          {saving ? 'جاري الحفظ…' : 'حفظ كلمة المرور والدخول'}
        </button>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: 'var(--bg)' },
  card: { width: '100%', maxWidth: 430, padding: '34px 32px', borderRadius: 18, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 24px 70px rgba(0,0,0,.28)' },
  icon: { width: 52, height: 52, borderRadius: 14, display: 'grid', placeItems: 'center', marginBottom: 16, background: 'rgba(15,149,140,.12)', color: 'var(--accent)' },
  title: { margin: 0, fontSize: 22, color: 'var(--text)' },
  sub: { margin: '8px 0 24px', fontSize: 13, lineHeight: 1.8, color: 'var(--text3)' },
  label: { display: 'block', margin: '0 0 7px', fontSize: 12, fontWeight: 700, color: 'var(--text2)' },
  passwordWrap: { position: 'relative' },
  input: { width: '100%', padding: '12px 14px', marginBottom: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 14, outline: 'none' },
  eye: { position: 'absolute', left: 8, top: 6, width: 34, height: 34, border: 0, background: 'transparent', color: 'var(--text3)', display: 'grid', placeItems: 'center', cursor: 'pointer' },
  checks: { display: 'flex', flexWrap: 'wrap', gap: '7px 14px', margin: '-4px 0 18px', fontSize: 11 },
  security: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 12, borderRadius: 9, background: 'rgba(15,149,140,.07)', color: 'var(--text2)', fontSize: 11 },
  error: { padding: '10px 12px', marginBottom: 12, borderRadius: 9, background: 'var(--danger-bg)', color: 'var(--red)', fontSize: 12 },
  submit: { width: '100%', padding: 13, border: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontWeight: 800, cursor: 'pointer' },
}
