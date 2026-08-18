import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Check, CheckCircle2, KeyRound, Loader2, LockKeyhole, RefreshCw,
  Save, ShieldCheck, Store, Trash2, Unplug,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type ConnectionMode = 'central_account' | 'merchant_account'
type Channel = {
  id: string
  platform_code: string
  platform_name: string
  display_name: string
  seller_ref: string | null
  store_ref: string | null
  status: string
  connection_status?: string
  identity_status?: 'verified' | 'needs_review'
  assigned_merchant_code?: string | null
  last_seen_at?: string | null
}
type Account = {
  mode: ConnectionMode
  token_configured: boolean
  credentials_configured: boolean
  token_hint: string | null
  last_tested_at: string | null
}
type CredentialForm = { client_id: string; client_secret: string; refresh_token: string; access_token: string }
type CentralAccount = {
  configured: boolean
  status: string
  token_hint: string | null
  last_tested_at: string | null
  last_discovered_at: string | null
  last_error: string | null
}

const EMPTY_CREDENTIALS: CredentialForm = { client_id: '', client_secret: '', refresh_token: '', access_token: '' }
const EMPTY_ACCOUNT: Account = {
  mode: 'central_account', token_configured: false, credentials_configured: false,
  token_hint: null, last_tested_at: null,
}

