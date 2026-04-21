import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant, PlatformCredential, SyncLog } from '../lib/supabase'

const PLATFORMS = [
  {
    id: 'trendyol',
    name: 'Trendyol',
    nameAr: 'تراندايول',
    color: '#f27a1a',
    logo: '🟠',
    description: 'أكبر منصة تجارة إلكترونية في تركيا، تنمو بسرعة في السعودية',
    fields: [
      { key: 'seller_id', label: 'Seller ID', placeholder: 'مثال: 123456', hint: 'رقم حسابك كبائع في تراندايول' },
      { key: 'api_key', label: 'API Key', placeholder: 'المفتاح من قسم Integration', hint: '' },
      { key: 'api_secret', label: 'API Secret', placeholder: 'السر من قسم Integration', hint: '', secret: true },
    ],
    guide: [
      { step: 1, title: 'سجّل دخولك', desc: 'اذهب إلى seller.trendyol.com وسجّل دخولك بحساب البائع' },
      { step: 2, title: 'فتح إعدادات الحساب', desc: 'من القائمة العلوية → "Account" → "User Settings"' },
      { step: 3, title: 'قسم Integration', desc: 'ابحث عن تبويب "Integration Information" أو "API Access"' },
      { step: 4, title: 'انسخ البيانات', desc: 'انسخ الـ Seller ID ثم الـ API Key والـ API Secret' },
      { step: 5, title: 'الصق هنا', desc: 'ضع البيانات في الحقول أدناه واضغط "ربط الحساب"' },
    ],
  },
  {
    id: 'noon',
    name: 'Noon',
    nameAr: 'نون',
    color: '#ffe600',
    textColor: '#1a1a1a',
    logo: '🟡',
    description: 'المنصة الرائدة في السعودية والإمارات والكويت',
    fields: [
      { key: 'seller_id', label: 'Seller ID / Partner ID', placeholder: 'معرّف حسابك في نون', hint: 'تجده في إعدادات حسابك' },
      { key: 'service_account_json', label: 'Service Account JSON', placeholder: '{ "type": "service_account", ... }', hint: 'ملف JSON الذي تحمّله من لوحة نون', secret: true, multiline: true },
    ],
    guide: [
      { step: 1, title: 'سجّل دخولك', desc: 'اذهب إلى noon.partners وسجّل دخولك بحساب الشريك' },
      { step: 2, title: 'إدارة المستخدمين', desc: 'من القائمة الجانبية: "User & Access" → "Project Users"' },
      { step: 3, title: 'إنشاء Service Account', desc: 'اضغط "+ Create Service Account" وأدخل اسماً للتكامل' },
      { step: 4, title: 'تحميل ملف JSON', desc: 'اضغط "Generate Key" ثم حمّل ملف الـ JSON الناتج' },
      { step: 5, title: 'انسخ محتوى الملف', desc: 'افتح الملف بأي محرر نصوص، انسخ كل المحتوى، الصقه أدناه' },
    ],
  },
  {
    id: 'amazon',
    name: 'Amazon',
    nameAr: 'أمازون',
    color: '#ff9900',
    logo: '📦',
    description: 'أكبر سوق إلكتروني عالمياً، متوفر في السعودية عبر amazon.sa',
    fields: [
      { key: 'seller_id', label: 'Seller ID (Merchant ID)', placeholder: 'مثال: A3EXAMPLE123', hint: 'من Seller Central → Account Info' },
      { key: 'api_key', label: 'LWA Client ID', placeholder: 'amzn1.application-oa2-client.xxx', hint: 'من صفحة تطبيق SP-API' },
      { key: 'api_secret', label: 'LWA Client Secret', placeholder: 'xxx...', hint: '', secret: true },
      { key: 'refresh_token', label: 'Refresh Token', placeholder: 'Atzr|xxx...', hint: 'من صفحة Authorization في SP-API', secret: true },
    ],
    guide: [
      { step: 1, title: 'تسجيل كمطور', desc: 'اذهب إلى sellercentral.amazon.sa → Apps & Services → Develop Apps' },
      { step: 2, title: 'إنشاء تطبيق SP-API', desc: 'اضغط "Add new app client" واختر "Private seller app"' },
      { step: 3, title: 'الحصول على Client ID و Secret', desc: 'بعد الإنشاء ستجد الـ Client ID والـ Client Secret في تفاصيل التطبيق' },
      { step: 4, title: 'الحصول على Refresh Token', desc: 'من صفحة التطبيق → "Authorize" → اتبع خطوات OAuth — انسخ الـ Refresh Token الناتج' },
      { step: 5, title: 'Seller ID', desc: 'من Seller Central → Settings → Account Info → انسخ الـ Merchant Token' },
      { step: 6, title: 'الصق هنا', desc: 'ضع جميع البيانات في الحقول أدناه واضغط "ربط الحساب"' },
    ],
    warning: 'يستغرق تسجيل تطبيق SP-API من أمازون 1-3 أيام عمل للموافقة.',
  },
]

