import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S, fmt } from './adminShared'

const SALLA_SETTING_FIELDS = [
  { key: 'SALLA_CLIENT_ID',      label: 'Client ID',        isSecret: false, placeholder: 'أدخل Client ID من لوحة شركاء سلة',  note: 'عام — يظهر في رابط OAuth' },
  { key: 'SALLA_CLIENT_SECRET',  label: 'Client Secret',    isSecret: true,  placeholder: 'أدخل Client Secret',                  note: 'سري — لا تشاركه' },
  { key: 'SALLA_WEBHOOK_SECRET', label: 'Webhook Secret',   isSecret: true,  placeholder: 'أدخل Webhook Secret',                  note: 'سري — للتحقق من توقيع Webhooks' },
  { key: 'APP_URL',              label: 'App URL',           isSecret: false, placeholder: 'https://sellpert.vercel.app',          note: 'رابط واجهة Sellpert' },
  { key: 'salla_app_store_url',  label: 'متجر تطبيقات سلة', isSecret: false, placeholder: 'https://salla.sa/apps/sellpert',        note: 'رابط التطبيق في متجر سلة' },
]

const PLAN_DEFAULTS = [
  { key: 'salla',      label: 'باقة سلة',       price: 99  },
  { key: 'growth',     label: 'باقة النمو',      price: 299 },
  { key: 'pro',        label: 'باقة المحترف',    price: 599 },
  { key: 'enterprise', label: 'المؤسسات',        price: 999 },
]

const PLAN_COLORS: Record<string, string> = { salla: '#7c6bff', growth: '#00e5b0', pro: '#ff9900', enterprise: '#f27a1a' }
const STATUS_COLORS: Record<string, string> = { active: '#00e5b0', suspended: '#ff4d6d', cancelled: '#ffd166' }

