import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { CheckCircle2, ExternalLink, KeyRound, Loader2, RefreshCw, Save, ShieldCheck, ShoppingBag, Store, Trash2, Wrench } from 'lucide-react'
import { supabase } from '../lib/supabase'

type TrialPlatform = 'amazon' | 'noon' | 'trendyol'
type TrialConnection = {
  platform: TrialPlatform
  status: 'pending' | 'active' | 'error' | 'disabled'
  last_sync_at: string | null
  last_error: string | null
  records_seen: number
  records_matched: number
  records_new: number
  is_enabled: boolean
  scope_strategy: 'seller_token' | 'seller_ref' | 'store_ref'
  omniful_seller_ref: string | null
  omniful_store_ref: string | null
}
type MappingForm = {
  scope_strategy: 'seller_ref' | 'store_ref'
  omniful_seller_ref: string
  omniful_store_ref: string
}
type OmnifulPortal = {
  configured: boolean
  url: string | null
  seller_scope_label: string | null
  updated_at: string | null
}

const PLATFORM_META: Record<TrialPlatform, { label: string; color: string }> = {
  amazon: { label: 'Amazon', color: '#ff9900' },
  noon: { label: 'Noon', color: '#c7ab00' },
  trendyol: { label: 'Trendyol', color: '#f56600' },
}
type OmnifulAccount = {
  mode: 'merchant_account' | 'central_account'
  token_configured: boolean
  credentials_configured: boolean
  token_hint: string | null
  last_tested_at: string | null
  access_token_expires_at: string | null
  refresh_token_expires_at: string | null
}
type CredentialForm = {
  client_id: string
  client_secret: string
  refresh_token: string
  access_token: string
}
const EMPTY_MAPPING: MappingForm = { scope_strategy: 'store_ref', omniful_seller_ref: '', omniful_store_ref: '' }
const EMPTY_MAPPINGS: Record<TrialPlatform, MappingForm> = {
  amazon: { ...EMPTY_MAPPING }, noon: { ...EMPTY_MAPPING }, trendyol: { ...EMPTY_MAPPING },
}
const EMPTY_CREDENTIALS: CredentialForm = { client_id: '', client_secret: '', refresh_token: '', access_token: '' }
const EMPTY_ACCOUNT: OmnifulAccount = {
  mode: 'merchant_account', token_configured: false, credentials_configured: false,
  token_hint: null, last_tested_at: null, access_token_expires_at: null, refresh_token_expires_at: null,
}