export default function OmnifulAmazonTrialCard({ merchantCode, merchantMode = false }: { merchantCode: string; merchantMode?: boolean }) {
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('central_account')
  const [account, setAccount] = useState<Account>(EMPTY_ACCOUNT)
  const [channels, setChannels] = useState<Channel[]>([])
  const [directory, setDirectory] = useState<Channel[]>([])
  const [centralAccount, setCentralAccount] = useState<CentralAccount | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [credentials, setCredentials] = useState<CredentialForm>(EMPTY_CREDENTIALS)
  const [editingCredentials, setEditingCredentials] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await callOmniful({ action: 'status', merchant_code: merchantCode })
      const nextChannels = (result.channels || []) as Channel[]
      setConnectionMode(result.connection_mode || 'central_account')
      setAccount({ ...EMPTY_ACCOUNT, ...(result.account || {}) })
      setChannels(nextChannels)
      setDirectory((result.directory || []) as Channel[])
      setCentralAccount(result.central_account || null)
      setSelectedIds(nextChannels.map(channel => channel.id))
      setLoaded(true)
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, merchantMode) })
      setLoaded(true)
    }
  }, [merchantCode, merchantMode])

  useEffect(() => { void load() }, [load])

  async function changeMode(mode: ConnectionMode) {
    if (mode === connectionMode) return
    const warning = mode === 'merchant_account'
      ? 'سيتم تحرير القنوات المركزية الحالية، وسيحتاج التاجر إلى ربط حسابه الخاص. متابعة؟'
      : 'سيتم حذف بيانات الحساب الخاص وقنواته، ثم تستخدم الإدارة الحساب المركزي. متابعة؟'
    if (!window.confirm(warning)) return
    setBusy('mode'); setNotice(null)
    try {
      await callOmniful({ action: 'set_connection_mode', merchant_code: merchantCode, connection_mode: mode })
      setNotice({ kind: 'success', text: mode === 'central_account' ? 'تم تحويل التاجر إلى الربط المركزي.' : 'تم إتاحة الربط بحساب خاص للتاجر.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, false) })
    } finally { setBusy(null) }
  }

  async function discover() {
    setBusy('discover'); setNotice(null)
    try {
      const result = await callOmniful({ action: 'discover_channels', merchant_code: merchantCode })
      setNotice({ kind: 'success', text: `تم تحديث دليل القنوات: ${formatNumber(result.discovered_count)} قناة مرصودة.` })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, merchantMode && connectionMode === 'central_account') })
    } finally { setBusy(null) }
  }

  async function assignChannels() {
    setBusy('assign'); setNotice(null)
    try {
      await callOmniful({ action: 'assign_channels', merchant_code: merchantCode, channel_ids: selectedIds })
      setNotice({ kind: 'success', text: `تم حفظ ${formatNumber(selectedIds.length)} قناة لهذا التاجر بوضع المراقبة الآمن.` })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, false) })
    } finally { setBusy(null) }
  }

  async function savePrivateCredentials() {
    setBusy('credentials'); setNotice(null)
    try {
      await callOmniful({ action: 'save_account_credentials', merchant_code: merchantCode, ...credentials })
      setCredentials(EMPTY_CREDENTIALS)
      setEditingCredentials(false)
      await callOmniful({ action: 'discover_channels', merchant_code: merchantCode })
      setNotice({ kind: 'success', text: 'تم اختبار الحساب الخاص وحفظه، واستدعاء قنوات البيع.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, false) })
    } finally { setBusy(null) }
  }

  async function disconnectPrivateAccount() {
    if (!window.confirm('فصل الحساب الخاص وحذف القنوات المستدعاة منه؟')) return
    setBusy('disconnect'); setNotice(null)
    try {
      await callOmniful({ action: 'remove_account_token', merchant_code: merchantCode })
      setNotice({ kind: 'success', text: 'تم فصل الحساب الخاص.' })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, false) })
    } finally { setBusy(null) }
  }

  async function syncShadow() {
    setBusy('sync'); setNotice(null)
    try {
      const result = await callOmniful({ action: 'sync', merchant_code: merchantCode })
      setNotice({ kind: 'success', text: `اكتمل الفحص: ${formatNumber(result.matched_existing)} طلب مطابق و${formatNumber(result.new_shadow)} جديد للمراجعة.` })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error, merchantMode) })
    } finally { setBusy(null) }
  }

  const credentialsReady = credentials.client_id.trim().length >= 4
    && credentials.client_secret.trim().length >= 8
    && credentials.refresh_token.trim().length >= 20
    && credentials.access_token.trim().length >= 20

  if (!loaded) return <div style={styles.loading}><Loader2 size={18} className="spin" /> جاري تحميل قنوات البيع…</div>

  if (merchantMode && connectionMode === 'central_account') {
    return <MerchantManagedChannels channels={channels} busy={busy} notice={notice} onRefresh={() => void load()} onSync={() => void syncShadow()} />
  }

  return <article style={styles.card}>
    <div style={styles.topLine} />
    <div style={styles.body}>
      <header style={styles.header}>
        <div style={styles.titleGroup}>
          <span style={styles.logo}>{connectionMode === 'central_account' ? <ShieldCheck size={21} /> : <KeyRound size={21} />}</span>
          <div>
            <h3 style={styles.title}>{merchantMode ? 'ربط حساب Omniful الخاص' : 'إدارة قنوات Omniful'}</h3>
            <p style={styles.subtitle}>{connectionMode === 'central_account' ? 'الحساب المركزي تحت إدارة Sellpert والقنوات تُعيّن حصرياً' : 'حساب مستقل لهذا التاجر ولا يشارك قنواته مع أي متجر آخر'}</p>
          </div>
        </div>
        <StatusBadge active={connectionMode === 'central_account' ? Boolean(centralAccount?.configured) : account.credentials_configured} />
      </header>

      {!merchantMode ? <section style={styles.modePanel}>
        <div><strong style={styles.sectionTitle}>نوع الربط</strong><span style={styles.helper}>الافتراضي لكل تاجر جديد هو الحساب المركزي.</span></div>
        <div style={styles.segmented}>
          <button type="button" onClick={() => void changeMode('central_account')} disabled={busy !== null} style={{ ...styles.segment, ...(connectionMode === 'central_account' ? styles.segmentActive : {}) }}>مركزي</button>
          <button type="button" onClick={() => void changeMode('merchant_account')} disabled={busy !== null} style={{ ...styles.segment, ...(connectionMode === 'merchant_account' ? styles.segmentActive : {}) }}>حساب خاص</button>
        </div>
      </section> : null}

      {connectionMode === 'central_account' && !merchantMode ? <>
        <section style={styles.accountSummary}>
          <div><strong style={styles.sectionTitle}>حساب Sellpert المركزي</strong><span style={styles.helper}>{centralAccount?.configured ? `الاتصال محفوظ ومشفر${centralAccount.token_hint ? ` · ••••${centralAccount.token_hint}` : ''}` : 'الحساب المركزي غير مكتمل'}</span></div>
          <button type="button" onClick={() => void discover()} disabled={busy !== null || !centralAccount?.configured} style={styles.primaryButton}>{busy === 'discover' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} تحقق من القنوات</button>
        </section>
        <ChannelDirectory channels={directory} merchantCode={merchantCode} selectedIds={selectedIds} onToggle={channelId => setSelectedIds(current => current.includes(channelId) ? current.filter(id => id !== channelId) : [...current, channelId])} />
        <div style={styles.footerActions}><span style={styles.selectionCount}>{formatNumber(selectedIds.length)} قناة مختارة</span><button type="button" onClick={() => void assignChannels()} disabled={busy !== null} style={styles.saveButton}>{busy === 'assign' ? <Loader2 size={15} className="spin" /> : <Save size={15} />} حفظ ربط القنوات</button></div>
      </> : null}

      {connectionMode === 'merchant_account' ? merchantMode ? <>
        {account.credentials_configured && !editingCredentials ? <section style={styles.privateConnected}>
          <div><strong style={styles.connectedTitle}><CheckCircle2 size={16} /> الحساب الخاص متصل</strong><span style={styles.helper}>بيانات الاعتماد محفوظة ومشفرة ولا تظهر بعد الحفظ.</span></div>
          <div style={styles.actionRow}>
            <button type="button" onClick={() => void discover()} disabled={busy !== null} style={styles.secondaryButton}><RefreshCw size={14} /> تحديث القنوات</button>
            <button type="button" onClick={() => setEditingCredentials(true)} disabled={busy !== null} style={styles.secondaryButton}><KeyRound size={14} /> إعادة اتصال</button>
            <button type="button" onClick={() => void disconnectPrivateAccount()} disabled={busy !== null} style={styles.dangerButton}>{busy === 'disconnect' ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} فصل</button>
          </div>
        </section> : <PrivateCredentialsForm credentials={credentials} onChange={(field, value) => setCredentials(current => ({ ...current, [field]: value }))} onSave={() => void savePrivateCredentials()} onCancel={account.credentials_configured ? () => setEditingCredentials(false) : undefined} disabled={busy !== null} ready={credentialsReady} />}
        <PrivateChannelList channels={channels} onSync={() => void syncShadow()} busy={busy} />
      </> : <section style={styles.awaitingPanel}><LockKeyhole size={20} /><div><strong>الحساب الخاص متاح للتاجر</strong><span style={styles.helper}>سيظهر له نموذج الربط واستدعاء القنوات. لا تحتاج الإدارة إلى إدخال أسراره.</span></div></section> : null}

      <div style={styles.safety}><ShieldCheck size={16} /><span><strong>المصادر الحالية مستمرة:</strong> ملفات Amazon وNoon وربط Trendyol المباشر لن تتغير. جميع القنوات الجديدة تبدأ بوضع المراقبة فقط.</span></div>
      {notice ? <Notice notice={notice} /> : null}
    </div>
  </article>
}

