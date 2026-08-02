import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, KeyRound, Loader2, PlugZap, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Merchant } from '../../lib/supabase'
import { S } from './adminShared'
import TrendyolActionCenter from '../../components/TrendyolActionCenter'

type Platform = 'amazon' | 'noon' | 'trendyol'
type FormState = {
  seller_id: string
  api_key: string
  api_secret: string
  refresh_token: string
  marketplace_id: string
  endpoint: string
  service_account: string
  token_endpoint: string
  orders_endpoint: string
}
type CredentialStatus = {
  id: string
  merchant_code: string
  platform: Platform
  seller_id: string | null
  is_active: boolean
  test_status: string | null
  last_tested_at: string | null
  last_sync_at: string | null
  records_synced: number | null
  configured: boolean
}

const EMPTY_FORM: FormState = {
  seller_id: '', api_key: '', api_secret: '', refresh_token: '',
  marketplace_id: 'A17E79C6D8DWNP', endpoint: 'https://sellingpartnerapi-eu.amazon.com',
  service_account: '', token_endpoint: 'https://idp.noon.partners/token',
  orders_endpoint: 'https://api.noon.partners/seller/v1/order',
}

const PLATFORM_META: Record<Platform, { label: string; icon: string; color: string; description: string }> = {
  amazon: { label: 'Amazon', icon: '📦', color: '#ff9900', description: 'تفويض آمن عبر حساب البائع في Amazon' },
  noon: { label: 'نون', icon: '🟡', color: '#f2cf00', description: 'تفويض آمن عبر حساب الشريك في نون' },
  trendyol: { label: 'Trendyol', icon: '🟠', color: '#f27a1a', description: 'معرّف المورّد ومفاتيح Partner API' },
}

type MarketplaceConnectionsProps = {
  merchants: Merchant[]
  lockedMerchantCode?: string
  compactHeader?: boolean
}

