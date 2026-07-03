import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP } from './adminShared'
import { toastOk, toastErr } from '../../components/Toast'

const ENTRY_PLATFORMS = [
  { value: 'trendyol', label: 'تراندايول' },
  { value: 'noon',     label: 'نون'       },
  { value: 'amazon',   label: 'أمازون'    },
]

// ─── محرّر مواعيد التحويل (رزنامة الكاش للتاجر) ──────────────────────────────────
function PayoutEditor({ merchants }: { merchants: any[] }) {
  const today = new Date().toISOString().split('T')[0]
  const [mc, setMc] = useState('')
  const [platform, setPlatform] = useState('noon')
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [list, setList] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!mc) { setList([]); return }
    supabase.from('merchant_payout_schedule').select('*').eq('merchant_code', mc).order('payout_date', { ascending: false }).limit(20)
      .then(({ data }) => setList(data || []))
  }, [mc])

  async function add() {
    if (!mc || !amount || !date) { toastErr('التاجر والمبلغ والتاريخ مطلوبة'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('merchant_payout_schedule').insert({
      merchant_code: mc, platform, payout_date: date, amount: Number(amount), note: note.trim() || null, created_by: user?.email || null,
    })
    setSaving(false)
    if (error) { toastErr(error.message); return }
    toastOk('✅ أُضيف موعد التحويل — سيظهر للتاجر فوراً')
    setAmount(''); setNote('')
    supabase.from('merchant_payout_schedule').select('*').eq('merchant_code', mc).order('payout_date', { ascending: false }).limit(20)
      .then(({ data }) => setList(data || []))
  }

  async function markPaid(id: string) {
    await supabase.from('merchant_payout_schedule').update({ status: 'paid' }).eq('id', id)
    setList(l => l.map(x => x.id === id ? { ...x, status: 'paid' } : x))
  }
  async function del(id: string) {
    await supabase.from('merchant_payout_schedule').delete().eq('id', id)
    setList(l => l.filter(x => x.id !== id))
  }

  return (
    <div style={{ ...S.chartCard, marginBottom: 20, padding: 20, borderRight: '4px solid var(--accent)' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>💰 مواعيد التحويل للتاجر</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>أدخل متى وكم يصل التاجر مستحقاته — يظهر له فوراً في «القادم لحسابك»</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
        <select value={mc} onChange={e => setMc(e.target.value)} style={S.input as any}>
          <option value="">اختر التاجر…</option>
          {merchants.map(m => <option key={m.merchant_code} value={m.merchant_code}>{m.name || m.merchant_code}</option>)}
        </select>
        <select value={platform} onChange={e => setPlatform(e.target.value)} style={S.input as any}>
          {ENTRY_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input as any} />
        <input type="number" placeholder="المبلغ (ر.س)" value={amount} onChange={e => setAmount(e.target.value)} style={S.input as any} />
        <input placeholder="ملاحظة (اختياري)" value={note} onChange={e => setNote(e.target.value)} style={S.input as any} />
        <button style={{ ...S.btn, background: 'var(--accent-strong)', color: '#fff' }} onClick={add} disabled={saving}>{saving ? '⟳' : '+ إضافة موعد'}</button>
      </div>
      {list.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead><tr>{['التاريخ', 'المنصة', 'المبلغ', 'الحالة', 'ملاحظة', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} style={S.tr}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.payout_date}</td>
                  <td style={S.td}>{PLATFORM_MAP[r.platform] || r.platform}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent2)' }}>{Number(r.amount).toLocaleString()} ر.س</td>
                  <td style={S.td}><span style={{ fontSize: 11, fontWeight: 700, color: r.status === 'paid' ? 'var(--success-text)' : 'var(--warning-text)' }}>{r.status === 'paid' ? 'تم التحويل' : 'متوقّع'}</span></td>
                  <td style={{ ...S.td, color: 'var(--text3)', fontSize: 12 }}>{r.note || '—'}</td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {r.status !== 'paid' && <button style={{ ...S.miniBtn, color: 'var(--success-text)', borderColor: 'var(--success-text)' }} onClick={() => markPaid(r.id)}>تم</button>}
                      <button style={{ ...S.miniBtn, color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => del(r.id)}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function EntryView({ merchants }: { merchants: any[] }) {
  const today = new Date().toISOString().split('T')[0]
  const blank = { merchant_code: '', platform: 'trendyol', data_date: today, total_sales: '', order_count: '', platform_fees: '', ad_spend: '', margin: '' }
  const [form, setForm] = useState(blank)
  const [rows, setRows] = useState<typeof blank[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [log, setLog] = useState<{ date: string; merchant: string; platform: string; sales: number }[]>([])

  function f(k: keyof typeof blank, v: string) { setForm(p => ({ ...p, [k]: v })) }

  function addRow() {
    if (!form.merchant_code || !form.total_sales || !form.order_count) {
      setMsg({ type: 'err', text: 'التاجر والمبيعات وعدد الطلبات مطلوبة' }); return
    }
    setRows(p => [...p, { ...form }])
    setForm(p => ({ ...p, total_sales: '', order_count: '', platform_fees: '', ad_spend: '', margin: '' }))
    setMsg(null)
  }

  function removeRow(i: number) { setRows(p => p.filter((_, idx) => idx !== i)) }

  async function submit() {
    const toSave = rows.length > 0 ? rows : (form.merchant_code && form.total_sales && form.order_count ? [form] : null)
    if (!toSave) { setMsg({ type: 'err', text: 'أضف سجلاً واحداً على الأقل' }); return }
    setSaving(true); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manual-entry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: toSave }),
      })
      const data = await res.json()
      if (data.error) { setMsg({ type: 'err', text: data.error }); return }
      setMsg({ type: 'ok', text: `✅ تم حفظ ${data.inserted} سجل بنجاح` })
      setLog(p => [...toSave.map(r => ({
        date: r.data_date,
        merchant: merchants.find(m => m.merchant_code === r.merchant_code)?.name || r.merchant_code,
        platform: PLATFORM_MAP[r.platform] || r.platform,
        sales: Number(r.total_sales),
      })), ...p].slice(0, 50))
      setRows([])
      setForm(blank)
    } finally { setSaving(false) }
  }

  const merchantName = (code: string) => merchants.find(m => m.merchant_code === code)?.name || code

  return (
    <div>
      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600, background: msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)', border: `1px solid ${msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)'}` }}>
          {msg.text}
        </div>
      )}

      <PayoutEditor merchants={merchants} />

      <div style={{ ...S.chartCard, marginBottom: 20, padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: 'var(--text2)' }}>إضافة سجل أداء يومي</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <label style={S.fieldGroup}>
            <span style={S.fieldLabel}>التاجر *</span>
            <select style={S.input} value={form.merchant_code} onChange={e => f('merchant_code', e.target.value)}>
              <option value="">— اختر التاجر —</option>
              {merchants.map(m => <option key={m.merchant_code} value={m.merchant_code}>{m.name}</option>)}
            </select>
          </label>
          <label style={S.fieldGroup}>
            <span style={S.fieldLabel}>المنصة *</span>
            <select style={S.input} value={form.platform} onChange={e => f('platform', e.target.value)}>
              {ENTRY_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label style={S.fieldGroup}>
            <span style={S.fieldLabel}>التاريخ *</span>
            <input type="date" style={S.input} value={form.data_date} onChange={e => f('data_date', e.target.value)} />
          </label>
          <label style={S.fieldGroup}>
            <span style={S.fieldLabel}>المبيعات (ر.س) *</span>
            <input type="number" min="0" style={S.input} placeholder="0" value={form.total_sales} onChange={e => f('total_sales', e.target.value)} />
          </label>
          <label style={S.fieldGroup}>
            <span style={S.fieldLabel}>عدد الطلبات *</span>
            <input type="number" min="0" style={S.input} placeholder="0" value={form.order_count} onChange={e => f('order_count', e.target.value)} />
          </label>
          <label style={S.fieldGroup}>
            <span style={S.fieldLabel}>رسوم المنصة</span>
            <input type="number" min="0" style={S.input} placeholder="0" value={form.platform_fees} onChange={e => f('platform_fees', e.target.value)} />
          </label>
          <label style={S.fieldGroup}>
            <span style={S.fieldLabel}>إنفاق إعلاني</span>
            <input type="number" min="0" style={S.input} placeholder="0" value={form.ad_spend} onChange={e => f('ad_spend', e.target.value)} />
          </label>
          <label style={S.fieldGroup}>
            <span style={S.fieldLabel}>الهامش</span>
            <input type="number" min="0" style={S.input} placeholder="0" value={form.margin} onChange={e => f('margin', e.target.value)} />
          </label>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button style={{ ...S.btn, background: 'var(--accent)', color: '#fff', flex: 1 }} onClick={addRow}>+ إضافة للقائمة</button>
          <button style={{ ...S.btn, background: 'var(--accent2)', color: '#111', flex: 1 }} onClick={submit} disabled={saving}>
            {saving ? '⟳ جاري الحفظ...' : `💾 حفظ${rows.length > 0 ? ` (${rows.length} سجل)` : ' مباشرة'}`}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div style={{ ...S.chartCard, marginBottom: 20 }}>
          <div style={{ padding: '14px 16px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>سجلات في الانتظار ({rows.length})</span>
            <button style={{ ...S.btn, background: 'var(--accent2)', color: '#111', fontSize: 12 }} onClick={submit} disabled={saving}>{saving ? '⟳' : '💾 حفظ الكل'}</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead><tr>{['التاجر', 'المنصة', 'التاريخ', 'المبيعات', 'الطلبات', 'الرسوم', 'الإعلانات', 'الهامش', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={S.tr}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{merchantName(r.merchant_code)}</td>
                    <td style={S.td}>{PLATFORM_MAP[r.platform] || r.platform}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.data_date}</td>
                    <td style={{ ...S.td, color: 'var(--accent2)', fontWeight: 700 }}>{Number(r.total_sales).toLocaleString()}</td>
                    <td style={S.td}>{r.order_count}</td>
                    <td style={S.td}>{r.platform_fees || '—'}</td>
                    <td style={S.td}>{r.ad_spend || '—'}</td>
                    <td style={S.td}>{r.margin || '—'}</td>
                    <td style={S.td}><button style={{ ...S.miniBtn, color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => removeRow(i)}>حذف</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div style={S.chartCard}>
          <div style={{ padding: '14px 16px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>سجل الإدخالات — هذه الجلسة</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead><tr>{['التاريخ', 'التاجر', 'المنصة', 'المبيعات'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {log.map((r, i) => (
                  <tr key={i} style={S.tr}>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{r.date}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{r.merchant}</td>
                    <td style={S.td}>{r.platform}</td>
                    <td style={{ ...S.td, color: 'var(--accent2)', fontWeight: 700 }}>{r.sales.toLocaleString()} ر.س</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