function MerchantManagedChannels({ channels, busy, notice, onRefresh, onSync }: { channels: Channel[]; busy: string | null; notice: { kind: 'success' | 'error'; text: string } | null; onRefresh: () => void; onSync: () => void }) {
  return <article style={styles.card}><div style={styles.topLine} /><div style={styles.body}>
    <header style={styles.header}><div style={styles.titleGroup}><span style={styles.logo}><Store size={21} /></span><div><h3 style={styles.title}>قنوات البيع المتصلة</h3><p style={styles.subtitle}>تدير Sellpert الاتصال تقنياً، وتظهر لك قنوات متجرك فقط.</p></div></div><span style={styles.protectedBadge}><ShieldCheck size={13} /> مُدار وآمن</span></header>
    {channels.length > 0 ? <div style={styles.channelGrid}>{channels.map(channel => <div key={channel.id} style={styles.channelCard}><PlatformMark code={channel.platform_code} /><div style={{ minWidth: 0, flex: 1 }}><strong style={styles.channelName}>{channel.platform_name}</strong><span style={styles.channelRef}>{channel.store_ref || channel.seller_ref || 'قناة متصلة'}</span></div><span style={styles.connectedPill}><Check size={12} /> متصل</span></div>)}</div> : <div style={styles.empty}><Unplug size={22} /><strong>لا توجد قناة معيّنة بعد</strong><span>ستظهر القنوات هنا فور اعتمادها من الإدارة.</span></div>}
    <div style={styles.footerActions}><button type="button" onClick={onRefresh} disabled={busy !== null} style={styles.secondaryButton}><RefreshCw size={14} /> تحديث الحالة</button>{channels.length > 0 ? <button type="button" onClick={onSync} disabled={busy !== null} style={styles.primaryButton}>{busy === 'sync' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} مزامنة تجريبية</button> : null}</div>
    <div style={styles.safety}><ShieldCheck size={16} /><span>قنواتك معزولة عن بقية التجار، والمصادر الحالية تبقى فعالة خلال الاختبار.</span></div>{notice ? <Notice notice={notice} /> : null}
  </div></article>
}