export default function MarketplaceConnections({ merchants, lockedMerchantCode, compactHeader = false }: MarketplaceConnectionsProps) {
  const [merchantCode, setMerchantCode] = useState(lockedMerchantCode || merchants[0]?.merchant_code || '')
  const [rows, setRows] = useState<CredentialStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const loadCredentials = useCallback(async () => {
    setLoading(true)
    try {
      const data = await callManager({ action: 'list', merchant_code: lockedMerchantCode })
      if (data.error) throw new Error(data.error)
      setRows(data.credentials || [])
    } catch (error: any) {
      setNotice({ type: 'err', text: error.message || 'تعذر تحميل روابط المنصات' })
    } finally {
      setLoading(false)
    }
  }, [lockedMerchantCode])

  useEffect(() => {
    if (lockedMerchantCode) setMerchantCode(lockedMerchantCode)
  }, [lockedMerchantCode])

  useEffect(() => { void loadCredentials() }, [loadCredentials])

  useEffect(() => {
    if (!merchantCode) return
    const params = new URLSearchParams(window.location.search)
    const amazonCallback = params.get('amazon_callback_uri')
    const amazonState = params.get('amazon_state')
    if (!amazonCallback || !amazonState) return
    const flowKey = `amazon-oauth:${amazonState}`
    if (sessionStorage.getItem(flowKey)) return
    sessionStorage.setItem(flowKey, '1')
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketplace-oauth`, {
          method: 'POST', headers: functionHeaders(session?.access_token),
          body: JSON.stringify({
            platform: 'amazon', merchant_code: merchantCode,
            amazon_callback_uri: amazonCallback,
            amazon_state: amazonState,
            selling_partner_id: params.get('selling_partner_id'),
            version: params.get('version'),
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.authorization_url) throw new Error(data.error || 'تعذر متابعة تفويض Amazon')
        window.location.assign(data.authorization_url)
      } catch (error: any) {
        sessionStorage.removeItem(flowKey)
        setNotice({ type: 'err', text: error.message })
      }
    })()
  }, [merchantCode])

  const selectedRows = useMemo(() => {
    const map = new Map<Platform, CredentialStatus>()
    for (const row of rows) if (row.merchant_code === merchantCode) map.set(row.platform, row)
    return map
  }, [merchantCode, rows])

  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ ...S.tableCard, padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16 }}>
              <PlugZap size={18} color="var(--accent)" /> ربط منصات البيع
            </div>
            <div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 5 }}>
              {lockedMerchantCode ? 'اربط حساباتك مباشرة. المفاتيح تُحفظ مشفرة ولا تُعرض مجددًا.' : 'اختر التاجر ثم اربط حسابه. المفاتيح تُحفظ مشفرة ولا تُعرض مجددًا.'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!lockedMerchantCode && !compactHeader ? <select style={{ ...S.input, width: 260 }} value={merchantCode} onChange={event => setMerchantCode(event.target.value)}>
              {merchants.map(merchant => <option key={merchant.merchant_code} value={merchant.merchant_code}>{merchant.name} — {merchant.merchant_code}</option>)}
            </select> : null}
            <button style={S.miniBtn} onClick={() => void loadCredentials()} disabled={loading} title="تحديث">
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {notice ? (
        <div style={{ ...S.msgBox, ...(notice.type === 'err' ? S.msgErr : S.msgOk), marginBottom: 16 }}>
          {notice.text}
          <button style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', marginRight: 10 }} onClick={() => setNotice(null)}>✕</button>
        </div>
      ) : null}

      {!merchantCode ? (
        <div style={{ ...S.tableCard, padding: 30, textAlign: 'center', color: 'var(--text3)' }}>أضف تاجرًا أولًا لبدء الربط.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
          {((lockedMerchantCode ? ['trendyol'] : ['amazon', 'noon', 'trendyol']) as Platform[]).map(platform => (
            <PlatformCard
              key={`${merchantCode}-${platform}`}
              platform={platform}
              merchantCode={merchantCode}
              status={selectedRows.get(platform) || null}
              onChanged={loadCredentials}
              setNotice={setNotice}
              showAdvancedActions={!lockedMerchantCode}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function PlatformCard({ platform, merchantCode, status, onChanged, setNotice, showAdvancedActions }: {
  platform: Platform
  merchantCode: string
  status: CredentialStatus | null
  onChanged: () => Promise<void>
  setNotice: (notice: { type: 'ok' | 'err'; text: string } | null) => void
  showAdvancedActions: boolean
}) {
  const meta = PLATFORM_META[platform]
  const [editing, setEditing] = useState(!status)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | 'sync' | null>(null)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  const [syncJob, setSyncJob] = useState<{ status: string; error_message?: string | null; created_at?: string | null; started_at?: string | null } | null>(null)
  const [syncDetails, setSyncDetails] = useState<any>(null)
  const [showActions, setShowActions] = useState(false)

  const syncInProgress = ['pending', 'processing', 'running'].includes(syncJob?.status || '')
  const syncProcessing = syncJob?.status === 'processing' || syncJob?.status === 'running'

  useEffect(() => {
    setEditing(!status)
    setVerified(false)
    setForm({ ...EMPTY_FORM, seller_id: status?.seller_id || '' })
  }, [merchantCode, status])

  useEffect(() => {
    if (platform !== 'trendyol' || !status?.is_active) { setSyncJob(null); return }
    let cancelled = false
    let wasInProgress = false
    const poll = async () => {
      try {
        const data = await callManager({ action: 'sync-status', merchant_code: merchantCode, platform })
        if (cancelled || data.error) return
        const active = ['pending', 'processing', 'running'].includes(data.job?.status || '')
        setSyncJob(data.job || null)
        setSyncDetails(data.log?.details || null)
        if (wasInProgress && !active) await onChanged()
        wasInProgress = active
      } catch { /* keep the last visible state and retry */ }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 4000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [merchantCode, platform, status?.is_active, onChanged])

  function update(field: keyof FormState, value: string) {
    setVerified(false)
    setForm(current => ({ ...current, [field]: value }))
  }

  async function testConnection() {
    setBusy('test'); setNotice(null)
    try {
      const payload = testPayload(platform, form)
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-platform-connection`, {
        method: 'POST',
        headers: functionHeaders(session?.access_token),
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'فشل اختبار الاتصال')
      setVerified(true)
      setNotice({ type: 'ok', text: `${meta.label}: تم اختبار الاتصال بنجاح. اضغط حفظ وتفعيل.` })
    } catch (error: any) {
      setVerified(false)
      setNotice({ type: 'err', text: `${meta.label}: ${error.message}` })
    } finally { setBusy(null) }
  }

  async function requestSync() {
    setBusy('sync'); setNotice(null)
    try {
      const data = await callManager({ action: 'sync', merchant_code: merchantCode, platform })
      if (data.error) throw new Error(data.error)
      setSyncJob({ status: 'pending' })
      setNotice({
        type: 'ok',
        text: data.already_queued
          ? `${meta.label}: المزامنة موجودة بالفعل في الطابور.`
          : `${meta.label}: تمت جدولة المزامنة — ستظهر البيانات خلال دقيقة.`,
      })
    } catch (error: any) {
      setNotice({ type: 'err', text: `${meta.label}: تعذر بدء المزامنة — ${error.message || 'حاول مرة أخرى'}` })
    } finally { setBusy(null) }
  }

  async function save() {
    setBusy('save'); setNotice(null)
    try {
      const data = await callManager({
        action: 'save', merchant_code: merchantCode, platform,
        credentials: form, verified,
      })
      if (data.error) throw new Error(data.error)
      setNotice({ type: verified ? 'ok' : 'err', text: verified ? `${meta.label}: تم الحفظ والتفعيل.` : `${meta.label}: تم الحفظ كغير نشط حتى ينجح اختبار الاتصال.` })
      setEditing(false)
      await onChanged()
    } catch (error: any) {
      setNotice({ type: 'err', text: `${meta.label}: ${error.message}` })
    } finally { setBusy(null) }
  }

  async function remove() {
    if (!window.confirm(`حذف ربط ${meta.label} لهذا التاجر؟`)) return
    setBusy('delete'); setNotice(null)
    try {
      const data = await callManager({ action: 'delete', merchant_code: merchantCode, platform })
      if (data.error) throw new Error(data.error)
      setNotice({ type: 'ok', text: `تم حذف ربط ${meta.label}.` })
      await onChanged()
    } catch (error: any) {
      setNotice({ type: 'err', text: error.message })
    } finally { setBusy(null) }
  }

  async function connectWithOAuth() {
    setOauthBusy(true); setNotice(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketplace-oauth`, {
        method: 'POST',
        headers: functionHeaders(session?.access_token),
        body: JSON.stringify({ platform, merchant_code: merchantCode }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.authorization_url) throw new Error(data.error || 'تعذر بدء التفويض')
      window.location.assign(data.authorization_url)
    } catch (error: any) {
      setNotice({ type: 'err', text: `${meta.label}: ${error.message}` })
      setOauthBusy(false)
    }
  }

  return (
    <article style={{ background: 'var(--surface)', border: `1px solid ${status?.is_active ? meta.color + '66' : 'var(--border)'}`, borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <div style={{ height: 3, background: status?.is_active ? meta.color : 'var(--border2)' }} />
      <div style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 12, background: meta.color + '18', fontSize: 22 }}>{meta.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong>{meta.label}</strong>
              <StatusBadge status={status} color={meta.color} />
            </div>
            <div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 4 }}>{meta.description}</div>
          </div>
        </div>

        {platform !== 'trendyol' ? (
          <div>
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 12, lineHeight: 1.8, marginBottom: 14, color: 'var(--text2)' }}>
              {status?.is_active
                ? 'الحساب مفوّض ومتصل. يمكنك إعادة التفويض إذا تغيّرت الصلاحيات أو تم إلغاؤها من المنصة.'
                : `سيتم تحويلك إلى ${meta.label} لتسجيل الدخول والموافقة. لا نطلب منك أي مفاتيح أو كلمات مرور.`}
            </div>
            {status ? (
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, fontSize: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}><span style={{ color: 'var(--text3)' }}>حالة الربط</span><strong>{status.is_active ? 'متصل' : 'بانتظار التفويض'}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>آخر مزامنة</span><span>{formatDate(status.last_sync_at)}</span></div>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...S.saveBtn, flex: 1, justifyContent: 'center' }} onClick={() => void connectWithOAuth()} disabled={oauthBusy}>
                {oauthBusy ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />}
                {status?.is_active ? 'إعادة تفويض الحساب' : `ربط حساب ${meta.label}`}
              </button>
              {status ? <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => void remove()} disabled={!!busy}><Trash2 size={13} /></button> : null}
            </div>
          </div>
        ) : !editing && status ? (
          <div>
            <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, fontSize: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}><span style={{ color: 'var(--text3)' }}>{platform === 'trendyol' ? 'معرّف البائع (معرّف الكيان)' : 'Seller ID'}</span><code>{status.seller_id}</code></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}><span style={{ color: 'var(--text3)' }}>آخر اختبار</span><span>{formatDate(status.last_tested_at)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}><span style={{ color: 'var(--text3)' }}>آخر مزامنة</span><span>{formatDate(status.last_sync_at)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text3)' }}>حالة المزامنة</span>
                <strong style={{ color: syncInProgress ? 'var(--warning-text)' : syncJob?.status === 'done' ? 'var(--success-text)' : syncJob?.status === 'failed' ? 'var(--danger-text)' : 'var(--text3)' }}>
                  {syncJob?.status === 'pending' ? '⏳ المزامنة في الطابور' : syncProcessing ? '⟳ جارٍ مزامنة بيانات ترنديول' : syncJob?.status === 'done' ? '✓ اكتملت مزامنة ترنديول' : syncJob?.status === 'failed' ? '✕ فشلت مزامنة ترنديول' : 'لم تبدأ بعد'}
                </strong>
              </div>
              {syncInProgress ? (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: `${meta.color}0D`, border: `1px solid ${meta.color}35` }}>
                  <style>{`@keyframes trendyol-sync-progress{0%{transform:translateX(0)}100%{transform:translateX(260%)}}`}</style>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8, fontWeight: 800, color: meta.color }}>
                    <span>{syncProcessing ? 'جاري سحب وتحديث البيانات' : 'طلبك بانتظار بدء التنفيذ'}</span>
                    <span style={{ fontSize: 10 }}>{syncProcessing ? 'يعمل الآن' : 'في الطابور'}</span>
                  </div>
                  <div style={{ height: 8, overflow: 'hidden', borderRadius: 99, background: `${meta.color}20`, direction: 'ltr' }}>
                    {syncProcessing ? (
                      <div style={{ width: '28%', height: '100%', borderRadius: 99, background: meta.color, animation: 'trendyol-sync-progress 1.6s ease-in-out infinite alternate' }} />
                    ) : (
                      <div style={{ width: '12%', height: '100%', borderRadius: 99, background: meta.color }} />
                    )}
                  </div>
                  <div style={{ marginTop: 9, color: 'var(--text3)', fontSize: 10, lineHeight: 1.7 }}>
                    يشمل التحديث الطلبات والعملاء والمنتجات والصور والمخزون والمرتجعات والتسويات. لا تحتاج للضغط مرة أخرى؛ يتم تحديث الحالة تلقائيًا.
                  </div>
                </div>
              ) : null}
              {syncJob?.status === 'done' ? (
                <div style={{ marginTop: 9, padding: '8px 10px', borderRadius: 8, background: 'var(--success-bg)', color: 'var(--success-text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700 }}>تم سحب {syncDetails?.orders ?? status.records_synced ?? 0} طلبًا</span>
                  <a href="/orders" style={{ color: 'inherit', fontWeight: 800, textDecoration: 'underline' }}>عرض الطلبات ←</a>
                </div>
              ) : null}
              {syncJob?.status === 'done' && syncDetails ? (
                <div style={{ marginTop:8, display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:6 }}>
                  {[
                    ['الطلبات', syncDetails.orders], ['المرتجعات', syncDetails.returns],
                    ['التسويات', syncDetails.settlements], ['المنتجات', syncDetails.products],
                    ['المخزون', syncDetails.inventory], ['أيام الأداء', syncDetails.performance_days],
                  ].map(([label, value]) => (
                    <div key={String(label)} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:7, padding:'6px 8px', display:'flex', justifyContent:'space-between' }}>
                      <span style={{ color:'var(--text3)' }}>{label}</span><strong>{Number(value || 0).toLocaleString('ar-SA')}</strong>
                    </div>
                  ))}
                  {syncDetails.warnings?.length ? <div style={{ gridColumn:'1/-1', color:'var(--warning-text)', fontSize:10, lineHeight:1.6 }}>⚠ تعذر تحديث بعض الأقسام: {syncDetails.warnings.join('، ')}</div> : null}
                </div>
              ) : null}
              {syncJob?.status === 'failed' && syncJob.error_message ? <div style={{ color: 'var(--danger-text)', fontSize: 10, marginTop: 7 }}>{syncJob.error_message}</div> : null}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {status.is_active ? (
                <button style={{ ...S.miniBtn, flex: 1, color: meta.color, borderColor: meta.color, opacity: syncInProgress ? 0.65 : 1 }} onClick={() => void requestSync()} disabled={!!busy || syncInProgress}>
                  {busy === 'sync' || syncInProgress ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {busy === 'sync' ? 'جارٍ الجدولة...' : syncJob?.status === 'pending' ? 'في الطابور...' : syncProcessing ? 'جارٍ المزامنة...' : 'مزامنة الآن'}
                </button>
              ) : null}
              <button style={{ ...S.miniBtn, flex: 1 }} onClick={() => setEditing(true)}><KeyRound size={13} /> تحديث المفاتيح</button>
              <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => void remove()} disabled={!!busy}>{busy === 'delete' ? <Loader2 size={13} /> : <Trash2 size={13} />}</button>
            </div>
            {status.is_active && showAdvancedActions ? <button style={{ ...S.saveBtn, width:'100%', justifyContent:'center', marginTop:8, background:meta.color }} onClick={() => setShowActions(true)}><PlugZap size={14}/> مركز عمليات Trendyol الكامل</button> : null}
          </div>
        ) : (
          <div>
            <Field label={platform === 'trendyol' ? 'معرّف البائع (معرّف الكيان)' : 'Seller / Supplier ID'} value={form.seller_id} onChange={value => update('seller_id', value)} />
            {platform === 'trendyol' ? <>
              <Field label="مفتاح API" secret value={form.api_key} onChange={value => update('api_key', value)} />
              <Field label="سر API" secret value={form.api_secret} onChange={value => update('api_secret', value)} />
            </> : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={{ ...S.miniBtn, flex: 1, color: meta.color, borderColor: meta.color }} onClick={() => void testConnection()} disabled={!!busy}>
                {busy === 'test' ? <Loader2 size={13} /> : <PlugZap size={13} />} اختبار
              </button>
              <button style={{ ...S.saveBtn, flex: 1, opacity: verified ? 1 : 0.65 }} onClick={() => void save()} disabled={!!busy}>
                {busy === 'save' ? <Loader2 size={13} /> : verified ? <CheckCircle2 size={13} /> : <ShieldCheck size={13} />} حفظ{verified ? ' وتفعيل' : ''}
              </button>
              {status ? <button style={S.miniBtn} onClick={() => setEditing(false)}>إلغاء</button> : null}
            </div>
          </div>
        )}
      </div>
      {showAdvancedActions && showActions ? <TrendyolActionCenter merchantCode={merchantCode} onClose={() => setShowActions(false)} /> : null}
    </article>
  )
}

function Field({ label, value, onChange, secret = false }: { label: string; value: string; onChange: (value: string) => void; secret?: boolean }) {
  return <div style={{ marginBottom: 11 }}>
    <label style={S.label}>{label}</label>
    <input style={{ ...S.input, direction: 'ltr', fontFamily: secret ? 'monospace' : 'inherit', fontSize: 12 }} type={secret ? 'password' : 'text'} value={value} onChange={event => onChange(event.target.value)} autoComplete="off" />
  </div>
}

function StatusBadge({ status, color }: { status: CredentialStatus | null; color: string }) {
  const label = status?.is_active ? 'متصل' : status ? 'غير مفعّل' : 'غير مربوط'
  return <span style={{ borderRadius: 20, padding: '3px 9px', fontSize: 10, fontWeight: 800, background: status?.is_active ? color + '1f' : 'var(--surface2)', color: status?.is_active ? color : 'var(--text3)' }}>{label}</span>
}

function testPayload(platform: Platform, form: FormState) {
  return {
    platform, seller_id: form.seller_id, api_key: form.api_key, api_secret: form.api_secret,
    extra: platform === 'amazon'
      ? { refresh_token: form.refresh_token }
      : platform === 'noon'
        ? { service_account: form.service_account, token_endpoint: form.token_endpoint }
        : {},
  }
}

async function callManager(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-platform-credentials`, {
    method: 'POST', headers: functionHeaders(session?.access_token), body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok && !data.error) data.error = `HTTP ${response.status}`
  return data
}

function functionHeaders(token?: string) {
  return {
    Authorization: `Bearer ${token || ''}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  }
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short' })
}
