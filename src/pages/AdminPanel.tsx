import { useState, useEffect } from 'react'
import { supabase, type Merchant } from '../lib/supabase'

export default function AdminPanel({ merchant }: { merchant: Merchant | null }) {
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [loading, setLoading] = useState(true)
  const [totalGMV, setTotalGMV] = useState(0)
  const [form, setForm] = useState({ name: '', email: '', currency: 'SAR' })
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: ms } = await supabase.from('merchants').select('*').order('created_at', { ascending: false })
    setMerchants(ms || [])

    const { data: pd } = await supabase.from('performance_data').select('total_sales')
    const gmv = (pd || []).reduce((s: number, r: { total_sales: number }) => s + r.total_sales, 0)
    setTotalGMV(gmv)
    setLoading(false)
  }

  async function addMerchant() {
    if (!form.name || !form.email) { setMsg('أدخل الاسم والإيميل'); return }
    setAdding(true)
    const code = 'M-' + Math.floor(100 + Math.random() * 900)
    const { error } = await supabase.from('merchants').insert({
      name: form.name, email: form.email, currency: form.currency,
      merchant_code: code, role: 'merchant', subscription_plan: 'free'
    })
    if (error) { setMsg('خطأ: ' + error.message); setAdding(false); return }
    setMsg('تم إضافة التاجر بنجاح ✓')
    setForm({ name: '', email: '', currency: 'SAR' })
    setShowForm(false)
    fetchData()
    setAdding(false)
  }

  async function toggleStatus(id: string, currentPlan: string) {
    await supabase.from('merchants').update({
      subscription_plan: currentPlan === 'free' ? 'pro' : 'free'
    }).eq('id', id)
    fetchData()
  }

  return (
    <div style={S.wrap}>
      {/* HEADER */}
      <div style={S.header}>
        <div>
          <h1 style={S.title}>لوحة الإدارة</h1>
          <p style={S.sub}>مرحباً {merchant?.name} — إدارة المنصة الكاملة</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={S.addBtn} onClick={() => setShowForm(!showForm)}>
            {showForm ? '✕ إلغاء' : '+ إضافة تاجر'}
          </button>
          <button style={S.logoutBtn} onClick={() => supabase.auth.signOut()}>تسجيل الخروج</button>
        </div>
      </div>

      {/* STATS */}
      <div style={S.statsRow}>
        {[
          { label: 'إجمالي التجار', value: merchants.length, icon: '👥', color: '#7c6bff' },
          { label: 'حجم المعاملات (GMV)', value: totalGMV.toLocaleString('ar-SA') + ' ر.س', icon: '💰', color: '#00e5b0' },
          { label: 'تجار نشطون', value: merchants.filter(m => m.subscription_plan !== 'free').length, icon: '✅', color: '#ffd166' },
          { label: 'نسخة المنصة', value: '2.0', icon: '🚀', color: '#ff6b6b' },
        ].map((s, i) => (
          <div key={i} style={S.statCard}>
            <div style={{ ...S.statBar, background: s.color }} />
            <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ADD FORM */}
      {showForm && (
        <div style={S.formCard}>
          <div style={S.formTitle}>إضافة تاجر جديد</div>
          {msg && <div style={S.msgBox}>{msg}</div>}
          <div style={S.formRow}>
            <div style={S.formField}>
              <label style={S.label}>اسم التاجر</label>
              <input style={S.input} placeholder="متجر النور" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div style={S.formField}>
              <label style={S.label}>البريد الإلكتروني</label>
              <input style={S.input} placeholder="merchant@example.com" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div style={S.formField}>
              <label style={S.label}>العملة</label>
              <select style={S.input} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                <option value="SAR">ر.س — ريال سعودي</option>
                <option value="AED">د.إ — درهم إماراتي</option>
                <option value="USD">$ — دولار</option>
              </select>
            </div>
          </div>
          <button style={S.submitBtn} onClick={addMerchant} disabled={adding}>
            {adding ? 'جاري الإضافة...' : '✓ إضافة التاجر'}
          </button>
        </div>
      )}

      {/* MERCHANTS TABLE */}
      <div style={S.tableCard}>
        <div style={S.tableHeader}>
          <div style={S.tableTitle}>قائمة التجار</div>
          <span style={S.badge}>{merchants.length} تاجر</span>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>جاري التحميل...</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                {['التاجر', 'الكود', 'البريد الإلكتروني', 'العملة', 'الخطة', 'تاريخ الانضمام', 'الإجراءات'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {merchants.map(m => (
                <tr key={m.id} style={S.tr}>
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent), var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff' }}>
                        {m.name?.[0] || 'T'}
                      </div>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                    </div>
                  </td>
                  <td style={S.td}><span style={S.codeTag}>{m.merchant_code}</span></td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{m.email}</td>
                  <td style={S.td}>{m.currency}</td>
                  <td style={S.td}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      background: m.subscription_plan === 'free' ? 'rgba(90,90,122,0.2)' : m.subscription_plan === 'pro' ? 'rgba(124,107,255,0.2)' : 'rgba(0,229,176,0.2)',
                      color: m.subscription_plan === 'free' ? 'var(--text3)' : m.subscription_plan === 'pro' ? 'var(--accent)' : 'var(--accent2)',
                    }}>
                      {m.subscription_plan === 'free' ? 'مجاني' : m.subscription_plan === 'pro' ? 'Pro' : 'Elite'}
                    </span>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>
                    {new Date(m.created_at).toLocaleDateString('ar-SA')}
                  </td>
                  <td style={S.td}>
                    <button
                      style={{ ...S.actionBtn, color: m.subscription_plan === 'free' ? 'var(--accent2)' : 'var(--text3)' }}
                      onClick={() => toggleStatus(m.id, m.subscription_plan)}
                    >
                      {m.subscription_plan === 'free' ? 'ترقية' : 'تخفيض'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: '32px', minHeight: '100vh', background: 'var(--bg)', maxWidth: 1400, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 },
  title: { fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px' },
  sub: { fontSize: 13, color: 'var(--text2)', marginTop: 4 },
  addBtn: { background: 'linear-gradient(135deg, var(--accent), #a594ff)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: '0 6px 20px rgba(124,107,255,0.3)' },
  logoutBtn: { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '10px 18px', borderRadius: 10, fontSize: 13 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 },
  statCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, position: 'relative', overflow: 'hidden' },
  statBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0' },
  formCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 20 },
  formTitle: { fontSize: 15, fontWeight: 700, marginBottom: 16 },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 },
  formField: {},
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 },
  input: { width: '100%', padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)', fontSize: 13, outline: 'none' },
  submitBtn: { background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: 10, fontSize: 13, fontWeight: 700 },
  msgBox: { background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.3)', color: 'var(--accent2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 14 },
  tableCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' },
  tableHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  tableTitle: { fontSize: 14, fontWeight: 700 },
  badge: { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 20px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '13px 20px', fontSize: 13, color: 'var(--text)' },
  codeTag: { background: 'rgba(124,107,255,0.15)', color: 'var(--accent)', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', fontWeight: 700 },
  actionBtn: { background: 'transparent', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, transition: 'all 0.2s' },
}