function ChannelDirectory({ channels, merchantCode, selectedIds, onToggle }: { channels: Channel[]; merchantCode: string; selectedIds: string[]; onToggle: (channelId: string) => void }) {
  if (channels.length === 0) return <div style={styles.empty}><Store size={22} /><strong>لم تُكتشف قنوات بعد</strong><span>اضغط «تحقق من القنوات» لقراءة الحساب المركزي.</span></div>
  return <section style={{ marginTop: 16 }}><div style={styles.directoryHeader}><div><strong style={styles.sectionTitle}>دليل القنوات المركزي</strong><span style={styles.helper}>يمكن اختيار عدة قنوات. القناة المرتبطة بتاجر آخر تكون مقفلة.</span></div><span style={styles.countBadge}>{formatNumber(channels.length)} قناة</span></div><div style={styles.channelGrid}>{channels.map(channel => {
    const assignedElsewhere = Boolean(channel.assigned_merchant_code && channel.assigned_merchant_code !== merchantCode)
    const needsReview = channel.identity_status === 'needs_review'
    const disabled = assignedElsewhere || needsReview || channel.status !== 'active'
    const checked = selectedIds.includes(channel.id)
    return <button type="button" key={channel.id} onClick={() => !disabled && onToggle(channel.id)} disabled={disabled} style={{ ...styles.selectableChannel, ...(checked ? styles.selectedChannel : {}), opacity: disabled ? 0.58 : 1 }}><span style={{ ...styles.checkbox, ...(checked ? styles.checkboxActive : {}) }}>{checked ? <Check size={13} /> : null}</span><PlatformMark code={channel.platform_code} /><span style={{ flex: 1, minWidth: 0, textAlign: 'right' }}><strong style={styles.channelName}>{channel.platform_name}</strong><small style={styles.channelRef}>{channel.store_ref || channel.seller_ref || channel.display_name}</small></span><small style={assignedElsewhere ? styles.lockedText : needsReview ? styles.reviewText : styles.availableText}>{assignedElsewhere ? `مرتبط بـ ${channel.assigned_merchant_code}` : needsReview ? 'يحتاج تثبيت الهوية' : checked ? 'مختار' : 'متاح'}</small></button>
  })}</div></section>
}

function PrivateCredentialsForm({ credentials, onChange, onSave, onCancel, disabled, ready }: { credentials: CredentialForm; onChange: (field: keyof CredentialForm, value: string) => void; onSave: () => void; onCancel?: () => void; disabled: boolean; ready: boolean }) {
  return <section style={styles.credentialsPanel}><div><strong style={styles.sectionTitle}>بيانات حساب Omniful الخاص</strong><span style={styles.helper}>تُحفظ مشفرة، ولا يمكن عرضها بعد الحفظ.</span></div><div style={styles.formGrid}><CredentialInput label="Client ID" value={credentials.client_id} onChange={value => onChange('client_id', value)} /><CredentialInput label="Client Secret" value={credentials.client_secret} onChange={value => onChange('client_secret', value)} /><CredentialInput label="Refresh Token" value={credentials.refresh_token} onChange={value => onChange('refresh_token', value)} /><CredentialInput label="Access Token" value={credentials.access_token} onChange={value => onChange('access_token', value)} /></div><div style={styles.actionRow}><button type="button" onClick={onSave} disabled={disabled || !ready} style={{ ...styles.saveButton, opacity: disabled || !ready ? 0.55 : 1 }}><KeyRound size={14} /> اختبار وحفظ</button>{onCancel ? <button type="button" onClick={onCancel} disabled={disabled} style={styles.secondaryButton}>إلغاء</button> : null}</div></section>
}

