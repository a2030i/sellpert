import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('البريد الإلكتروني أو كلمة المرور غير صحيحة')
    setLoading(false)
  }

  async function handleRegister() {
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError('أدخل اسم المتجر وبريدًا صحيحًا وكلمة مرور من 8 أحرف على الأقل')
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          name: name.trim(),
          whatsapp_phone: phone.trim(),
          signup_source: 'self_service',
        },
      },
    })
    if (signUpError) setError(signUpError.message.includes('already') ? 'هذا البريد مسجل مسبقًا' : 'تعذر إنشاء الحساب: ' + signUpError.message)
    else if (!data.session) setSuccess('تم إنشاء متجرك. افتح رسالة التحقق في بريدك ثم سجّل الدخول.')
    setLoading(false)
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.grid} />
      <div style={styles.glow} />

      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>S</div>
          <h1 style={styles.logoText}>Sellpert</h1>
          <p style={styles.logoSub}>منصة تحليلات المبيعات الموحدة</p>
        </div>

        <div style={styles.tabs}>
          <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess('') }} style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}>تسجيل الدخول</button>
          <button type="button" onClick={() => { setMode('register'); setError(''); setSuccess('') }} style={{ ...styles.tab, ...(mode === 'register' ? styles.tabActive : {}) }}>إنشاء متجر</button>
        </div>

        {mode === 'register' && <>
          <div style={styles.field}>
            <label style={styles.label}>اسم المتجر</label>
            <input style={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="مثال: متجر النخبة" />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>رقم الجوال (اختياري)</label>
            <input style={styles.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="05xxxxxxxx" inputMode="tel" />
          </div>
        </>}

        <div style={styles.field}>
          <label style={styles.label}>البريد الإلكتروني</label>
          <input
            style={styles.input}
            type="email"
            placeholder="merchant@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (mode === 'login' ? handleLogin() : handleRegister())}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>كلمة المرور</label>
          <input
            style={styles.input}
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (mode === 'login' ? handleLogin() : handleRegister())}
          />
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}

        <button
          style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }}
          onClick={mode === 'login' ? handleLogin : handleRegister}
          disabled={loading}
        >
          {loading ? 'جاري التنفيذ...' : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء المتجر والبدء'}
        </button>

        <p style={styles.footer}>
          منصة مخصصة لتجار التجارة الإلكترونية في المملكة العربية السعودية
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg)', position: 'relative', overflow: 'hidden',
  },
  grid: {
    position: 'fixed', inset: 0,
    backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
    backgroundSize: '48px 48px', opacity: 0.25, pointerEvents: 'none',
  },
  glow: {
    position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
    width: 600, height: 300,
    background: 'radial-gradient(ellipse, rgba(15,149,140,0.12) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative', zIndex: 1,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 24, padding: '40px 36px',
    width: '100%', maxWidth: 420,
    boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
  },
  logo: { textAlign: 'center', marginBottom: 32 },
  logoIcon: {
    width: 56, height: 56, borderRadius: 16,
    background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 24, fontWeight: 800, color: '#fff',
    margin: '0 auto 12px',
    boxShadow: '0 8px 24px rgba(15,149,140,0.4)',
  },
  logoText: {
    fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px',
    background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  logoSub: { fontSize: 12, color: 'var(--text3)', marginTop: 4 },
  tabs: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 4, background: 'var(--bg2)', borderRadius: 11, marginBottom: 22 },
  tab: { border: 0, borderRadius: 8, padding: '9px 8px', background: 'transparent', color: 'var(--text3)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  tabActive: { background: 'var(--surface)', color: 'var(--accent)', boxShadow: 'var(--shadow)' },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 },
  input: {
    width: '100%', padding: '12px 14px',
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none',
    transition: 'border-color 0.2s',
  },
  error: {
    background: 'var(--danger-bg)', border: '1px solid var(--danger-bg)',
    color: 'var(--red)', borderRadius: 8, padding: '10px 14px',
    fontSize: 12, marginBottom: 12,
  },
  success: { background: 'var(--success-bg)', border: '1px solid rgba(15,149,140,.2)', color: 'var(--success-text)', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 12, lineHeight: 1.6 },
  btn: {
    width: '100%', padding: '13px',
    background: 'linear-gradient(135deg, var(--accent), #55bdb5)',
    border: 'none', borderRadius: 10, color: '#fff',
    fontSize: 14, fontWeight: 700, transition: 'opacity 0.2s',
    boxShadow: '0 8px 24px rgba(15,149,140,0.35)',
    marginTop: 4,
  },
  footer: { fontSize: 11, color: 'var(--text3)', textAlign: 'center', marginTop: 20 },
}
