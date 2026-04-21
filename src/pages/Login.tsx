import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('البريد الإلكتروني أو كلمة المرور غير صحيحة')
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

        <div style={styles.field}>
          <label style={styles.label}>البريد الإلكتروني</label>
          <input
            style={styles.input}
            type="email"
            placeholder="merchant@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
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
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'جاري الدخول...' : 'تسجيل الدخول'}
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
    background: 'radial-gradient(ellipse, rgba(124,107,255,0.12) 0%, transparent 70%)',
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
    boxShadow: '0 8px 24px rgba(124,107,255,0.4)',
  },
  logoText: {
    fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px',
    background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  logoSub: { fontSize: 12, color: 'var(--text3)', marginTop: 4 },
  field: { marginBottom: 16 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 },
  input: {
    width: '100%', padding: '12px 14px',
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none',
    transition: 'border-color 0.2s',
  },
  error: {
    background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)',
    color: 'var(--red)', borderRadius: 8, padding: '10px 14px',
    fontSize: 12, marginBottom: 12,
  },
  btn: {
    width: '100%', padding: '13px',
    background: 'linear-gradient(135deg, var(--accent), #a594ff)',
    border: 'none', borderRadius: 10, color: '#fff',
    fontSize: 14, fontWeight: 700, transition: 'opacity 0.2s',
    boxShadow: '0 8px 24px rgba(124,107,255,0.35)',
    marginTop: 4,
  },
  footer: { fontSize: 11, color: 'var(--text3)', textAlign: 'center', marginTop: 20 },
}