function PrivateChannelList({ channels, onSync, busy }: { channels: Channel[]; onSync: () => void; busy: string | null }) {
  if (channels.length === 0) return null
  return <section style={{ marginTop: 16 }}><div style={styles.directoryHeader}><strong style={styles.sectionTitle}>القنوات المستدعاة</strong><button type="button" onClick={onSync} disabled={busy !== null} style={styles.secondaryButton}><RefreshCw size={14} /> مزامنة تجريبية</button></div><div style={styles.channelGrid}>{channels.map(channel => <div key={channel.id} style={styles.channelCard}><PlatformMark code={channel.platform_code} /><div style={{ flex: 1 }}><strong style={styles.channelName}>{channel.platform_name}</strong><span style={styles.channelRef}>{channel.store_ref || channel.seller_ref}</span></div><span style={styles.connectedPill}><Check size={12} /> متصل</span></div>)}</div></section>
}

function CredentialInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label style={styles.fieldLabel}>{label}<input dir="ltr" type="password" value={value} onChange={event => onChange(event.target.value)} autoComplete="new-password" spellCheck={false} style={styles.input} /></label>
}
function PlatformMark({ code }: { code: string }) { const color = platformColor(code); return <span style={{ ...styles.platformMark, background: color.background, color: color.text }}>{code.slice(0, 1).toUpperCase()}</span> }
function StatusBadge({ active }: { active: boolean }) { return <span style={{ ...styles.statusBadge, background: active ? 'var(--success-bg)' : 'var(--warning-bg)', color: active ? 'var(--success-text)' : 'var(--warning-text)' }}>{active ? <CheckCircle2 size={13} /> : <Unplug size={13} />}{active ? 'جاهز' : 'غير مكتمل'}</span> }
function Notice({ notice }: { notice: { kind: 'success' | 'error'; text: string } }) { return <div style={notice.kind === 'success' ? styles.success : styles.error}>{notice.text}</div> }

