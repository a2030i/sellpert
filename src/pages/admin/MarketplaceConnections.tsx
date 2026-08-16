import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, PlugZap, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import TrendyolActionCenter from '../../components/TrendyolActionCenter'
import OmnifulAmazonTrialCard from '../../components/OmnifulAmazonTrialCard'
import { supabase, type Merchant } from '../../lib/supabase'
import { S } from './adminShared'

type CredentialStatus = {
  id: string
  merchant_code: string
  platform: 'trendyol'
  seller_id: string | null
  is_active: boolean
  test_status: string | null
  last_tested_at: string | null
  last_sync_at: string | null
  records_synced: number | null
}

type FormState = { seller_id: string; api_key: string; api_secret: string }
const EMPTY_FORM: FormState = { seller_id: '', api_key: '', api_secret: '' }
const TRENDYOL_COLOR = '#a94400'

type Props = { merchants: Merchant[]; lockedMerchantCode?: string; compactHeader?: boolean }

export default function MarketplaceConnections({ merchants, lockedMerchantCode, compactHeader = false }: Props) {
  const [merchantCode, setMerchantCode] = useState(lockedMerchantCode || merchants[0]?.merchant_code || '')
  const [credentials, setCredentials] = useState<CredentialStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const loadCredentials = useCallback(async () => {
    setLoading(true)
    try {
      const result = await callManager({ action: 'list', merchant_code: lockedMerchantCode })
      if (result.error) throw new Error(result.error)
      setCredentials((result.credentials || []).filter((row: CredentialStatus) => row.platform === 'trendyol'))
    } catch (error) {
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر تحميل ربط Trendyol' })
    } finally {
      setLoading(false)
    }
  }, [lockedMerchantCode])

  useEffect(() => { void loadCredentials() }, [loadCredentials])
  useEffect(() => { if (lockedMerchantCode) setMerchantCode(lockedMerchantCode) }, [lockedMerchantCode])

  const credential = useMemo(
    () => credentials.find(row => row.merchant_code === merchantCode) || null,
    [credentials, merchantCode],
  )

  return <section style={{ marginBottom: 28 }}>
    <div style={{ ...S.tableCard, padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 16 }}>
            <PlugZap size={18} color="var(--accent)" /> ربط Trendyol
          </div>
          <div style={{ color: 'var(--text2)', fontSize: 12, marginTop: 5 }}>
            Amazon وNoon يعملان عبر استيراد Excel فقط. مفاتيح Trendyol تُحفظ مشفرة ولا تُعرض مجددًا.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!lockedMerchantCode && !compactHeader ? <select style={{ ...S.input, width: 260 }} value={merchantCode} onChange={event => setMerchantCode(event.target.value)}>
            {merchants.map(merchant => <option key={merchant.merchant_code} value={merchant.merchant_code}>{merchant.name} — {merchant.merchant_code}</option>)}
          </select> : null}
          <button aria-label="تحديث حالة Trendyol" style={S.miniBtn} onClick={() => void loadCredentials()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>
    </div>

    {notice ? <div style={{ ...S.msgBox, ...(notice.type === 'err' ? S.msgErr : S.msgOk), marginBottom: 16 }}>
      {notice.text}
      <button aria-label="إغلاق الرسالة" style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', marginRight: 10 }} onClick={() => setNotice(null)}>إغلاق</button>
    </div> : null}

    {!merchantCode
      ? <div style={{ ...S.tableCard, padding: 30, textAlign: 'center', color: 'var(--text3)' }}>أضف تاجرًا أولًا لبدء الربط.</div>
      : <>
          <TrendyolCard merchantCode={merchantCode} credential={credential} onChanged={loadCredentials} setNotice={setNotice} merchantMode={Boolean(lockedMerchantCode)} />
          <OmnifulAmazonTrialCard merchantCode={merchantCode} merchantMode={Boolean(lockedMerchantCode)} />
        </>}
  </section>
}