export default function OmnifulAmazonTrialCard({ merchantCode, merchantMode = false }: { merchantCode: string; merchantMode?: boolean }) {
  const [connections, setConnections] = useState<TrialConnection[]>([])
  const [portal, setPortal] = useState<OmnifulPortal | null>(null)
  const [account, setAccount] = useState<OmnifulAccount>(EMPTY_ACCOUNT)
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<'sync' | 'save' | 'token' | 'remove-token' | 'central' | TrialPlatform | null>(null)
  const [notice, setNotice] = useState('')
  const [portalUrl, setPortalUrl] = useState('')
  const [sellerScopeLabel, setSellerScopeLabel] = useState('')
  const [credentials, setCredentials] = useState<CredentialForm>(EMPTY_CREDENTIALS)
  const [mappings, setMappings] = useState<Record<TrialPlatform, MappingForm>>(EMPTY_MAPPINGS)
  const [connectingPlatform, setConnectingPlatform] = useState<TrialPlatform | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await callOmniful({ action: 'status', merchant_code: merchantCode })
      const nextPortal = result.portal as OmnifulPortal
      const nextAccount = { ...EMPTY_ACCOUNT, ...(result.account || {}) } as OmnifulAccount
      const nextConnections = (result.connections || []) as TrialConnection[]
      setConnections(nextConnections)
      setMappings(Object.fromEntries((Object.keys(PLATFORM_META) as TrialPlatform[]).map(platform => {
        const connection = nextConnections.find(item => item.platform === platform)
        return [platform, {
          scope_strategy: connection?.scope_strategy === 'seller_ref' ? 'seller_ref' : 'store_ref',
          omniful_seller_ref: connection?.omniful_seller_ref || '',
          omniful_store_ref: connection?.omniful_store_ref || '',
        }]
      })) as Record<TrialPlatform, MappingForm>)
      setPortal(nextPortal)
      setAccount(nextAccount)
      setPortalUrl(nextPortal?.url || '')
      setSellerScopeLabel(nextPortal?.seller_scope_label || '')
      setTokenConfigured(Boolean(nextAccount.credentials_configured))
      setAvailable(Boolean(result.available))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('غير مفعلة') || message.includes('404')) setAvailable(false)
      else setNotice(message || 'تعذر قراءة حالة بوابة Omniful')
    }
  }, [merchantCode])

  useEffect(() => { void load() }, [load])

  const detected = useMemo(() => connections.filter(connection => connection.records_seen > 0), [connections])
  const totals = useMemo(() => connections.reduce((sum, connection) => ({
    seen: sum.seen + Number(connection.records_seen || 0),
    matched: sum.matched + Number(connection.records_matched || 0),
    fresh: sum.fresh + Number(connection.records_new || 0),
  }), { seen: 0, matched: 0, fresh: 0 }), [connections])
  const latestSync = useMemo(() => {
    const dates = connections.map(connection => connection.last_sync_at)
      .filter((value): value is string => Boolean(value)).sort()
    return dates[dates.length - 1] || null
  }, [connections])

  async function sync(requestedPlatform: TrialPlatform | null = connectingPlatform) {
    setBusy('sync'); setNotice('')
    try {
      const result = await callOmniful({ action: 'sync', merchant_code: merchantCode })
      const requested = requestedPlatform ? result.platforms?.[requestedPlatform] : null
      if (requestedPlatform && Number(requested?.records || 0) === 0) {
        setNotice(`لم نرصد ${PLATFORM_META[requestedPlatform].label} بعد. أكمل التفويض في Omniful ثم أعد التحقق.`)
      } else {
        setNotice(`تم فحص القنوات: ${formatNumber(result.matched_existing)} طلب مطابق و${formatNumber(result.new_shadow)} طلب جديد للمراجعة.`)
        setConnectingPlatform(null)
      }
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'تعذر سحب القنوات من Omniful')
    } finally { setBusy(null) }
  }

  async function savePortal() {
    setBusy('save'); setNotice('')
    try {
      const result = await callOmniful({ action: 'configure_portal', merchant_code: merchantCode, portal_url: portalUrl, seller_scope_label: sellerScopeLabel })
      setPortal(result.portal)
      setNotice(portalUrl ? 'تم حفظ بوابة Omniful الخاصة بالتاجر.' : 'تم حذف رابط بوابة Omniful.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'تعذر حفظ رابط Omniful')
    } finally { setBusy(null) }
  }

  async function saveAccountCredentials() {
    setBusy('token'); setNotice('')
    try {
      await callOmniful({ action: 'save_account_credentials', merchant_code: merchantCode, ...credentials })
      setCredentials(EMPTY_CREDENTIALS)
      setNotice('تم اختبار حساب Omniful وحفظ بيانات الاعتماد مشفرة مع تفعيل التجديد التلقائي.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'تعذر ربط حساب Omniful')
    } finally { setBusy(null) }
  }

  async function removeAccountToken() {
    if (!window.confirm('إلغاء ربط حساب Omniful الخاص بهذا التاجر؟')) return
    setBusy('remove-token'); setNotice('')
    try {
      await callOmniful({ action: 'remove_account_token', merchant_code: merchantCode })
      setCredentials(EMPTY_CREDENTIALS)
      setNotice('تم إلغاء ربط حساب Omniful الخاص.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'تعذر إلغاء ربط Omniful')
    } finally { setBusy(null) }
  }

  async function selectCentralAccount() {
    setBusy('central'); setNotice('')
    try {
      await callOmniful({ action: 'use_central_account', merchant_code: merchantCode })
      setCredentials(EMPTY_CREDENTIALS)
      setNotice('تم اختيار حساب Sellpert المركزي. أكمل معرّفات القنوات بالأسفل.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'تعذر اختيار الحساب المركزي')
    } finally { setBusy(null) }
  }

  function updateMapping(platform: TrialPlatform, field: keyof MappingForm, value: string) {
    setMappings(current => ({ ...current, [platform]: { ...current[platform], [field]: value } }))
  }

  function updateCredential(field: keyof CredentialForm, value: string) {
    setCredentials(current => ({ ...current, [field]: value }))
  }

  function openPortalFor(platform: TrialPlatform | null = null) {
    if (!portal?.url) return
    setConnectingPlatform(platform)
    setNotice('')
    window.open(portal.url, '_blank', 'noopener,noreferrer')
  }

  async function saveMapping(platform: TrialPlatform) {
    setBusy(platform); setNotice('')
    try {
      await callOmniful({
        action: 'configure_mapping', merchant_code: merchantCode, platform, ...mappings[platform],
      })
      setNotice(`تم حفظ عزل ${PLATFORM_META[platform].label} لهذا التاجر.`)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'تعذر حفظ معرّفات Omniful')
    } finally { setBusy(null) }
  }

  if (available === null && !notice) return null

  const credentialsReady = credentials.client_id.trim().length >= 4
    && credentials.client_secret.trim().length >= 8
    && credentials.refresh_token.trim().length >= 20
    && credentials.access_token.trim().length >= 20
  const readyToPull = tokenConfigured && connections.some(connection => connection.is_enabled && connection.status !== 'disabled')
  const amazonConnection = connections.find(connection => connection.platform === 'amazon')
  const amazonDetected = Number(amazonConnection?.records_seen || 0) > 0
  return <article style={styles.card}>
    <div style={styles.topLine} />
    <div style={styles.body}>
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <div style={styles.logo}><Store size={22} /></div>
          <div><div style={styles.title}>ربط المتاجر عبر Omniful</div><div style={styles.subtitle}>بوابة واحدة لربط أي قناة متاحة داخل مساحة التاجر</div></div>
        </div>
        <span style={styles.protectedBadge}><ShieldCheck size={13} /> تجربة معزولة وآمنة</span>
      </div>

      <div style={styles.accountPanel}>
        <div style={styles.accountHeader}>
          <div><strong style={{ display: 'block', fontSize: 12 }}>حساب Omniful المستخدم</strong><span style={styles.helperText}>{account.mode === 'central_account' ? 'حساب Sellpert المركزي — تديره الإدارة' : 'حساب خاص بهذا التاجر — لا يشارك بياناته مع أي متجر آخر'}</span></div>
          <span style={{ ...styles.accountBadge, background: tokenConfigured ? 'var(--success-bg)' : 'var(--warning-bg)', color: tokenConfigured ? 'var(--success-text)' : 'var(--warning-text)' }}>{tokenConfigured ? `متصل${account.token_hint ? ` · ••••${account.token_hint}` : ''}` : 'غير مربوط'}</span>
        </div>
        {account.mode === 'merchant_account' ? <>
          <div style={styles.credentialsGrid}>
            <CredentialInput label="معرّف العميل — Client ID" value={credentials.client_id} onChange={value => updateCredential('client_id', value)} />
            <CredentialInput label="السر الخاص بالعميل — Client Secret" value={credentials.client_secret} onChange={value => updateCredential('client_secret', value)} secret />
            <CredentialInput label="تحديث الرمز — Refresh Token" value={credentials.refresh_token} onChange={value => updateCredential('refresh_token', value)} secret />
            <CredentialInput label="رمز الوصول — Access Token" value={credentials.access_token} onChange={value => updateCredential('access_token', value)} secret />
          </div>
          <div style={styles.tokenRow}>
            <button type="button" onClick={() => void saveAccountCredentials()} disabled={busy !== null || !credentialsReady} style={{ ...styles.saveButton, opacity: busy !== null || !credentialsReady ? 0.55 : 1 }}>{busy === 'token' ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} اختبار وحفظ الربط</button>
            {tokenConfigured ? <button type="button" aria-label="إلغاء ربط حساب Omniful" onClick={() => void removeAccountToken()} disabled={busy !== null} style={styles.deleteButton}>{busy === 'remove-token' ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} إلغاء الربط</button> : null}
          </div>
          <p style={styles.tokenNote}>انسخ الحقول الأربعة من Omniful: Settings ← Apps &amp; Integrations ← Custom Apps ← Seller Custom Integration ← الإعدادات. لا نحتاج «مفتاح ويب هوك السري». تُحفظ البيانات مشفرة ويُجدد رمز الوصول تلقائيًا.</p>
          {account.access_token_expires_at ? <p style={styles.expiryNote}>رمز الوصول الحالي حتى {formatDate(account.access_token_expires_at)}{account.refresh_token_expires_at ? ` · رمز التحديث حتى ${formatDate(account.refresh_token_expires_at)}` : ''}</p> : null}
        </> : <div style={styles.managedAccount}><ShieldCheck size={15} /><span>لا يحتاج التاجر إلى إدخال أي مفتاح. الإدارة تربط كل قناة بمعرّف Seller أو Store مستقل.</span></div>}
        {!merchantMode ? <div style={styles.modeActions}>
          <button type="button" onClick={() => setAccount(current => ({ ...current, mode: 'merchant_account', token_configured: false, credentials_configured: false, token_hint: null }))} disabled={busy !== null || account.mode === 'merchant_account'} style={styles.modeButton}>حساب التاجر الخاص</button>
          <button type="button" onClick={() => void selectCentralAccount()} disabled={busy !== null || account.mode === 'central_account'} style={styles.modeButton}>{busy === 'central' ? <Loader2 size={13} className="spin" /> : null} حساب Sellpert المركزي</button>
        </div> : null}
      </div>

      <div style={styles.flow}>
        <FlowStep number="1" title="افتح Omniful" detail="مساحة مقيدة لهذا التاجر فقط" active={Boolean(portal?.configured)} />
        <FlowStep number="2" title="اربط القنوات" detail="من شاشة Sales Channel Apps" active={Boolean(portal?.configured)} />
        <FlowStep number="3" title="اسحب إلى Sellpert" detail="نرصد القناة من الطلبات الفعلية" active={totals.seen > 0} />
      </div>

      <div style={styles.amazonQuickStart}>
        <div style={styles.amazonQuickHeader}>
          <div style={styles.amazonIdentity}>
            <span style={styles.amazonLogo}><ShoppingBag size={19} /></span>
            <div>
              <strong style={{ display: 'block', fontSize: 13 }}>ربط Amazon Seller Central</strong>
              <span style={styles.helperText}>ابدأ من Sellpert، فوّض Omniful داخل Amazon، ثم ارجع للتحقق</span>
            </div>
          </div>
          <span style={{ ...styles.amazonStatus, background: amazonDetected ? 'var(--success-bg)' : 'var(--warning-bg)', color: amazonDetected ? 'var(--success-text)' : 'var(--warning-text)' }}>
            {amazonDetected ? `مرصود · ${formatNumber(amazonConnection?.records_seen)}` : 'غير مربوط بعد'}
          </span>
        </div>
        <div style={styles.amazonSteps}>
          <QuickStep number="1" text="افتح Omniful" />
          <QuickStep number="2" text="اختر Amazon Seller Central" />
          <QuickStep number="3" text="سجّل دخول Amazon ووافق" />
          <QuickStep number="4" text="عد إلى Sellpert وتحقق" />
        </div>
        <div style={styles.amazonActions}>
          <button type="button" aria-label="ربط Amazon عبر Omniful" onClick={() => openPortalFor('amazon')} disabled={!portal?.url} style={{ ...styles.amazonButton, opacity: portal?.url ? 1 : 0.5 }}><ExternalLink size={15} /> {amazonDetected ? 'فتح إعداد Amazon في Omniful' : 'ربط Amazon عبر Omniful'}</button>
          <button type="button" aria-label="التحقق من ربط Amazon" onClick={() => { setConnectingPlatform('amazon'); void sync('amazon') }} disabled={busy !== null || !readyToPull} style={{ ...styles.secondaryButton, opacity: busy !== null || !readyToPull ? 0.5 : 1 }}>{busy === 'sync' && connectingPlatform === 'amazon' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} تحقق من ربط Amazon</button>
        </div>
        {connectingPlatform === 'amazon' ? <div style={styles.returnHint}><CheckCircle2 size={14} /> بعد إتمام التفويض في Amazon، ارجع لهذه الصفحة واضغط «تحقق من ربط Amazon».</div> : null}
      </div>

      <div style={styles.actionsPanel}>
        <div><strong style={{ display: 'block', fontSize: 13 }}>{portal?.seller_scope_label || 'مساحة التاجر في Omniful'}</strong><span style={styles.helperText}>{portal?.configured ? 'رابط مساحة Omniful جاهز' : 'بانتظار إضافة رابط مساحة Omniful من الإدارة'}</span></div>
        <div style={styles.actionButtons}>
          <button type="button" onClick={() => openPortalFor()} disabled={!portal?.url} style={{ ...styles.primaryButton, opacity: portal?.url ? 1 : 0.5 }}><ExternalLink size={15} /> فتح Omniful لبقية القنوات</button>
          <button type="button" onClick={() => void sync()} disabled={busy !== null || !readyToPull} style={{ ...styles.secondaryButton, opacity: busy !== null || !readyToPull ? 0.5 : 1 }}>{busy === 'sync' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} تحقق واسحب القنوات</button>
        </div>
      </div>

      {!merchantMode ? <details style={styles.adminSettings} open={!portal?.configured || !available}>
        <summary style={styles.settingsSummary}><Wrench size={14} /> إعداد الإدارة وعزل بيانات التاجر</summary>
        <div style={styles.settingsGrid}>
          <label style={styles.fieldLabel}>رابط مساحة Omniful المقيدة<input dir="ltr" type="url" value={portalUrl} onChange={event => setPortalUrl(event.target.value)} placeholder="https://...omniful.com/..." style={styles.input} /></label>
          <label style={styles.fieldLabel}>اسم نطاق البائع<input value={sellerScopeLabel} onChange={event => setSellerScopeLabel(event.target.value)} placeholder="اسم التاجر" style={styles.input} /></label>
          <button type="button" onClick={() => void savePortal()} disabled={busy !== null} style={styles.saveButton}>{busy === 'save' ? <Loader2 size={14} className="spin" /> : <Save size={14} />} حفظ البوابة</button>
        </div>
        <p style={styles.adminNote}>لا تضع رابط الحساب المركزي بصلاحية مدير. أنشئ مستخدمًا أو مساحة Seller مقيدة بعطارة شمول ثم الصق رابطها هنا.</p>
        {account.mode === 'central_account' ? <div style={styles.mappingSection}>
          <div style={styles.mappingTitle}>معرّفات القنوات داخل حساب Omniful المركزي</div>
          <p style={styles.mappingHelp}>اختر Store ID عند وجود متجر مستقل لكل قناة. استخدم Seller ID فقط إذا كان Omniful يعزل جميع قنوات التاجر تحت بائع واحد.</p>
          <div style={styles.mappingList}>
            {(Object.keys(PLATFORM_META) as TrialPlatform[]).map(platform => {
              const mapping = mappings[platform]
              const connection = connections.find(item => item.platform === platform)
              const connectionConfigured = Boolean(connection?.is_enabled && (
                connection.scope_strategy === 'store_ref' ? connection.omniful_store_ref : connection?.omniful_seller_ref
              ))
              return <div key={platform} style={styles.mappingCard}>
                <div style={styles.mappingHead}>
                  <span style={{ ...styles.dot, background: PLATFORM_META[platform].color }} />
                  <strong>{PLATFORM_META[platform].label}</strong>
                  <span style={{ ...styles.mappingStatus, color: connectionConfigured ? 'var(--success-text)' : 'var(--text3)' }}>{connectionConfigured ? 'محفوظ' : 'غير مضاف'}</span>
                </div>
                <label style={styles.fieldLabel}>طريقة عزل البيانات
                  <select value={mapping.scope_strategy} onChange={event => updateMapping(platform, 'scope_strategy', event.target.value)} style={styles.input}>
                    <option value="store_ref">Store ID — موصى به</option>
                    <option value="seller_ref">Seller ID</option>
                  </select>
                </label>
                <div style={styles.mappingFields}>
                  <label style={styles.fieldLabel}>Seller ID / Code<input dir="ltr" value={mapping.omniful_seller_ref} onChange={event => updateMapping(platform, 'omniful_seller_ref', event.target.value)} placeholder="Seller ID" style={styles.input} /></label>
                  <label style={styles.fieldLabel}>Store ID / Code<input dir="ltr" value={mapping.omniful_store_ref} onChange={event => updateMapping(platform, 'omniful_store_ref', event.target.value)} placeholder="Store ID" style={styles.input} /></label>
                </div>
                <button type="button" onClick={() => void saveMapping(platform)} disabled={busy !== null || (mapping.scope_strategy === 'store_ref' ? !mapping.omniful_store_ref.trim() : !mapping.omniful_seller_ref.trim())} style={{ ...styles.saveButton, width: '100%', opacity: busy !== null ? 0.65 : 1 }}>
                  {busy === platform ? <Loader2 size={14} className="spin" /> : <Save size={14} />} حفظ ربط {PLATFORM_META[platform].label}
                </button>
              </div>
            })}
          </div>
        </div> : <p style={styles.adminNote}>هذا التاجر يستخدم حساب Omniful خاصًا به؛ لذلك لا يحتاج Seller ID أو Store ID من الحساب المركزي.</p>}
      </details> : null}

      <div style={styles.discoveryRow}>
        <div><span style={styles.sectionLabel}>القنوات المرصودة من Omniful</span><div style={styles.channelChips}>
          {detected.length > 0 ? detected.map(connection => <span key={connection.platform} style={{ ...styles.channelChip, borderColor: `${PLATFORM_META[connection.platform].color}66` }}><i style={{ ...styles.dot, background: PLATFORM_META[connection.platform].color }} />{PLATFORM_META[connection.platform].label} · {formatNumber(connection.records_seen)}</span>) : <span style={styles.emptyChannels}>لم نرصد طلبات من قناة بعد</span>}
        </div></div>
        {latestSync ? <span style={styles.lastSync}><CheckCircle2 size={14} /> آخر فحص {formatDate(latestSync)}</span> : null}
      </div>

      {totals.seen > 0 ? <div style={styles.metrics}><Metric label="طلبات Omniful" value={totals.seen} /><Metric label="مطابقة للمصادر الحالية" value={totals.matched} /><Metric label="جديدة للمراجعة" value={totals.fresh} /></div> : null}
      <div style={styles.safetyBox}><ShieldCheck size={17} /><span><strong>المصادر الحالية لن تتعطل:</strong> Amazon وNoon يستمران عبر Excel، وTrendyol يستمر عبر API المباشر. بيانات Omniful للمقارنة فقط حتى اعتمادها.</span></div>
      {notice ? <div style={notice.startsWith('تم') ? styles.success : notice.startsWith('لم نرصد') ? styles.warning : styles.error}>{notice}</div> : null}
    </div>
  </article>
}

function CredentialInput({ label, value, onChange, secret = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  secret?: boolean
}) {
  return <label style={styles.fieldLabel}>{label}
    <input
      dir="ltr"
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={event => onChange(event.target.value)}
      autoComplete="new-password"
      spellCheck={false}
      style={{ ...styles.input, fontFamily: 'monospace' }}
    />
  </label>
}

function FlowStep({ number, title, detail, active }: { number: string; title: string; detail: string; active: boolean }) {
  return <div style={styles.flowStep}><span style={{ ...styles.stepNumber, background: active ? 'var(--accent)' : 'var(--surface3)', color: active ? '#fff' : 'var(--text3)' }}>{number}</span><div><strong>{title}</strong><small>{detail}</small></div></div>
}
function QuickStep({ number, text }: { number: string; text: string }) {
  return <div style={styles.quickStep}><span>{number}</span><small>{text}</small></div>
}
function Metric({ label, value }: { label: string; value: number }) { return <div style={styles.metric}><span>{label}</span><strong>{formatNumber(value)}</strong></div> }

async function callOmniful(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-omniful-amazon`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result
}

function formatNumber(value: unknown) { return Number(value || 0).toLocaleString('en-US') }
function formatDate(value: string) { return new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) }

const styles: Record<string, CSSProperties> = {
  card: { maxWidth: 760, marginTop: 14, background: 'var(--surface)', border: '1px solid rgba(25,42,62,.2)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' }, topLine: { height: 3, background: 'linear-gradient(90deg,#192a3e,#0e8177)' }, body: { padding: 18 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }, titleGroup: { display: 'flex', alignItems: 'center', gap: 12 }, logo: { width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 12, background: 'rgba(14,129,119,.11)', color: 'var(--accent)' }, title: { fontSize: 15, fontWeight: 850, color: 'var(--text)' }, subtitle: { marginTop: 3, fontSize: 11, color: 'var(--text3)' }, protectedBadge: { display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 20, padding: '5px 10px', fontSize: 10, fontWeight: 800, background: 'var(--success-bg)', color: 'var(--success-text)' },
  accountPanel: { marginTop: 16, padding: 14, borderRadius: 12, border: '1px solid rgba(14,129,119,.24)', background: 'linear-gradient(135deg,rgba(14,129,119,.07),rgba(255,255,255,.02))' }, accountHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }, accountBadge: { display: 'inline-flex', alignItems: 'center', minHeight: 25, padding: '3px 9px', borderRadius: 20, fontSize: 9, fontWeight: 850, direction: 'ltr' }, credentialsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 9, marginTop: 12 }, tokenRow: { display: 'flex', alignItems: 'end', gap: 8, flexWrap: 'wrap', marginTop: 12 }, tokenNote: { margin: '8px 0 0', color: 'var(--text3)', fontSize: 9, lineHeight: 1.7 }, expiryNote: { margin: '6px 0 0', color: 'var(--success-text)', fontSize: 9, lineHeight: 1.7 }, deleteButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--danger-text)', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer' }, managedAccount: { display: 'flex', alignItems: 'center', gap: 7, marginTop: 11, padding: 10, borderRadius: 9, background: 'var(--surface)', color: 'var(--text2)', fontSize: 10, lineHeight: 1.6 }, modeActions: { display: 'flex', gap: 7, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }, modeButton: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text2)', fontFamily: 'inherit', fontSize: 9, fontWeight: 750, cursor: 'pointer' },
  flow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 8, alignItems: 'center', marginTop: 18, padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface2)' }, flowStep: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 11 }, stepNumber: { flex: '0 0 auto', width: 25, height: 25, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 900 },
  amazonQuickStart: { marginTop: 12, padding: 14, borderRadius: 13, border: '1px solid rgba(255,153,0,.38)', background: 'linear-gradient(135deg,rgba(255,153,0,.10),rgba(25,42,62,.035))' }, amazonQuickHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }, amazonIdentity: { display: 'flex', alignItems: 'center', gap: 10 }, amazonLogo: { width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', color: '#8b4f00', background: 'rgba(255,153,0,.18)' }, amazonStatus: { display: 'inline-flex', alignItems: 'center', minHeight: 25, padding: '3px 9px', borderRadius: 20, fontSize: 9, fontWeight: 850 }, amazonSteps: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 7, marginTop: 12 }, quickStep: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, padding: '8px 9px', borderRadius: 9, border: '1px solid rgba(255,153,0,.22)', background: 'var(--surface)', color: 'var(--text2)' }, amazonActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }, amazonButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 14px', border: 0, borderRadius: 9, background: '#8b4f00', color: '#fff', fontFamily: 'inherit', fontSize: 11, fontWeight: 850, cursor: 'pointer' }, returnHint: { display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 10, padding: '9px 10px', borderRadius: 9, background: 'var(--surface)', color: 'var(--text2)', fontSize: 10, lineHeight: 1.6 },
  actionsPanel: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12, padding: 14, borderRadius: 12, background: 'linear-gradient(135deg,rgba(14,129,119,.08),rgba(25,42,62,.04))', border: '1px solid rgba(14,129,119,.2)' }, helperText: { display: 'block', marginTop: 4, fontSize: 10, color: 'var(--text3)' }, actionButtons: { display: 'flex', gap: 8, flexWrap: 'wrap' }, primaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 14px', border: 0, borderRadius: 9, background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer' }, secondaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer' },
  adminSettings: { marginTop: 12, padding: 12, borderRadius: 11, border: '1px dashed var(--border2)', background: 'var(--surface2)' }, settingsSummary: { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text2)', fontSize: 11, fontWeight: 800, cursor: 'pointer' }, settingsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8, alignItems: 'end', marginTop: 12 }, fieldLabel: { display: 'grid', gap: 5, color: 'var(--text3)', fontSize: 9, fontWeight: 750 }, input: { width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11 }, saveButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', border: 0, borderRadius: 8, background: '#192a3e', color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer' }, adminNote: { margin: '9px 0 0', color: 'var(--warning-text)', fontSize: 9, lineHeight: 1.6 },
  mappingSection: { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }, mappingTitle: { color: 'var(--text)', fontSize: 12, fontWeight: 850 }, mappingHelp: { margin: '4px 0 10px', color: 'var(--text3)', fontSize: 9, lineHeight: 1.7 }, mappingList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(205px,1fr))', gap: 9 }, mappingCard: { display: 'grid', gap: 9, minWidth: 0, padding: 11, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }, mappingHead: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }, mappingStatus: { marginInlineStart: 'auto', fontSize: 9, fontWeight: 750 }, mappingFields: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7 },
  discoveryRow: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 14 }, sectionLabel: { display: 'block', marginBottom: 7, color: 'var(--text3)', fontSize: 9, fontWeight: 800 }, channelChips: { display: 'flex', gap: 6, flexWrap: 'wrap' }, channelChip: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', fontSize: 10, fontWeight: 750 }, dot: { width: 7, height: 7, borderRadius: 99 }, emptyChannels: { color: 'var(--text3)', fontSize: 10 }, lastSync: { display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--success-text)', fontSize: 10 }, metrics: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }, metric: { padding: 10, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', fontSize: 9 }, safetyBox: { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14, padding: 11, borderRadius: 10, background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: 10, lineHeight: 1.7 }, success: { marginTop: 10, padding: '9px 11px', borderRadius: 9, background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: 11 }, warning: { marginTop: 10, padding: '9px 11px', borderRadius: 9, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 11 }, error: { marginTop: 10, padding: '9px 11px', borderRadius: 9, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 11 },
}
