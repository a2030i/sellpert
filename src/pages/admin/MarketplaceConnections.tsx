import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, PlugZap, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Merchant } from '../../lib/supabase'
import { S } from './adminShared'

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
  amazon: { label: 'Amazon SP-API', icon: '📦', color: '#ff9900', description: 'LWA OAuth وربط سوق Amazon.sa' },
  noon: { label: 'نون', icon: '🟡', color: '#f2cf00', description: 'Service Account الممنوح من Noon Partner' },
  trendyol: { label: 'Trendyol', icon: '🟠', color: '#f27a1a', description: 'Supplier ID ومفاتيح Partner API' },
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
          {(['amazon', 'noon', 'trendyol'] as Platform[]).map(platform => (
            <PlatformCard
              key={`${merchantCode}-${platform}`}
              platform={platform}
              merchantCode={merchantCode}
              status={selectedRows.get(platform) || null}
              onChanged={loadCredentials}
              setNotice={setNotice}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function PlatformCard({ platform, merchantCode, status, onChanged, setNotice }: {
  platform: Platform
  merchantCode: string
  status: CredentialStatus | null
  onChanged: () => Promise<void>
  setNotice: (notice: { type: 'ok' | 'err'; text: string } | null) => void
}) {
  const meta = PLATFORM_META[platform]
  const [editing, setEditing] = useState(!status)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | null>(null)
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    setEditing(!status)
    setVerified(false)
    setForm({ ...EMPTY_FORM, seller_id: status?.seller_id || '' })
  }, [merchantCode, status])

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

        {!editing && status ? (
          <div>
            <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, fontSize: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}><span style={{ color: 'var(--text3)' }}>{platform === 'trendyol' ? 'معرّف البائع (معرّف الكيان)' : 'Seller ID'}</span><code>{status.seller_id}</code></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}><span style={{ color: 'var(--text3)' }}>آخر اختبار</span><span>{formatDate(status.last_tested_at)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text3)' }}>آخر مزامنة</span><span>{formatDate(status.last_sync_at)}</span></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...S.miniBtn, flex: 1 }} onClick={() => setEditing(true)}><KeyRound size={13} /> تحديث المفاتيح</button>
              <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => void remove()} disabled={!!busy}>{busy === 'delete' ? <Loader2 size={13} /> : <Trash2 size={13} />}</button>
            </div>
          </div>
        ) : (
          <div>
            <Field label={platform === 'trendyol' ? 'معرّف البائع (معرّف الكيان)' : 'Seller / Supplier ID'} value={form.seller_id} onChange={value => update('seller_id', value)} />
            {platform === 'trendyol' ? <>
              <Field label="مفتاح API" secret value={form.api_key} onChange={value => update('api_key', value)} />
              <Field label="سر API" secret value={form.api_secret} onChange={value => update('api_secret', value)} />
            </> : null}
            {platform === 'amazon' ? <>
              <Field label="LWA Client ID" secret value={form.api_key} onChange={value => update('api_key', value)} />
              <Field label="LWA Client Secret" secret value={form.api_secret} onChange={value => update('api_secret', value)} />
              <Field label="Refresh Token" secret value={form.refresh_token} onChange={value => update('refresh_token', value)} />
              <Field label="Marketplace ID" value={form.marketplace_id} onChange={value => update('marketplace_id', value)} />
            </> : null}
            {platform === 'noon' ? <div style={{ marginBottom: 11 }}>
              <label style={S.label}>Service Account JSON</label>
              <textarea style={{ ...S.input, minHeight: 116, resize: 'vertical', direction: 'ltr', fontFamily: 'monospace', fontSize: 11 }} value={form.service_account} onChange={event => update('service_account', event.target.value)} placeholder={'{"client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----..."}'} />
            </div> : null}
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