function SallaAppSettings() {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

  type SettingEntry = { value: string; editing: boolean; draft: string; saving: boolean; revealed: boolean }
  const [settings, setSettings] = useState<Record<string, SettingEntry>>({})
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [plans, setPlans]               = useState(PLAN_DEFAULTS)
  const [editPlanKey, setEditPlanKey]   = useState<string | null>(null)
  const [editPlanPrice, setEditPlanPrice] = useState('')
  const [savingPlan, setSavingPlan]     = useState(false)
  const [copied, setCopied]             = useState<string | null>(null)
  const [msg, setMsg]                   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { loadSettings() }, [])

  async function loadSettings() {
    setLoadingSettings(true)
    const { data } = await supabase.from('app_settings').select('key, value, is_secret')
    const map: Record<string, SettingEntry> = {}
    SALLA_SETTING_FIELDS.forEach(f => {
      const row = data?.find(r => r.key === f.key)
      map[f.key] = { value: row?.value || '', editing: false, draft: '', saving: false, revealed: false }
    })
    const updatedPlans = PLAN_DEFAULTS.map(p => {
      const row = data?.find(r => r.key === `plan_price_${p.key}`)
      return row?.value ? { ...p, price: parseInt(row.value, 10) } : p
    })
    setSettings(map)
    setPlans(updatedPlans)
    setLoadingSettings(false)
  }

  function patchSetting(key: string, patch: Partial<SettingEntry>) {
    setSettings(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function saveSetting(key: string) {
    const s = settings[key]
    if (!s) return
    patchSetting(key, { saving: true })
    const { error } = await supabase.from('app_settings').upsert({
      key, value: s.draft,
      is_secret: SALLA_SETTING_FIELDS.find(f => f.key === key)?.isSecret || false,
      updated_at: new Date().toISOString(),
    })
    if (error) showMsg('err', 'خطأ في الحفظ: ' + error.message)
    else { patchSetting(key, { value: s.draft, editing: false, saving: false }); showMsg('ok', `✅ تم حفظ ${SALLA_SETTING_FIELDS.find(f => f.key === key)?.label}`) }
    patchSetting(key, { saving: false })
  }

  async function savePlanPrice(planKey: string) {
    const price = parseInt(editPlanPrice, 10)
    if (isNaN(price) || price < 1) { showMsg('err', 'يرجى إدخال سعر صحيح'); return }
    setSavingPlan(true)
    await supabase.from('app_settings').upsert({ key: `plan_price_${planKey}`, value: String(price), is_secret: false })
    setPlans(prev => prev.map(p => p.key === planKey ? { ...p, price } : p))
    setSavingPlan(false)
    setEditPlanKey(null)
    showMsg('ok', `✅ تم تحديث سعر ${PLAN_DEFAULTS.find(p => p.key === planKey)?.label}`)
  }

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3000)
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(id); setTimeout(() => setCopied(null), 1500)
  }

  function maskSecret(val: string) {
    if (!val) return ''
    return val.slice(0, 4) + '●●●●●●●●' + val.slice(-3)
  }

  const callbackUrl = `${SUPABASE_URL}/functions/v1/salla-oauth-callback`
  const webhookUrl  = `${SUPABASE_URL}/functions/v1/salla-webhook`

  const urlRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }
  const copyBtnStyle: React.CSSProperties = { flexShrink: 0, padding: '6px 14px', borderRadius: 8, background: 'rgba(124,107,255,0.12)', border: '1px solid rgba(124,107,255,0.3)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }

  const statusDot = (val: string) => val
    ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(0,229,176,0.15)', color: 'var(--accent2)', fontWeight: 700, marginRight: 6 }}>✓ محفوظ</span>
    : <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,77,109,0.12)', color: '#ff4d6d', fontWeight: 700, marginRight: 6 }}>⚠ فارغ</span>

  return (
    <div style={{ ...S.chartCard, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={S.chartTitle}>⚙️ إعدادات تطبيق سلة</div>
          <div style={S.chartSub}>بيانات OAuth والـ Webhooks وأسعار الباقات</div>
        </div>
        <button style={S.refreshBtn} onClick={loadSettings} disabled={loadingSettings}>⟳ تحديث</button>
      </div>

      {msg && (
        <div style={{ margin: '14px 20px 0', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)', color: msg.type === 'ok' ? 'var(--accent2)' : '#ff4d6d', border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.25)' : 'rgba(255,77,109,0.25)'}` }}>
          {msg.text}
        </div>
      )}

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text2)' }}>🔑 بيانات تطبيق سلة</div>
          {loadingSettings ? (
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>جارٍ التحميل...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SALLA_SETTING_FIELDS.map(f => {
                const s = settings[f.key] || { value: '', editing: false, draft: '', saving: false, revealed: false }
                return (
                  <div key={f.key} style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface2)', border: `1px solid ${s.value ? 'rgba(0,229,176,0.2)' : 'var(--border)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: s.editing ? 10 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{f.label}</span>
                        {statusDot(s.value)}
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>— {f.note}</span>
                      </div>
                      {!s.editing && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {s.value && !f.isSecret && (
                            <button style={copyBtnStyle} onClick={() => copy(s.value, f.key)}>{copied === f.key ? '✓ تم' : '📋'}</button>
                          )}
                          {s.value && f.isSecret && (
                            <button style={{ ...copyBtnStyle, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)' }}
                              onClick={() => patchSetting(f.key, { revealed: !s.revealed })}>
                              {s.revealed ? '🙈' : '👁'}
                            </button>
                          )}
                          <button style={{ ...copyBtnStyle, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)' }}
                            onClick={() => patchSetting(f.key, { editing: true, draft: s.value })}>
                            ✏️ {s.value ? 'تعديل' : 'إضافة'}
                          </button>
                        </div>
                      )}
                    </div>

                    {!s.editing && s.value && (
                      <code style={{ display: 'block', marginTop: 6, fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)', wordBreak: 'break-all' }}>
                        {f.isSecret && !s.revealed ? maskSecret(s.value) : s.value}
                      </code>
                    )}

                    {s.editing && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input type={f.isSecret ? 'password' : 'text'} value={s.draft}
                          onChange={e => patchSetting(f.key, { draft: e.target.value })}
                          placeholder={f.placeholder} autoFocus
                          style={{ flex: 1, ...S.input, fontSize: 12, fontFamily: 'monospace' }} />
                        <button onClick={() => saveSetting(f.key)} disabled={s.saving || !s.draft.trim()}
                          style={{ ...S.saveBtn, padding: '8px 16px', fontSize: 12, opacity: (!s.draft.trim() || s.saving) ? 0.6 : 1 }}>
                          {s.saving ? '...' : 'حفظ'}
                        </button>
                        <button onClick={() => patchSetting(f.key, { editing: false })} style={{ ...S.miniBtn, padding: '8px 12px', fontSize: 12 }}>✕</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text2)' }}>🔗 عناوين التكامل — أضفها في لوحة شركاء سلة</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { id: 'callback', label: 'OAuth Callback URL', url: callbackUrl, note: 'Apps → إعدادات التطبيق → Redirect URI' },
              { id: 'webhook',  label: 'Webhook URL',        url: webhookUrl,  note: 'Apps → Webhook Events → Endpoint URL' },
            ].map(({ id, label, url, note }) => (
              <div key={id}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4, fontWeight: 600 }}>{label} <span style={{ fontWeight: 400 }}>— {note}</span></div>
                <div style={urlRowStyle}>
                  <code style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
                  <button style={copyBtnStyle} onClick={() => copy(url, id)}>{copied === id ? '✓ تم النسخ' : '📋 نسخ'}</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text2)' }}>💳 أسعار الباقات (ر.س / شهر)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
            {plans.map(p => (
              <div key={p.key} style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{p.label}</span>
                  {editPlanKey !== p.key && (
                    <button onClick={() => { setEditPlanKey(p.key); setEditPlanPrice(String(p.price)) }}
                      style={{ ...S.miniBtn, fontSize: 11, padding: '3px 10px' }}>✏️</button>
                  )}
                </div>
                {editPlanKey === p.key ? (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input type="number" value={editPlanPrice} onChange={e => setEditPlanPrice(e.target.value)}
                      style={{ width: 80, ...S.input, padding: '5px 8px', fontSize: 13 }} autoFocus />
                    <button onClick={() => savePlanPrice(p.key)} disabled={savingPlan}
                      style={{ ...S.saveBtn, padding: '5px 12px', fontSize: 12 }}>
                      {savingPlan ? '...' : 'حفظ'}
                    </button>
                    <button onClick={() => setEditPlanKey(null)} style={{ ...S.miniBtn, padding: '5px 8px', fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>
                    {p.price} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text3)' }}>ر.س</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

export default function SallaView({ onRefresh }: { onRefresh: () => void }) {
  const [connections, setConnections] = useState<any[]>([])
  const [subscriptions, setSubscriptions] = useState<any[]>([])
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: conns }, { data: subs }, { data: q }] = await Promise.all([
      supabase.from('salla_connections').select('*, merchants(name,email,subscription_status,subscription_plan)').order('installed_at', { ascending: false }),
      supabase.from('subscriptions').select('*').order('created_at', { ascending: false }),
      supabase.from('sync_queue').select('merchant_code,status').in('status', ['pending', 'running', 'failed']),
    ])
    setConnections(conns || [])
    setSubscriptions(subs || [])
    setQueue(q || [])
    setLoading(false)
  }

  async function suspendMerchant(merchantCode: string) {
    const { error } = await supabase.rpc('suspend_merchant', { p_merchant_code: merchantCode, p_reason: 'admin_manual' })
    if (error) setActionMsg({ type: 'err', text: error.message })
    else { setActionMsg({ type: 'ok', text: `تم تعليق التاجر ${merchantCode}` }); load(); onRefresh() }
    setTimeout(() => setActionMsg(null), 3000)
  }

  async function reactivateMerchant(merchantCode: string) {
    const { error } = await supabase.rpc('reactivate_merchant', { p_merchant_code: merchantCode })
    if (error) setActionMsg({ type: 'err', text: error.message })
    else { setActionMsg({ type: 'ok', text: `تم تفعيل التاجر ${merchantCode}` }); load(); onRefresh() }
    setTimeout(() => setActionMsg(null), 3000)
  }

  async function forceSync(merchantCode: string) {
    await supabase.from('sync_queue').insert({
      merchant_code: merchantCode, platform: 'salla', job_type: 'sync_all',
      priority: 1, status: 'pending', scheduled_at: new Date().toISOString(),
    })
    setActionMsg({ type: 'ok', text: `تمت جدولة مزامنة فورية لـ ${merchantCode}` })
    setTimeout(() => setActionMsg(null), 3000)
  }

  const subMap: Record<string, any> = {}
  subscriptions.forEach(s => { subMap[s.merchant_code] = s })

  const queueMap: Record<string, number> = {}
  queue.forEach(q => { queueMap[q.merchant_code] = (queueMap[q.merchant_code] || 0) + 1 })

  const activeCount    = connections.filter(c => !c.uninstalled_at).length
  const suspendedCount = connections.filter(c => (c.merchants as any)?.subscription_status === 'suspended').length
  const totalRevenue   = subscriptions.filter(s => s.status === 'active').reduce((sum: number, s: any) => {
    const p = { salla: 99, growth: 299, pro: 599, enterprise: 999 } as Record<string, number>
    return sum + (p[s.plan] || 99)
  }, 0)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {actionMsg && (
        <div style={{ ...S.msgBox, ...(actionMsg.type === 'ok' ? S.msgOk : S.msgErr) }}>{actionMsg.text}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {[
          { label: 'متاجر سلة المثبّتة', value: activeCount,              color: '#7c6bff', icon: '🟣' },
          { label: 'متاجر معلّقة',        value: suspendedCount,           color: '#ff4d6d', icon: '🚫' },
          { label: 'وظائف في الطابور',   value: queue.length,             color: '#ffd166', icon: '⏳' },
          { label: 'إيراد شهري متكرر',   value: fmt(totalRevenue) + '/شهر', color: '#00e5b0', icon: '💰' },
        ].map((k, i) => (
          <div key={i} style={{ ...S.kpiCard, padding: 18, position: 'relative', overflow: 'hidden' }}>
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: k.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.chartCard, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={S.chartTitle}>🟣 متاجر سلة المربوطة</div>
            <div style={S.chartSub}>{connections.length} متجر — إدارة الاشتراكات والمزامنة</div>
          </div>
          <button style={S.refreshBtn} onClick={load}>⟳ تحديث</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>{['المتجر', 'حالة الاشتراك', 'الباقة', 'آخر مزامنة', 'في الطابور', 'طلبات', 'تثبيت في', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {connections.map(c => {
                const m = c.merchants as any
                const sub = subMap[c.merchant_code]
                const status = m?.subscription_status || 'active'
                const plan   = sub?.plan || 'salla'
                const qCount = queueMap[c.merchant_code] || 0
                const isUninstalled = !!c.uninstalled_at

                return (
                  <tr key={c.id} style={{ ...S.tr, opacity: isUninstalled ? 0.5 : 1 }}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 700 }}>{c.store_name || m?.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {c.store_domain && <span>{c.store_domain} · </span>}
                        <span style={{ fontFamily: 'monospace' }}>{c.merchant_code}</span>
                      </div>
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: (STATUS_COLORS[status] || '#5a5a7a') + '22', color: STATUS_COLORS[status] || 'var(--text3)' }}>
                        {isUninstalled ? '🗑 محذوف' : status === 'active' ? '✓ نشط' : status === 'suspended' ? '⛔ معلّق' : status}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: (PLAN_COLORS[plan] || '#5a5a7a') + '22', color: PLAN_COLORS[plan] || 'var(--text3)' }}>
                        {({ salla: 'باقة سلة', growth: 'نمو', pro: 'محترف', enterprise: 'مؤسسات', free: 'مجاني' } as Record<string, string>)[plan] || plan}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>
                      {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString('ar-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td style={S.td}>
                      {qCount > 0
                        ? <span style={{ color: '#ffd166', fontWeight: 700, fontSize: 13 }}>{qCount}</span>
                        : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}
                    </td>
                    <td style={S.td}>{(c.orders_synced || 0).toLocaleString()}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>
                      {new Date(c.installed_at).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...S.miniBtn, fontSize: 11 }} onClick={() => forceSync(c.merchant_code)} title="مزامنة فورية">⟳</button>
                        {status === 'active' ? (
                          <button style={{ ...S.miniBtn, fontSize: 11, color: '#ff4d6d', borderColor: '#ff4d6d44' }} onClick={() => suspendMerchant(c.merchant_code)}>تعليق</button>
                        ) : (
                          <button style={{ ...S.miniBtn, fontSize: 11, color: 'var(--accent2)', borderColor: 'rgba(0,229,176,0.3)' }} onClick={() => reactivateMerchant(c.merchant_code)}>تفعيل</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <SallaAppSettings />
    </div>
  )
}
