import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Bell, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { toastOk, toastErr } from './Toast'
import { PLATFORM_MAP } from '../lib/constants'

interface Alert {
  id: string
  merchant_code: string
  platform: string | null
  monthly_limit: number
  alert_at_pct: number
  is_active: boolean
  last_triggered_at: string | null
  current_spend?: number
  current_pct?: number
}

interface Props { merchantCode: string }

export default function BudgetAlertsPanel({ merchantCode }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ platform: 'all', monthly_limit: 5000, alert_at_pct: 80 })

  useEffect(() => { load() }, [merchantCode])

  async function load() {
    setLoading(true)
    const [{ data: ba }, spendByPlat] = await Promise.all([
      supabase.from('budget_alerts').select('*').eq('merchant_code', merchantCode).order('created_at', { ascending: false }),
      currentMonthSpend(merchantCode),
    ])

    const enriched = (ba || []).map((a: Alert) => {
      const spend = a.platform ? (spendByPlat[a.platform] || 0) : Object.values(spendByPlat).reduce((s, v) => s + v, 0)
      const pct = a.monthly_limit > 0 ? (spend / a.monthly_limit) * 100 : 0
      return { ...a, current_spend: spend, current_pct: pct }
    })
    setAlerts(enriched)
    setLoading(false)
  }

  async function currentMonthSpend(code: string): Promise<Record<string, number>> {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0)
    const { data } = await supabase.from('ad_metrics').select('platform,spend')
      .eq('merchant_code', code).gte('report_date', start.toISOString().slice(0, 10))
    const out: Record<string, number> = {}
    for (const r of data || []) {
      out[r.platform] = (out[r.platform] || 0) + (r.spend || 0)
    }
    return out
  }

  async function addAlert() {
    if (form.monthly_limit <= 0) { toastErr('الميزانية يجب أن تكون أكبر من صفر'); return }
    const { error } = await supabase.from('budget_alerts').insert({
      merchant_code: merchantCode,
      platform: form.platform === 'all' ? null : form.platform,
      monthly_limit: form.monthly_limit,
      alert_at_pct: form.alert_at_pct,
      is_active: true,
    })
    if (error) toastErr(error.message)
    else {
      toastOk('تم إنشاء تنبيه الميزانية')
      setShowAdd(false)
      setForm({ platform: 'all', monthly_limit: 5000, alert_at_pct: 80 })
      load()
    }
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from('budget_alerts').update({ is_active: !active }).eq('id', id)
    load()
  }

  async function remove(id: string) {
    if (!confirm('حذف هذا التنبيه؟')) return
    await supabase.from('budget_alerts').delete().eq('id', id)
    toastOk('تم الحذف')
    load()
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={16} color="var(--accent)" />
          <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', margin: 0 }}>تنبيهات الميزانية الإعلانية</h3>
        </div>
        <button onClick={() => setShowAdd(s => !s)} style={addBtnStyle}>
          <Plus size={14} /> إضافة
        </button>
      </div>

      {showAdd && (
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, marginBottom: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelStyle}>المنصة</label>
              <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} style={inputStyle}>
                <option value="all">الكل</option>
                {Object.entries(PLATFORM_MAP).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>الميزانية الشهرية (ر.س)</label>
              <input type="number" value={form.monthly_limit} onChange={e => setForm({ ...form, monthly_limit: parseFloat(e.target.value || '0') })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>تنبيه عند % من الميزانية</label>
              <input type="number" min="1" max="100" value={form.alert_at_pct} onChange={e => setForm({ ...form, alert_at_pct: parseInt(e.target.value || '80', 10) })} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAdd(false)} style={cancelBtnStyle}>إلغاء</button>
            <button onClick={addAlert} style={saveBtnStyle}>حفظ</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>جاري التحميل...</div>
      ) : alerts.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          لا توجد تنبيهات. أضف تنبيهاً لتلقي إشعار عند اقتراب صرفك من الحد.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map(a => {
            const pct = a.current_pct || 0
            const overLimit = pct >= 100
            const warning = pct >= a.alert_at_pct
            const platLabel = a.platform ? (PLATFORM_MAP[a.platform] || a.platform) : 'كل المنصات'
            const barColor = overLimit ? '#e84040' : warning ? '#f0a800' : '#00b894'
            return (
              <div key={a.id} style={{
                background: 'var(--surface2)', borderRadius: 10, padding: 12,
                border: warning ? `1px solid ${barColor}40` : '1px solid var(--border)',
                opacity: a.is_active ? 1 : 0.5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {warning && <AlertTriangle size={14} color={barColor} />}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{platLabel}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                        تنبيه عند {a.alert_at_pct}% من {a.monthly_limit.toLocaleString('en-US')} ر.س
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => toggleActive(a.id, a.is_active)} style={{
                      ...iconBtnStyle, color: a.is_active ? 'var(--accent)' : 'var(--text3)',
                    }} title={a.is_active ? 'إيقاف' : 'تفعيل'}>
                      {a.is_active ? '🔔' : '🔕'}
                    </button>
                    <button onClick={() => remove(a.id)} style={{ ...iconBtnStyle, color: '#e84040' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                    {(a.current_spend || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ر.س
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>/</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {a.monthly_limit.toLocaleString('en-US')} ر.س
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: barColor, marginRight: 'auto' }}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: Math.min(pct, 100) + '%',
                    background: barColor, transition: 'width 0.4s',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 10, color: 'var(--text3)', marginBottom: 4, fontWeight: 600 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit' }
const addBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--accent)', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const saveBtnStyle: React.CSSProperties = { background: 'var(--accent)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const cancelBtnStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const iconBtnStyle: React.CSSProperties = { width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }
