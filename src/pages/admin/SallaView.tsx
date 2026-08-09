import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import { Settings, KeyRound, Link2, RefreshCw, Copy, Pencil, X, Store, PauseCircle, ListTodo, CircleX } from 'lucide-react'
import { adminIntegrationRequest, loadAdminIntegrationStatus } from '../../lib/adminIntegrationSettings'

const SALLA_SETTING_FIELDS = [
  { key: 'SALLA_CLIENT_ID',      label: 'Client ID',        isSecret: false, placeholder: 'أدخل Client ID من لوحة شركاء سلة',  note: 'عام — يظهر في رابط OAuth' },
  { key: 'SALLA_CLIENT_SECRET',  label: 'Client Secret',    isSecret: true,  placeholder: 'أدخل Client Secret',                  note: 'سري — لا تشاركه' },
  { key: 'SALLA_WEBHOOK_SECRET', label: 'Webhook Secret',   isSecret: true,  placeholder: 'أدخل Webhook Secret',                  note: 'سري — للتحقق من توقيع Webhooks' },
  { key: 'APP_URL',              label: 'App URL',           isSecret: false, placeholder: 'https://sellpert.vercel.app',          note: 'رابط واجهة Sellpert' },
  { key: 'salla_app_store_url',  label: 'متجر تطبيقات سلة', isSecret: false, placeholder: 'https://salla.sa/apps/sellpert',        note: 'رابط التطبيق في متجر سلة' },
]

const STATUS_COLORS: Record<string, string> = { active: '#00e5b0', suspended: '#ff4d6d', cancelled: '#ffd166' }