function TrendyolCard({ merchantCode, credential, onChanged, setNotice, merchantMode }: {
  merchantCode: string
  credential: CredentialStatus | null
  onChanged: () => Promise<void>
  setNotice: (value: { type: 'ok' | 'err'; text: string } | null) => void
  merchantMode: boolean
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editing, setEditing] = useState(!credential)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | 'sync' | null>(null)
  const [syncJob, setSyncJob] = useState<{ status: string; error_message?: string | null } | null>(null)
  const [syncDetails, setSyncDetails] = useState<Record<string, unknown> | null>(null)
  const [showActions, setShowActions] = useState(false)

  useEffect(() => {
    setEditing(!credential)
    setVerified(false)
    setForm({ ...EMPTY_FORM, seller_id: credential?.seller_id || '' })
  }, [merchantCode, credential])

  useEffect(() => {
    if (!credential?.is_active) { setSyncJob(null); setSyncDetails(null); return }
    let cancelled = false
    const poll = async () => {
      const result = await callManager({ action: 'sync-status', merchant_code: merchantCode, platform: 'trendyol' }).catch(() => null)
      if (cancelled || !result || result.error) return
      setSyncJob(result.job || null)
      setSyncDetails(result.log?.details || null)
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [credential?.is_active, merchantCode])

  const syncActive = ['pending', 'processing', 'running'].includes(syncJob?.status || '')
  const syncProcessing = syncJob?.status === 'processing' || syncJob?.status === 'running'
  const syncProgress = syncProcessing
    ? Math.min(99, Math.max(1, Number(syncDetails?.progress_percent || 5)))
    : syncJob?.status === 'pending' ? 2 : 100
  const syncStageLabel = String(syncDetails?.stage_label || (syncProcessing
    ? 'جاري مزامنة بيانات Trendyol'
    : 'بانتظار بدء المزامنة'))

  function update(field: keyof FormState, value: string) {
    setVerified(false)
    setForm(current => ({ ...current, [field]: value }))
  }

  async function testConnection() {
    setBusy('test'); setNotice(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-platform-connection`, {
        method: 'POST', headers: functionHeaders(session?.access_token),
        body: JSON.stringify({ platform: 'trendyol', ...form, extra: {} }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.ok) throw new Error(data.error || 'فشل اختبار الاتصال')
      setVerified(true)
      setNotice({ type: 'ok', text: 'Trendyol: تم اختبار الاتصال بنجاح. اضغط حفظ وتفعيل.' })
    } catch (error) {
      setVerified(false)
      setNotice({ type: 'err', text: `Trendyol: ${error instanceof Error ? error.message : 'فشل اختبار الاتصال'}` })
    } finally { setBusy(null) }
  }

  async function save() {
    setBusy('save'); setNotice(null)
    try {
      const result = await callManager({ action: 'save', merchant_code: merchantCode, platform: 'trendyol', credentials: form, verified })
      if (result.error) throw new Error(result.error)
      setNotice({ type: 'ok', text: 'تم حفظ ربط Trendyol وتفعيله.' })
      setEditing(false)
      await onChanged()
    } catch (error) {
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر حفظ ربط Trendyol' })
    } finally { setBusy(null) }
  }

  async function remove() {
    if (!window.confirm('حذف ربط Trendyol لهذا التاجر؟')) return
    setBusy('delete'); setNotice(null)
    try {
      const result = await callManager({ action: 'delete', merchant_code: merchantCode, platform: 'trendyol' })
      if (result.error) throw new Error(result.error)
      setNotice({ type: 'ok', text: 'تم حذف ربط Trendyol.' })
      await onChanged()
    } catch (error) {
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر حذف الربط' })
    } finally { setBusy(null) }
  }

  async function requestSync() {
    setBusy('sync'); setNotice(null)
    try {
      const result = await callManager({ action: 'sync', merchant_code: merchantCode, platform: 'trendyol' })
      if (result.error) throw new Error(result.error)
      setSyncJob({ status: 'pending' })
      setNotice({ type: 'ok', text: result.already_queued ? 'مزامنة Trendyol موجودة بالفعل في الطابور.' : 'تمت جدولة مزامنة Trendyol.' })
    } catch (error) {
      setNotice({ type: 'err', text: error instanceof Error ? error.message : 'تعذر بدء المزامنة' })
    } finally { setBusy(null) }
  }

  return <article style={{ maxWidth: 760, background: 'var(--surface)', border: `1px solid ${credential?.is_active ? `${TRENDYOL_COLOR}66` : 'var(--border)'}`, borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
    <div style={{ height: 3, background: credential?.is_active ? TRENDYOL_COLOR : 'var(--border2)' }} />
    <div style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 12, background: `${TRENDYOL_COLOR}18`, color: TRENDYOL_COLOR, fontWeight: 900 }}>T</div>
        <div style={{ flex: 1 }}><strong>Trendyol</strong><div style={{ color: 'var(--text3)', fontSize: 11, marginTop: 4 }}>Partner API للطلبات والمخزون والعمليات</div></div>
        <span style={{ borderRadius: 20, padding: '3px 9px', fontSize: 10, fontWeight: 800, background: credential?.is_active ? `${TRENDYOL_COLOR}1f` : 'var(--surface2)', color: credential?.is_active ? TRENDYOL_COLOR : 'var(--text3)' }}>{credential?.is_active ? 'متصل' : 'غير مربوط'}</span>
      </div>

      {!editing && credential ? <>
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, fontSize: 12, marginBottom: 12 }}>
          <Info label="معرّف البائع" value={credential.seller_id || '—'} />
          <Info label="آخر اختبار" value={formatDate(credential.last_tested_at)} />
          <Info label="آخر مزامنة" value={formatDate(credential.last_sync_at)} last />
           {syncJob?.status === 'failed' && syncJob.error_message ? <div style={{ color: 'var(--danger-text)', fontSize: 10, marginTop: 9 }}>{syncJob.error_message}</div> : null}
           {syncDetails ? <div style={{ color: 'var(--text3)', fontSize: 10, marginTop: 9 }}>آخر مزامنة: {Number(syncDetails.orders || credential.records_synced || 0).toLocaleString('en-US')} طلب</div> : null}
           {syncActive ? <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: `${TRENDYOL_COLOR}0D`, border: `1px solid ${TRENDYOL_COLOR}35` }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8, fontWeight: 800, color: TRENDYOL_COLOR }}>
               <span>{syncStageLabel}</span><span style={{ fontSize: 10 }}>{syncProgress.toLocaleString('en-US')}%</span>
             </div>
             <div role="progressbar" aria-label="تقدم مزامنة Trendyol" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncProgress} style={{ height: 8, overflow: 'hidden', borderRadius: 99, background: `${TRENDYOL_COLOR}20`, direction: 'ltr' }}>
               <div style={{ width: `${syncProgress}%`, height: '100%', borderRadius: 99, background: TRENDYOL_COLOR, transition: 'width .35s ease' }} />
             </div>
           </div> : null}
           {['done', 'partial'].includes(syncJob?.status || '') && syncDetails ? <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
             {[
               ['الشحنات', syncDetails.shipment_packages],
               ['بنود الطلبات', syncDetails.order_lines],
               ['الحركات المالية', syncDetails.finance],
               ['أسئلة العملاء', syncDetails.questions],
             ].map(([label, value]) => <div key={String(label)} style={{ borderRadius: 8, background: 'var(--surface)', padding: 8 }}><span style={{ color: 'var(--text3)' }}>{String(label)}</span><strong style={{ display: 'block', marginTop: 3 }}>{Number(value || 0).toLocaleString('en-US')}</strong></div>)}
           </div> : null}
         </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...S.miniBtn, flex: 1, color: TRENDYOL_COLOR, borderColor: TRENDYOL_COLOR }} onClick={() => void requestSync()} disabled={Boolean(busy) || syncActive}>{busy === 'sync' || syncActive ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {syncActive ? 'المزامنة تعمل…' : 'مزامنة الآن'}</button>
          <button style={{ ...S.miniBtn, flex: 1 }} onClick={() => setEditing(true)}><KeyRound size={13} /> تحديث المفاتيح</button>
          <button aria-label="حذف ربط Trendyol" style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => void remove()} disabled={Boolean(busy)}>{busy === 'delete' ? <Loader2 size={13} /> : <Trash2 size={13} />}</button>
        </div>
        <button style={{ ...S.saveBtn, width: '100%', justifyContent: 'center', marginTop: 8, background: TRENDYOL_COLOR }} onClick={() => setShowActions(true)}><PlugZap size={14} /> {merchantMode ? 'خدمات Trendyol' : 'مركز عمليات Trendyol'}</button>
      </> : <>
        <Field label="معرّف البائع (معرّف الكيان)" value={form.seller_id} onChange={value => update('seller_id', value)} />
        <Field label="مفتاح API" secret value={form.api_key} onChange={value => update('api_key', value)} />
        <Field label="سر API" secret value={form.api_secret} onChange={value => update('api_secret', value)} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...S.miniBtn, flex: 1, color: TRENDYOL_COLOR, borderColor: TRENDYOL_COLOR }} onClick={() => void testConnection()} disabled={Boolean(busy)}>{busy === 'test' ? <Loader2 size={13} /> : <PlugZap size={13} />} اختبار</button>
          <button style={{ ...S.saveBtn, flex: 1, opacity: verified ? 1 : 0.65 }} onClick={() => void save()} disabled={Boolean(busy) || !verified}>{busy === 'save' ? <Loader2 size={13} /> : verified ? <CheckCircle2 size={13} /> : <ShieldCheck size={13} />} حفظ وتفعيل</button>
          {credential ? <button style={S.miniBtn} onClick={() => setEditing(false)}>إلغاء</button> : null}
        </div>
      </>}
    </div>
    {showActions ? <TrendyolActionCenter merchantCode={merchantCode} onClose={() => setShowActions(false)} merchantMode={merchantMode} /> : null}
  </article>
}

function Field({ label, value, onChange, secret = false }: { label: string; value: string; onChange: (value: string) => void; secret?: boolean }) {
  return <div style={{ marginBottom: 11 }}><label style={S.label}>{label}</label><input style={{ ...S.input, direction: 'ltr', fontFamily: secret ? 'monospace' : 'inherit', fontSize: 12 }} type={secret ? 'password' : 'text'} value={value} onChange={event => onChange(event.target.value)} autoComplete="off" /></div>
}

function Info({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: last ? 0 : 7 }}><span style={{ color: 'var(--text3)' }}>{label}</span><span>{value}</span></div>
}

async function callManager(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-platform-credentials`, { method: 'POST', headers: functionHeaders(session?.access_token), body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok && !data.error) data.error = `HTTP ${response.status}`
  return data
}

function functionHeaders(token?: string) {
  return { Authorization: `Bearer ${token || ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}