async function callOmniful(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession()
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-omniful-amazon`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result
}
function errorMessage(error: unknown, hideProvider: boolean) { const message = error instanceof Error ? error.message : 'تعذر تنفيذ العملية'; return hideProvider ? message.replace(/omniful/gi, 'مزود الربط') : message }
function formatNumber(value: unknown) { return Number(value || 0).toLocaleString('en-US') }
function platformColor(code: string) { if (code === 'amazon') return { background: '#fff3df', text: '#a85f00' }; if (code === 'noon') return { background: '#fffbd7', text: '#837100' }; if (code === 'trendyol') return { background: '#fff0e6', text: '#b64800' }; return { background: 'var(--accent-soft)', text: 'var(--accent)' } }

const styles: Record<string, CSSProperties> = {
  card: { maxWidth: 920, marginTop: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow)' }, topLine: { height: 3, background: 'linear-gradient(90deg,#192a3e,#0e8177)' }, body: { padding: 18 }, loading: { display: 'flex', alignItems: 'center', gap: 8, padding: 24, color: 'var(--text3)', fontSize: 12 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }, titleGroup: { display: 'flex', alignItems: 'center', gap: 11 }, logo: { width: 42, height: 42, display: 'grid', placeItems: 'center', flex: '0 0 auto', borderRadius: 11, background: 'var(--accent-soft)', color: 'var(--accent)' }, title: { margin: 0, fontSize: 16, color: 'var(--text)' }, subtitle: { margin: '4px 0 0', fontSize: 11, lineHeight: 1.7, color: 'var(--text3)' }, statusBadge: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 20, fontSize: 10, fontWeight: 800 }, protectedBadge: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 20, background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: 10, fontWeight: 800 },
  modePanel: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 16, padding: 13, borderRadius: 11, background: 'var(--surface2)', border: '1px solid var(--border)' }, sectionTitle: { display: 'block', fontSize: 12, color: 'var(--text)' }, helper: { display: 'block', marginTop: 4, color: 'var(--text3)', fontSize: 10, lineHeight: 1.7 }, segmented: { display: 'flex', padding: 3, borderRadius: 9, background: 'var(--surface3)' }, segment: { minWidth: 95, padding: '7px 11px', border: 0, borderRadius: 7, background: 'transparent', color: 'var(--text3)', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer' }, segmentActive: { background: 'var(--surface)', color: 'var(--accent)', boxShadow: '0 1px 4px rgba(15,23,42,.1)' },
  accountSummary: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 14, padding: 14, borderRadius: 11, border: '1px solid rgba(14,129,119,.22)', background: 'rgba(14,129,119,.05)' }, actionRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, primaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', border: 0, borderRadius: 8, background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer' }, secondaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text2)', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer' }, saveButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 13px', border: 0, borderRadius: 8, background: '#192a3e', color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer' }, dangerButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 11px', border: '1px solid var(--danger-border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--danger-text)', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer' },
  directoryHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 9 }, countBadge: { padding: '4px 8px', borderRadius: 20, background: 'var(--surface2)', color: 'var(--text3)', fontSize: 9, fontWeight: 800 }, channelGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(245px,1fr))', gap: 8, marginTop: 10 }, channelCard: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, padding: 11, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface2)' }, selectableChannel: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, padding: 11, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer' }, selectedChannel: { borderColor: 'rgba(14,129,119,.55)', background: 'rgba(14,129,119,.055)', boxShadow: '0 0 0 1px rgba(14,129,119,.08)' }, checkbox: { width: 19, height: 19, display: 'grid', placeItems: 'center', flex: '0 0 auto', borderRadius: 6, border: '1px solid var(--border2)', color: '#fff' }, checkboxActive: { background: 'var(--accent)', borderColor: 'var(--accent)' }, platformMark: { width: 34, height: 34, display: 'grid', placeItems: 'center', flex: '0 0 auto', borderRadius: 9, fontWeight: 900 }, channelName: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }, channelRef: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3, color: 'var(--text3)', fontSize: 9 }, connectedPill: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 7px', borderRadius: 20, background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: 9, fontWeight: 800 }, availableText: { color: 'var(--success-text)', fontSize: 8 }, lockedText: { color: 'var(--danger-text)', fontSize: 8 }, reviewText: { color: 'var(--warning-text)', fontSize: 8 }, footerActions: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 12 }, selectionCount: { marginInlineEnd: 'auto', color: 'var(--text3)', fontSize: 10 },
  credentialsPanel: { marginTop: 16, padding: 14, borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface2)' }, formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 9, margin: '12px 0' }, fieldLabel: { display: 'grid', gap: 5, color: 'var(--text3)', fontSize: 9, fontWeight: 750 }, input: { width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'monospace', fontSize: 11 }, privateConnected: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 16, padding: 14, borderRadius: 11, border: '1px solid rgba(14,129,119,.22)', background: 'rgba(14,129,119,.05)' }, connectedTitle: { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success-text)', fontSize: 12 }, awaitingPanel: { display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16, padding: 14, borderRadius: 11, background: 'var(--surface2)', color: 'var(--text2)' }, empty: { display: 'grid', placeItems: 'center', gap: 6, marginTop: 14, padding: 28, borderRadius: 11, border: '1px dashed var(--border2)', background: 'var(--surface2)', color: 'var(--text3)', textAlign: 'center', fontSize: 10 }, safety: { display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 14, padding: 10, borderRadius: 9, background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: 9, lineHeight: 1.7 }, success: { marginTop: 10, padding: '9px 11px', borderRadius: 9, background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: 10 }, error: { marginTop: 10, padding: '9px 11px', borderRadius: 9, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 10 },
}