function SallaAppSettings() {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

  type SettingEntry = { value: string; configured: boolean; editing: boolean; draft: string; saving: boolean }
  const [settings, setSettings] = useState<Record<string, SettingEntry>>({})
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [copied, setCopied]             = useState<string | null>(null)
  const [msg, setMsg]                   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Load settings once when the Salla manager mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSettings() }, [])

  async function loadSettings() {
    setLoadingSettings(true)
    let data: Awaited<ReturnType<typeof loadAdminIntegrationStatus>>['settings'] = {}
    try { data = (await loadAdminIntegrationStatus()).settings }
    catch (error: any) { showMsg('err', error.message) }
    const map: Record<string, SettingEntry> = {}
    SALLA_SETTING_FIELDS.forEach(f => {
      const row = data[f.key]
      map[f.key] = { value: row?.value || '', configured: Boolean(row?.configured), editing: false, draft: '', saving: false }
    })
    setSettings(map)
    setLoadingSettings(false)
  }

  function patchSetting(key: string, patch: Partial<SettingEntry>) {
    setSettings(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function saveSetting(key: string) {
    const s = settings[key]
    if (!s) return
    patchSetting(key, { saving: true })
    const field = SALLA_SETTING_FIELDS.find(f => f.key === key)
    try {
      await adminIntegrationRequest({ action: 'save_setting', key, value: s.draft })
      patchSetting(key, { value: field?.isSecret ? '' : s.draft, configured: true, draft: '', editing: false, saving: false })
      showMsg('ok', `تم حفظ ${field?.label}`)
    } catch (error: any) { showMsg('err', 'خطأ في الحفظ: ' + error.message) }
    patchSetting(key, { saving: false })
  }

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3000)
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(id); setTimeout(() => setCopied(null), 1500)
  }

  const callbackUrl = `${SUPABASE_URL}/functions/v1/salla-oauth-callback`
  const webhookUrl  = `${SUPABASE_URL}/functions/v1/salla-webhook`

  const urlRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }
  const copyBtnStyle: React.CSSProperties = { flexShrink: 0, padding: '6px 14px', borderRadius: 8, background: 'rgba(15,149,140,0.12)', border: '1px solid rgba(15,149,140,0.3)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }

  const statusDot = (configured: boolean) => configured
    ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--success-bg)', color: 'var(--success-text)', fontWeight: 700, marginRight: 6 }}>محفوظ</span>
    : <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontWeight: 700, marginRight: 6 }}>غير مكتمل</span>

  return (
    <div style={{ ...S.chartCard, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ ...S.chartTitle, display: 'flex', alignItems: 'center', gap: 7 }}><Settings size={16} /> إعدادات تطبيق سلة</div>
          <div style={S.chartSub}>بيانات OAuth وعناوين Webhooks اللازمة للتكامل.</div>
        </div>
        <button style={{ ...S.refreshBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={loadSettings} disabled={loadingSettings}><RefreshCw size={14} /> تحديث</button>
      </div>

      {msg && (
        <div style={{ margin: '14px 20px 0', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--danger-text)', border: `1px solid ${msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)'}` }}>
          {msg.text}
        </div>
      )}

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 7 }}><KeyRound size={15} /> بيانات تطبيق سلة</div>
          {loadingSettings ? (
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>جارٍ التحميل...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SALLA_SETTING_FIELDS.map(f => {
                const s = settings[f.key] || { value: '', configured: false, editing: false, draft: '', saving: false }
                return (
                  <div key={f.key} style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface2)', border: `1px solid ${s.configured ? 'var(--success-bg)' : 'var(--border)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: s.editing ? 10 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{f.label}</span>
                        {statusDot(s.configured)}
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>— {f.note}</span>
                      </div>
                      {!s.editing && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {s.configured && !f.isSecret && (
                            <button style={copyBtnStyle} onClick={() => copy(s.value, f.key)}>{copied === f.key ? 'تم النسخ' : <Copy size={13} />}</button>
                          )}
                          <button style={{ ...copyBtnStyle, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)' }}
                            onClick={() => patchSetting(f.key, { editing: true, draft: f.isSecret ? '' : s.value })}>
                            <Pencil size={13} /> {s.configured ? 'تدوير' : 'إضافة'}
                          </button>
                        </div>
                      )}
                    </div>

                    {!s.editing && s.configured && (
                      <code style={{ display: 'block', marginTop: 6, fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)', wordBreak: 'break-all' }}>
                        {f.isSecret ? 'محفوظ بأمان — لا يمكن عرضه بعد الحفظ' : s.value}
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
                        <button onClick={() => patchSetting(f.key, { editing: false })} style={{ ...S.miniBtn, padding: '8px 12px', fontSize: 12 }} aria-label="إلغاء"><X size={14} /></button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 7 }}><Link2 size={15} /> عناوين التكامل — أضفها في لوحة شركاء سلة</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { id: 'callback', label: 'OAuth Callback URL', url: callbackUrl, note: 'Apps → إعدادات التطبيق → Redirect URI' },
              { id: 'webhook',  label: 'Webhook URL',        url: webhookUrl,  note: 'Apps → Webhook Events → Endpoint URL' },
            ].map(({ id, label, url, note }) => (
              <div key={id}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4, fontWeight: 600 }}>{label} <span style={{ fontWeight: 400 }}>— {note}</span></div>
                <div style={urlRowStyle}>
                  <code style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
                  <button style={{ ...copyBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => copy(url, id)}>{copied === id ? 'تم النسخ' : <><Copy size={13} /> نسخ</>}</button>
                </div>
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
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: conns }, { data: q }] = await Promise.all([
      supabase.from('salla_connections').select('id,merchant_code,salla_store_id,salla_merchant_id,store_name,store_domain,store_currency,store_country,store_logo,token_expires_at,scope,installed_at,uninstalled_at,last_sync_at,sync_status,orders_synced,products_synced,created_at,updated_at,merchants(name,email,subscription_status)').order('installed_at', { ascending: false }),
      supabase.from('sync_queue').select('merchant_code,status').in('status', ['pending', 'running', 'failed']),
    ])
    setConnections(conns || [])
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

  const queueMap: Record<string, number> = {}
  queue.forEach(q => { queueMap[q.merchant_code] = (queueMap[q.merchant_code] || 0) + 1 })

  const activeCount    = connections.filter(c => !c.uninstalled_at).length
  const suspendedCount = connections.filter(c => (c.merchants as any)?.subscription_status === 'suspended').length
  const failedCount = queue.filter(q => q.status === 'failed').length

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        {[
          { label: 'متاجر سلة المربوطة', value: activeCount,    color: '#0f958c', Icon: Store },
          { label: 'وصول معلّق',         value: suspendedCount, color: '#ff4d6d', Icon: PauseCircle },
          { label: 'وظائف قيد المعالجة', value: queue.length,   color: '#9c6700', Icon: ListTodo },
          { label: 'وظائف فاشلة',        value: failedCount,    color: '#d12f3f', Icon: CircleX },
        ].map((k, i) => (
          <div key={i} style={{ ...S.kpiCard, padding: 18, position: 'relative', overflow: 'hidden' }}>
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: k.color + '22', color: k.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><k.Icon size={16} /></span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.chartCard, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ ...S.chartTitle, display: 'flex', alignItems: 'center', gap: 7 }}><Store size={16} /> متاجر سلة المربوطة</div>
            <div style={S.chartSub}>{connections.length} متجر — متابعة الاتصال والمزامنة.</div>
          </div>
          <button style={{ ...S.refreshBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={load}><RefreshCw size={14} /> تحديث</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>{['المتجر', 'حالة الوصول', 'آخر مزامنة', 'في الطابور', 'طلبات', 'تثبيت في', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {connections.map(c => {
                const m = c.merchants as any
                const status = m?.subscription_status || 'active'
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
                        {isUninstalled ? 'تم إلغاء الربط' : status === 'active' ? 'نشط' : status === 'suspended' ? 'معلّق' : status}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>
                      {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString('ar-SA-u-nu-latn', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td style={S.td}>
                      {qCount > 0
                        ? <span style={{ color: 'var(--warning-text)', fontWeight: 700, fontSize: 13 }}>{qCount}</span>
                        : <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>}
                    </td>
                    <td style={S.td}>{(c.orders_synced || 0).toLocaleString()}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>
                      {new Date(c.installed_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...S.miniBtn, fontSize: 11, display: 'inline-flex', alignItems: 'center' }} onClick={() => forceSync(c.merchant_code)} title="مزامنة فورية"><RefreshCw size={13} /></button>
                        {status === 'active' ? (
                          <button style={{ ...S.miniBtn, fontSize: 11, color: 'var(--danger-text)', borderColor: 'var(--danger-bg)' }} onClick={() => suspendMerchant(c.merchant_code)}>تعليق</button>
                        ) : (
                          <button style={{ ...S.miniBtn, fontSize: 11, color: 'var(--accent2)', borderColor: 'var(--success-bg)' }} onClick={() => reactivateMerchant(c.merchant_code)}>تفعيل</button>
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