const PLATFORM_EDGE_FN: Record<string, string> = {
  trendyol: 'sync-trendyol',
  noon: 'sync-noon',
  amazon: 'sync-amazon',
}

export default function Integrations({ merchant }: { merchant: Merchant | null }) {
  const [credentials, setCredentials] = useState<Record<string, PlatformCredential>>({})
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string; platform: string } | null>(null)

  useEffect(() => { if (merchant) loadData() }, [merchant])

  async function loadData() {
    const { data: creds } = await supabase
      .from('platform_credentials')
      .select('*')
      .eq('merchant_code', merchant!.merchant_code)

    const map: Record<string, PlatformCredential> = {}
    for (const c of creds || []) map[c.platform] = c
    setCredentials(map)

    const { data: logs } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('merchant_code', merchant!.merchant_code)
      .order('started_at', { ascending: false })
      .limit(20)
    setSyncLogs(logs || [])
  }

  function setField(platform: string, key: string, val: string) {
    setForms(prev => ({ ...prev, [platform]: { ...(prev[platform] || {}), [key]: val } }))
  }

  async function saveCredentials(platformId: string) {
    setSaving(platformId)
    setMsg(null)
    const form = forms[platformId] || {}
    const platform = PLATFORMS.find(p => p.id === platformId)!

    const isNoon = platformId === 'noon'
    const isAmazon = platformId === 'amazon'

    let extra: Record<string, any> = {}
    if (isNoon && form.service_account_json) {
      try { extra.service_account = JSON.parse(form.service_account_json) }
      catch { setMsg({ type: 'err', text: 'ملف JSON غير صحيح، تأكد من نسخ المحتوى كاملاً', platform: platformId }); setSaving(null); return }
    }
    if (isAmazon && form.refresh_token) {
      extra.refresh_token = form.refresh_token
    }

    const payload = {
      merchant_code: merchant!.merchant_code,
      platform: platformId,
      seller_id: form.seller_id || null,
      api_key: isNoon ? null : (form.api_key || null),
      api_secret: isNoon ? null : (form.api_secret || null),
      extra,
      is_active: false,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('platform_credentials').upsert(payload, { onConflict: 'merchant_code,platform' })

    if (error) {
      setMsg({ type: 'err', text: 'خطأ في الحفظ: ' + error.message, platform: platformId })
    } else {
      setMsg({ type: 'ok', text: 'تم حفظ البيانات. اضغط "مزامنة الآن" للاتصال والاختبار', platform: platformId })
      await loadData()
    }
    setSaving(null)
  }

  async function triggerSync(platformId: string) {
    setSyncing(platformId)
    setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const fnName = PLATFORM_EDGE_FN[platformId]
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

      const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ merchant_code: merchant!.merchant_code }),
      })

      const json = await res.json()
      if (!res.ok || json.error) {
        setMsg({ type: 'err', text: json.error || 'خطأ في المزامنة', platform: platformId })
      } else {
        setMsg({ type: 'ok', text: `✓ تمت المزامنة — ${json.orders} طلب في ${json.days_synced} يوم`, platform: platformId })
        await loadData()
      }
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message, platform: platformId })
    }
    setSyncing(null)
  }

  async function disconnect(platformId: string) {
    await supabase.from('platform_credentials')
      .update({ is_active: false })
      .eq('merchant_code', merchant!.merchant_code)
      .eq('platform', platformId)
    await loadData()
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div>
          <h2 style={S.title}>ربط المنصات</h2>
          <p style={S.sub}>اربط حساباتك على نون وأمازون وتراندايول لسحب بيانات المبيعات تلقائياً</p>
        </div>
      </div>

      {/* PLATFORM CARDS */}
      <div style={S.cardsGrid}>
        {PLATFORMS.map(platform => {
          const cred = credentials[platform.id]
          const isConnected = cred?.is_active
          const hasCreds = !!cred
          const isExpanded = expanded === platform.id
          const form = forms[platform.id] || {}
          const isSaving = saving === platform.id
          const isSyncing = syncing === platform.id
          const platformMsg = msg?.platform === platform.id ? msg : null

          return (
            <div key={platform.id} style={{ ...S.platformCard, ...(isExpanded ? S.platformCardExpanded : {}) }}>
              {/* Card Header */}
              <div style={S.cardHeader}>
                <div style={S.platformInfo}>
                  <div style={{ ...S.platformIcon, background: platform.color + '22', border: `1px solid ${platform.color}44` }}>
                    <span style={{ fontSize: 24 }}>{platform.logo}</span>
                  </div>
                  <div>
                    <div style={S.platformName}>{platform.nameAr}</div>
                    <div style={S.platformDesc}>{platform.description}</div>
                  </div>
                </div>
                <div style={S.cardActions}>
                  {isConnected && (
                    <span style={S.connectedBadge}>● متصل</span>
                  )}
                  {hasCreds && !isConnected && (
                    <span style={S.pendingBadge}>○ غير نشط</span>
                  )}
                  {!hasCreds && (
                    <span style={S.notConnectedBadge}>○ غير مربوط</span>
                  )}
                  <button
                    style={{ ...S.toggleBtn, background: isExpanded ? 'var(--surface3)' : 'var(--surface2)' }}
                    onClick={() => setExpanded(isExpanded ? null : platform.id)}
                  >
                    {isExpanded ? 'إغلاق ▲' : (hasCreds ? 'إعدادات ▼' : 'ربط ▼')}
                  </button>
                </div>
              </div>

              {/* Stats row if connected */}
              {isConnected && cred && (
                <div style={S.statsRow}>
                  <div style={S.stat}>
                    <span style={S.statLabel}>آخر مزامنة</span>
                    <span style={S.statVal}>
                      {cred.last_sync_at ? new Date(cred.last_sync_at).toLocaleString('ar-SA') : '—'}
                    </span>
                  </div>
                  <div style={S.stat}>
                    <span style={S.statLabel}>طلبات مزامنة</span>
                    <span style={S.statVal}>{cred.records_synced?.toLocaleString() || 0}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      style={{ ...S.syncBtn, background: platform.color }}
                      onClick={() => triggerSync(platform.id)}
                      disabled={isSyncing}
                    >
                      {isSyncing ? '⟳ جاري...' : '⟳ مزامنة الآن'}
                    </button>
                    <button style={S.disconnectBtn} onClick={() => disconnect(platform.id)}>فصل</button>
                  </div>
                </div>
              )}

              {/* Expanded: Guide + Form */}
              {isExpanded && (
                <div style={S.expandedBody}>
                  {/* Step by step guide */}
                  <div style={S.guideSection}>
                    <div style={S.guideTitle}>📋 خطوات الربط</div>
                    {platform.guide.map(g => (
                      <div key={g.step} style={S.guideStep}>
                        <div style={{ ...S.stepNum, background: platform.color }}>{g.step}</div>
                        <div>
                          <div style={S.stepTitle}>{g.title}</div>
                          <div style={S.stepDesc}>{g.desc}</div>
                        </div>
                      </div>
                    ))}
                    {platform.warning && (
                      <div style={S.warning}>⚠️ {platform.warning}</div>
                    )}
                  </div>

                  {/* Credentials form */}
                  <div style={S.formSection}>
                    <div style={S.formTitle}>🔑 بيانات الربط</div>

                    {platformMsg && (
                      <div style={{ ...S.msgBox, ...(platformMsg.type === 'err' ? S.msgErr : S.msgOk) }}>
                        {platformMsg.text}
                      </div>
                    )}

                    {platform.fields.map(field => (
                      <div key={field.key} style={S.formField}>
                        <label style={S.label}>{field.label}</label>
                        {field.hint && <div style={S.hint}>{field.hint}</div>}
                        {(field as any).multiline ? (
                          <textarea
                            style={{ ...S.input, height: 100, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
                            placeholder={field.placeholder}
                            value={form[field.key] || ''}
                            onChange={e => setField(platform.id, field.key, e.target.value)}
                          />
                        ) : (
                          <input
                            style={S.input}
                            type={(field as any).secret ? 'password' : 'text'}
                            placeholder={field.placeholder}
                            value={form[field.key] || ''}
                            onChange={e => setField(platform.id, field.key, e.target.value)}
                          />
                        )}
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                      <button
                        style={{ ...S.saveBtn, background: platform.color, color: platform.textColor || '#fff' }}
                        onClick={() => saveCredentials(platform.id)}
                        disabled={isSaving}
                      >
                        {isSaving ? 'جاري الحفظ...' : '💾 حفظ البيانات'}
                      </button>
                      {hasCreds && (
                        <button
                          style={{ ...S.syncBtn, background: platform.color, color: platform.textColor || '#fff' }}
                          onClick={() => triggerSync(platform.id)}
                          disabled={isSyncing}
                        >
                          {isSyncing ? '⟳ جاري المزامنة...' : '⟳ مزامنة الآن'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* SYNC LOGS */}
      <div style={S.logsCard}>
        <div style={S.logsHeader}>
          <div style={S.logsTitle}>سجل المزامنات</div>
          <span style={S.badge}>{syncLogs.length} عملية</span>
        </div>
        {syncLogs.length === 0 ? (
          <div style={S.empty}>لا توجد مزامنات بعد — اربط منصة وابدأ</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                {['المنصة', 'الحالة', 'السجلات', 'الوقت', 'المدة', 'الخطأ'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {syncLogs.map(log => {
                const duration = log.finished_at
                  ? Math.round((new Date(log.finished_at).getTime() - new Date(log.started_at).getTime()) / 1000)
                  : null
                return (
                  <tr key={log.id} style={S.tr}>
                    <td style={S.td}>
                      <span style={S.platformTag}>
                        {PLATFORMS.find(p => p.id === log.platform)?.nameAr || log.platform}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={{
                        ...S.statusBadge,
                        background: log.status === 'success' ? 'rgba(0,229,176,0.15)' : log.status === 'error' ? 'rgba(255,77,109,0.15)' : 'rgba(255,209,102,0.15)',
                        color: log.status === 'success' ? 'var(--green)' : log.status === 'error' ? 'var(--red)' : '#ffd166',
                      }}>
                        {log.status === 'success' ? '✓ نجح' : log.status === 'error' ? '✕ خطأ' : '⟳ جاري'}
                      </span>
                    </td>
                    <td style={S.td}>{log.records_synced?.toLocaleString() || 0}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>
                      {new Date(log.started_at).toLocaleString('ar-SA')}
                    </td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>
                      {duration !== null ? `${duration}ث` : '—'}
                    </td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--red)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.error_message || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: '32px', minHeight: '100vh', maxWidth: 1400, margin: '0 auto' },
  header: { marginBottom: 28 },
  title: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  sub: { fontSize: 13, color: 'var(--text2)', marginTop: 4 },

  cardsGrid: { display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 },
  platformCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, overflow: 'hidden',
  },
  platformCardExpanded: { border: '1px solid var(--accent)' },
  cardHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 24px',
  },
  platformInfo: { display: 'flex', alignItems: 'center', gap: 16 },
  platformIcon: {
    width: 56, height: 56, borderRadius: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  platformName: { fontSize: 17, fontWeight: 700 },
  platformDesc: { fontSize: 12, color: 'var(--text3)', marginTop: 3 },
  cardActions: { display: 'flex', alignItems: 'center', gap: 12 },
  connectedBadge: { fontSize: 12, fontWeight: 700, color: 'var(--green)', background: 'rgba(0,229,176,0.1)', padding: '4px 12px', borderRadius: 20 },
  pendingBadge: { fontSize: 12, fontWeight: 700, color: '#ffd166', background: 'rgba(255,209,102,0.1)', padding: '4px 12px', borderRadius: 20 },
  notConnectedBadge: { fontSize: 12, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', padding: '4px 12px', borderRadius: 20 },
  toggleBtn: {
    border: '1px solid var(--border)', color: 'var(--text)',
    padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },

  statsRow: {
    display: 'flex', alignItems: 'center', gap: 24,
    padding: '12px 24px 16px',
    borderTop: '1px solid var(--border)',
    background: 'var(--surface2)',
  },
  stat: { display: 'flex', flexDirection: 'column', gap: 2 },
  statLabel: { fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase' },
  statVal: { fontSize: 13, fontWeight: 700 },

  syncBtn: {
    border: 'none', color: '#fff', padding: '8px 18px',
    borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  disconnectBtn: {
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text3)', padding: '8px 14px', borderRadius: 9,
    fontSize: 12, cursor: 'pointer',
  },

  expandedBody: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
    borderTop: '1px solid var(--border)',
  },
  guideSection: {
    padding: '24px', borderRight: '1px solid var(--border)',
    background: 'rgba(108,99,255,0.03)',
  },
  guideTitle: { fontSize: 13, fontWeight: 700, marginBottom: 16, color: 'var(--text2)' },
  guideStep: { display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' },
  stepNum: {
    width: 26, height: 26, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0,
  },
  stepTitle: { fontSize: 13, fontWeight: 700 },
  stepDesc: { fontSize: 12, color: 'var(--text2)', marginTop: 2, lineHeight: 1.5 },
  warning: {
    background: 'rgba(255,209,102,0.1)', border: '1px solid rgba(255,209,102,0.3)',
    color: '#ffd166', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginTop: 8,
  },

  formSection: { padding: '24px' },
  formTitle: { fontSize: 13, fontWeight: 700, marginBottom: 16, color: 'var(--text2)' },
  formField: { marginBottom: 14 },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' },
  hint: { fontSize: 11, color: 'var(--text3)', marginBottom: 5 },
  input: {
    width: '100%', padding: '10px 12px',
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 9, color: 'var(--text)', fontSize: 13, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box' as const,
  },
  saveBtn: {
    border: 'none', padding: '10px 22px',
    borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  msgBox: { borderRadius: 8, padding: '10px 14px', fontSize: 12, marginBottom: 14 },
  msgOk: { background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.3)', color: 'var(--green)' },
  msgErr: { background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)', color: 'var(--red)' },

  logsCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, overflow: 'hidden',
  },
  logsHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 24px', borderBottom: '1px solid var(--border)',
  },
  logsTitle: { fontSize: 14, fontWeight: 700 },
  badge: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text2)', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace',
  },
  empty: { padding: '40px', textAlign: 'center' as const, color: 'var(--text3)', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: {
    padding: '10px 20px', textAlign: 'right' as const,
    fontSize: 11, fontWeight: 700, color: 'var(--text3)',
    background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
  },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 20px', fontSize: 13 },
  platformTag: {
    background: 'rgba(108,99,255,0.15)', color: 'var(--accent)',
    padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
  },
  statusBadge: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
}
