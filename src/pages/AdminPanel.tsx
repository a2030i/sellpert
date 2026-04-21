import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant, PerformanceData, PlatformCredential, SyncLog, AiInsight, PlatformConnection, MerchantPlatformMapping } from '../lib/supabase'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'

// ─── Constants ───────────────────────────────────────────────────────────────

type AdminView = 'overview' | 'merchants' | 'performance' | 'connections' | 'synclogs' | 'ai' | 'entry'

const ADMIN_VIEWS: AdminView[] = ['overview', 'merchants', 'performance', 'connections', 'synclogs', 'ai', 'entry']

function readAdminHash(): AdminView {
  const h = window.location.hash.replace('#admin-', '') as AdminView
  return ADMIN_VIEWS.includes(h) ? h : 'overview'
}

const NAV = [
  { key: 'overview' as AdminView,     icon: '🏠', label: 'نظرة عامة'       },
  { key: 'merchants' as AdminView,    icon: '👥', label: 'التجار'           },
  { key: 'performance' as AdminView,  icon: '📊', label: 'الأداء'           },
  { key: 'connections' as AdminView,  icon: '🔑', label: 'المفاتيح والربط'  },
  { key: 'synclogs' as AdminView,     icon: '🔄', label: 'سجل المزامنات'   },
  { key: 'ai' as AdminView,           icon: '🤖', label: 'تحليل AI'         },
  { key: 'entry' as AdminView,        icon: '📝', label: 'إدخال يدوي'       },
]

const PLATFORM_MAP: Record<string, string> = {
  trendyol: 'تراندايول', noon: 'نون', amazon: 'أمازون',
  salla: 'سلة', zid: 'زد', shopify: 'شوبيفاي', other: 'أخرى',
  respondly: 'Respondly واتساب',
}
const PLATFORM_COLORS: Record<string, string> = {
  trendyol: '#f27a1a', noon: '#f5c518', amazon: '#ff9900',
  salla: '#7c6bff', zid: '#00e5b0', shopify: '#96bf48', other: '#5a5a7a',
  respondly: '#25D366',
}
const CHART_COLORS = ['#7c6bff', '#00e5b0', '#ff9900', '#f27a1a', '#ff6b6b', '#4cc9f0']

function fmt(v: number, type: 'currency' | 'percent' | 'number' = 'currency') {
  if (type === 'currency') return v.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر.س'
  if (type === 'percent') return v.toFixed(1) + '%'
  return v.toLocaleString('ar-SA')
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'الآن'
  if (m < 60) return `منذ ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24) return `منذ ${h} ساعة`
  return `منذ ${Math.floor(h / 24)} يوم`
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminPanel({ merchant: adminMerchant }: { merchant: Merchant | null }) {
  const [view, setView] = useState<AdminView>(readAdminHash)

  function navTo(v: AdminView) { setView(v); window.location.hash = `admin-${v}` }

  useEffect(() => {
    const onPop = () => setView(readAdminHash())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [perfData, setPerfData] = useState<PerformanceData[]>([])
  const [credentials, setCredentials] = useState<PlatformCredential[]>([])
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    const [m, p, c, s] = await Promise.all([
      supabase.from('merchants').select('*').order('created_at', { ascending: false }),
      supabase.from('performance_data').select('*').order('created_at', { ascending: false }),
      supabase.from('platform_credentials').select('*').order('updated_at', { ascending: false }),
      supabase.from('sync_logs').select('*').order('started_at', { ascending: false }).limit(200),
    ])
    setMerchants(m.data || [])
    setPerfData(p.data || [])
    setCredentials(c.data || [])
    setSyncLogs(s.data || [])
    setLoading(false)
    setRefreshing(false)
  }

  const merchantOnly = useMemo(() => merchants.filter(m => m.role === 'merchant'), [merchants])

  // ── Derived stats ──
  const totalGMV = useMemo(() => perfData.reduce((s, r) => s + r.total_sales, 0), [perfData])
  const totalOrders = useMemo(() => perfData.reduce((s, r) => s + r.order_count, 0), [perfData])
  const activeIntegrations = useMemo(() => credentials.filter(c => c.is_active).length, [credentials])

  const gmvByMerchant = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of perfData) map[r.merchant_code] = (map[r.merchant_code] || 0) + r.total_sales
    return map
  }, [perfData])

  // ── GMV last 30 days (all merchants) ──
  const gmvTrend = useMemo(() => {
    const map: Record<string, number> = {}
    const cutoff = Date.now() - 30 * 86400000
    for (const r of perfData) {
      const d = r.data_date || r.created_at.split('T')[0]
      if (new Date(d).getTime() < cutoff) continue
      map[d] = (map[d] || 0) + r.total_sales
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, gmv]) => ({
        date: new Date(date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }),
        gmv: Math.round(gmv),
      }))
  }, [perfData])

  // ── GMV by platform ──
  const gmvByPlatform = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of perfData) map[r.platform] = (map[r.platform] || 0) + r.total_sales
    return Object.entries(map).map(([platform, gmv]) => ({ platform, name: PLATFORM_MAP[platform] || platform, gmv: Math.round(gmv) }))
  }, [perfData])

  // ── Top 5 merchants by GMV ──
  const topMerchants = useMemo(() =>
    merchantOnly
      .map(m => ({ ...m, gmv: gmvByMerchant[m.merchant_code] || 0 }))
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 5),
    [merchantOnly, gmvByMerchant]
  )

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <p style={{ color: 'var(--text2)', fontSize: 13 }}>جاري تحميل البيانات...</p>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── SIDEBAR ── */}
      <aside style={S.sidebar}>
        <div style={S.sidebarLogo}>
          <div style={S.logoIcon}>S</div>
          <div>
            <div style={S.logoText}>Sellpert</div>
            <div style={S.logoBadge}>لوحة الإدارة</div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '8px 0' }}>
          {NAV.map(item => (
            <div
              key={item.key}
              style={{ ...S.navItem, ...(view === item.key ? S.navActive : {}) }}
              onClick={() => navTo(item.key)}
            >
              <span style={S.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        <div style={S.sidebarBottom}>
          <div style={S.adminInfo}>
            <div style={S.adminAvatar}>{adminMerchant?.name?.[0] || 'A'}</div>
            <div>
              <div style={S.adminName}>{adminMerchant?.name || 'مدير النظام'}</div>
              <div style={S.adminRole}>{adminMerchant?.role === 'super_admin' ? 'Super Admin' : 'Admin'}</div>
            </div>
          </div>
          <button style={S.logoutBtn} onClick={() => supabase.auth.signOut()}>🚪 تسجيل الخروج</button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={S.main}>
        <div style={S.topbar}>
          <div>
            <h2 style={S.pageTitle}>{NAV.find(n => n.key === view)?.label}</h2>
            <p style={S.pageSub}>{new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <button style={S.refreshBtn} onClick={() => loadAll(true)} disabled={refreshing}>
            {refreshing ? '⟳ جاري...' : '⟳ تحديث'}
          </button>
        </div>

        {view === 'overview' && (
          <OverviewView
            merchantOnly={merchantOnly}
            totalGMV={totalGMV}
            totalOrders={totalOrders}
            activeIntegrations={activeIntegrations}
            gmvTrend={gmvTrend}
            gmvByPlatform={gmvByPlatform}
            topMerchants={topMerchants}
            syncLogs={syncLogs.slice(0, 8)}
          />
        )}
        {view === 'merchants' && (
          <MerchantsView
            merchants={merchants}
            gmvByMerchant={gmvByMerchant}
            credentials={credentials}
            onRefresh={() => loadAll(true)}
          />
        )}
        {view === 'performance' && (
          <PerformanceView
            merchants={merchantOnly}
            perfData={perfData}
          />
        )}
        {view === 'connections' && (
          <ConnectionsView merchants={merchantOnly} onRefresh={() => loadAll(true)} />
        )}
        {view === 'synclogs' && (
          <SyncLogsView
            merchants={merchantOnly}
            syncLogs={syncLogs}
          />
        )}
        {view === 'ai' && (
          <AiView merchants={merchantOnly} />
        )}
        {view === 'entry' && (
          <EntryView merchants={merchantOnly} />
        )}
      </main>
    </div>
  )
}

// ─── Overview View ────────────────────────────────────────────────────────────

function OverviewView({ merchantOnly, totalGMV, totalOrders, activeIntegrations, gmvTrend, gmvByPlatform, topMerchants, syncLogs }: any) {
  const kpis = [
    { label: 'التجار المسجلون', value: merchantOnly.length, icon: '👥', color: '#7c6bff', sub: 'تاجر نشط' },
    { label: 'إجمالي GMV', value: fmt(totalGMV), icon: '💰', color: '#00e5b0', sub: 'كل المنصات' },
    { label: 'إجمالي الطلبات', value: fmt(totalOrders, 'number'), icon: '📦', color: '#ff9900', sub: 'طلب محقق' },
    { label: 'تكاملات نشطة', value: activeIntegrations, icon: '🔗', color: '#ff6b6b', sub: 'منصة مربوطة' },
  ]

  return (
    <div>
      {/* KPIs */}
      <div style={S.cardsGrid}>
        {kpis.map((k, i) => (
          <div key={i} style={S.kpiCard} className="fade-in">
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={S.kpiTop}>
              <span style={S.kpiLabel}>{k.label}</span>
              <span style={{ ...S.kpiIcon, background: k.color + '22' }}>{k.icon}</span>
            </div>
            <div style={{ ...S.kpiValue, color: k.color }}>{k.value}</div>
            <div style={S.kpiSub}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={S.chartCard}>
          <div style={S.chartHeader}>
            <div style={S.chartTitle}>اتجاه GMV (آخر 30 يوم)</div>
            <div style={S.chartSub}>جميع التجار والمنصات</div>
          </div>
          {gmvTrend.length === 0 ? (
            <div style={S.emptyChart}>لا توجد بيانات بعد</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={gmvTrend}>
                <defs>
                  <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c6bff" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7c6bff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d2d4a" />
                <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} />
                <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
                <Tooltip contentStyle={{ background: '#12121f', border: '1px solid #2d2d4a', borderRadius: 10, color: '#eeeef5' }} formatter={(v: number) => [fmt(v), 'GMV']} />
                <Area type="monotone" dataKey="gmv" stroke="#7c6bff" strokeWidth={2.5} fill="url(#gmvGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={S.chartCard}>
          <div style={S.chartHeader}>
            <div style={S.chartTitle}>توزيع المنصات</div>
            <div style={S.chartSub}>حسب GMV</div>
          </div>
          {gmvByPlatform.length === 0 ? (
            <div style={S.emptyChart}>لا توجد بيانات</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={gmvByPlatform} dataKey="gmv" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={3}>
                    {gmvByPlatform.map((_: any, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#12121f', border: '1px solid #2d2d4a', borderRadius: 10, color: '#eeeef5' }} formatter={(v: number) => [fmt(v), '']} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 8px 8px' }}>
                {gmvByPlatform.map((p: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text2)' }}>{p.name}</span>
                    </div>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text)' }}>{fmt(p.gmv)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Top Merchants */}
        <div style={S.tableCard}>
          <div style={S.tableHeader}>
            <div style={S.chartTitle}>🏆 أفضل التجار (GMV)</div>
          </div>
          {topMerchants.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>لا يوجد تجار بعد</div>
          ) : (
            <table style={S.table}>
              <tbody>
                {topMerchants.map((m: any, i: number) => (
                  <tr key={m.id} style={S.tr}>
                    <td style={{ ...S.td, width: 32 }}>
                      <span style={{ fontSize: 16 }}>{['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]}</span>
                    </td>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>{m.merchant_code}</div>
                    </td>
                    <td style={{ ...S.td, textAlign: 'left', fontWeight: 700, color: 'var(--accent2)' }}>{fmt(m.gmv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Syncs */}
        <div style={S.tableCard}>
          <div style={S.tableHeader}>
            <div style={S.chartTitle}>🔄 آخر المزامنات</div>
          </div>
          {syncLogs.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>لا توجد مزامنات</div>
          ) : (
            <table style={S.table}>
              <tbody>
                {syncLogs.map((l: SyncLog) => (
                  <tr key={l.id} style={S.tr}>
                    <td style={S.td}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{l.merchant_code}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{PLATFORM_MAP[l.platform] || l.platform}</div>
                    </td>
                    <td style={S.td}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: l.status === 'success' ? 'rgba(0,229,176,0.15)' : l.status === 'error' ? 'rgba(255,77,109,0.15)' : 'rgba(255,209,102,0.15)',
                        color: l.status === 'success' ? 'var(--green)' : l.status === 'error' ? 'var(--red)' : '#ffd166',
                      }}>
                        {l.status === 'success' ? '✓ نجح' : l.status === 'error' ? '✕ خطأ' : '⟳ جاري'}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)', textAlign: 'left' }}>
                      {relativeTime(l.started_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Merchants View ───────────────────────────────────────────────────────────

function MerchantsView({ merchants, gmvByMerchant, credentials, onRefresh }: any) {
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', currency: 'SAR', role: 'merchant', whatsapp_phone: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<{ id: string; role: string } | null>(null)

  const filtered = merchants.filter((m: Merchant) =>
    m.name?.toLowerCase().includes(search.toLowerCase()) ||
    m.email?.toLowerCase().includes(search.toLowerCase()) ||
    m.merchant_code?.toLowerCase().includes(search.toLowerCase())
  )

  function credCount(code: string) {
    return credentials.filter((c: PlatformCredential) => c.merchant_code === code && c.is_active).length
  }

  async function addMerchant() {
    if (!addForm.name.trim() || !addForm.email.trim()) {
      setMsg({ type: 'err', text: 'الاسم والبريد الإلكتروني مطلوبان' }); return
    }
    if (!addForm.password.trim() || addForm.password.length < 8) {
      setMsg({ type: 'err', text: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }); return
    }
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-merchant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: addForm.name.trim(),
          email: addForm.email.trim().toLowerCase(),
          password: addForm.password,
          currency: addForm.currency,
          role: addForm.role,
          whatsapp_phone: addForm.whatsapp_phone.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setMsg({ type: 'err', text: data.error || 'خطأ في الإنشاء' })
      } else {
        setMsg({ type: 'ok', text: `✓ تمت إضافة ${addForm.name} — الكود: ${data.merchant_code}` })
        setAddForm({ name: '', email: '', password: '', currency: 'SAR', role: 'merchant', whatsapp_phone: '' })
        setShowAdd(false)
        onRefresh()
      }
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message })
    }
    setSaving(false)
  }

  async function deleteMerchant(id: string) {
    await supabase.from('merchants').delete().eq('id', id)
    setDeleteConfirm(null)
    onRefresh()
  }

  async function updateRole(id: string, role: string) {
    await supabase.from('merchants').update({ role }).eq('id', id)
    setEditRole(null)
    onRefresh()
  }

  return (
    <div>
      {msg && (
        <div style={{ ...S.msgBox, ...(msg.type === 'err' ? S.msgErr : S.msgOk), marginBottom: 16 }}>
          {msg.text}
          <button style={{ marginRight: 12, background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          style={{ ...S.searchInput, flex: 1 }}
          placeholder="ابحث بالاسم أو الإيميل أو الكود..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button style={S.addBtn} onClick={() => { setShowAdd(!showAdd); setMsg(null) }}>
          {showAdd ? '✕ إلغاء' : '+ إضافة تاجر'}
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div style={{ ...S.formCard, marginBottom: 16 }}>
          <div style={S.formTitle}>إضافة تاجر / مدير جديد</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            {[
              { key: 'name', label: 'الاسم الكامل', placeholder: 'متجر النور', type: 'text' },
              { key: 'email', label: 'البريد الإلكتروني', placeholder: 'merchant@example.com', type: 'email' },
              { key: 'password', label: 'كلمة المرور', placeholder: '8 أحرف على الأقل', type: 'password' },
              { key: 'whatsapp_phone', label: 'واتساب (اختياري)', placeholder: '+966501234567', type: 'text' },
            ].map(f => (
              <div key={f.key}>
                <label style={S.label}>{f.label}</label>
                <input
                  style={S.input}
                  type={f.type}
                  placeholder={f.placeholder}
                  value={(addForm as any)[f.key]}
                  onChange={e => setAddForm({ ...addForm, [f.key]: e.target.value })}
                />
              </div>
            ))}
            <div>
              <label style={S.label}>العملة</label>
              <select style={S.input} value={addForm.currency} onChange={e => setAddForm({ ...addForm, currency: e.target.value })}>
                <option value="SAR">ر.س — ريال سعودي</option>
                <option value="AED">د.إ — درهم إماراتي</option>
                <option value="USD">$ — دولار</option>
              </select>
            </div>
            <div>
              <label style={S.label}>الدور</label>
              <select style={S.input} value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value })}>
                <option value="merchant">تاجر</option>
                <option value="admin">مدير</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button style={S.saveBtn} onClick={addMerchant} disabled={saving}>
              {saving ? '⟳ جاري الإنشاء...' : '✓ إضافة وإنشاء حساب'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              سيتم إنشاء حساب دخول فوري للتاجر بالبريد وكلمة المرور المحددة
            </span>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'إجمالي', value: merchants.length, color: 'var(--text)' },
          { label: 'تجار', value: merchants.filter((m: Merchant) => m.role === 'merchant').length, color: 'var(--accent2)' },
          { label: 'مدراء', value: merchants.filter((m: Merchant) => m.role !== 'merchant').length, color: 'var(--accent)' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 18px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={S.tableCard}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['التاجر', 'البريد الإلكتروني', 'الكود', 'الدور', 'العملة', 'تكاملات نشطة', 'GMV الكلي', 'تاريخ الانضمام', 'إجراءات'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد نتائج</td></tr>
              ) : filtered.map((m: Merchant) => (
                <tr key={m.id} style={S.tr}>
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,var(--accent),var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {m.name?.[0] || '?'}
                      </div>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                    </div>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{m.email}</td>
                  <td style={S.td}><span style={S.codeTag}>{m.merchant_code}</span></td>
                  <td style={S.td}>
                    {editRole?.id === m.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select
                          style={{ ...S.input, padding: '4px 8px', fontSize: 11 }}
                          value={editRole.role}
                          onChange={e => setEditRole({ ...editRole, role: e.target.value })}
                        >
                          <option value="merchant">تاجر</option>
                          <option value="admin">مدير</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                        <button style={{ ...S.miniBtn, background: 'var(--accent)' }} onClick={() => updateRole(m.id, editRole.role)}>✓</button>
                        <button style={{ ...S.miniBtn }} onClick={() => setEditRole(null)}>✕</button>
                      </div>
                    ) : (
                      <span
                        style={{ ...S.roleBadge, background: m.role === 'merchant' ? 'rgba(0,229,176,0.1)' : 'rgba(124,107,255,0.15)', color: m.role === 'merchant' ? 'var(--accent2)' : 'var(--accent)', cursor: 'pointer' }}
                        onClick={() => setEditRole({ id: m.id, role: m.role })}
                        title="انقر للتعديل"
                      >
                        {m.role === 'merchant' ? 'تاجر' : m.role === 'admin' ? 'مدير' : 'Super Admin'}
                      </span>
                    )}
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>{m.currency}</td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: credCount(m.merchant_code) > 0 ? 'var(--accent2)' : 'var(--text3)' }}>
                      {credCount(m.merchant_code)} / 3
                    </span>
                  </td>
                  <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent2)' }}>
                    {fmt(gmvByMerchant[m.merchant_code] || 0)}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>
                    {new Date(m.created_at).toLocaleDateString('ar-SA')}
                  </td>
                  <td style={S.td}>
                    {deleteConfirm === m.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...S.miniBtn, background: 'var(--red)', color: '#fff' }} onClick={() => deleteMerchant(m.id)}>تأكيد الحذف</button>
                        <button style={S.miniBtn} onClick={() => setDeleteConfirm(null)}>إلغاء</button>
                      </div>
                    ) : (
                      <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => setDeleteConfirm(m.id)}>🗑 حذف</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Performance View ─────────────────────────────────────────────────────────

function PerformanceView({ merchants, perfData }: any) {
  const [filterMerchant, setFilterMerchant] = useState('all')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [filterPreset, setFilterPreset] = useState('last30')

  const filtered = useMemo(() => {
    let d = perfData as PerformanceData[]
    if (filterMerchant !== 'all') d = d.filter(r => r.merchant_code === filterMerchant)
    if (filterPlatform !== 'all') d = d.filter(r => r.platform === filterPlatform)
    const now = Date.now()
    if (filterPreset === 'today') d = d.filter(r => new Date(r.created_at).toDateString() === new Date().toDateString())
    else if (filterPreset === 'last7') d = d.filter(r => new Date(r.created_at).getTime() >= now - 7 * 86400000)
    else if (filterPreset === 'last30') d = d.filter(r => new Date(r.created_at).getTime() >= now - 30 * 86400000)
    else if (filterPreset === 'thisMonth') {
      const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0)
      d = d.filter(r => new Date(r.created_at) >= start)
    }
    return d
  }, [perfData, filterMerchant, filterPlatform, filterPreset])

  const totalSales = filtered.reduce((s, r) => s + r.total_sales, 0)
  const totalOrders = filtered.reduce((s, r) => s + r.order_count, 0)
  const totalFees = filtered.reduce((s, r) => s + (r.platform_fees || 0), 0)
  const aov = totalOrders > 0 ? totalSales / totalOrders : 0

  const trend = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of filtered) {
      const d = r.data_date || r.created_at.split('T')[0]
      map[d] = (map[d] || 0) + r.total_sales
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, sales]) => ({
      date: new Date(date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }),
      sales: Math.round(sales),
    }))
  }, [filtered])

  const platforms = [...new Set(perfData.map((r: PerformanceData) => r.platform))]

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={S.filterSelect} value={filterMerchant} onChange={e => setFilterMerchant(e.target.value)}>
          <option value="all">كل التجار</option>
          {merchants.map((m: Merchant) => <option key={m.id} value={m.merchant_code}>{m.name}</option>)}
        </select>
        <select style={S.filterSelect} value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
          <option value="all">كل المنصات</option>
          {platforms.map((p: any) => <option key={p} value={p}>{PLATFORM_MAP[p] || p}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { k: 'today', l: 'اليوم' },
            { k: 'last7', l: '7 أيام' },
            { k: 'last30', l: '30 يوم' },
            { k: 'thisMonth', l: 'هذا الشهر' },
            { k: 'all', l: 'الكل' },
          ].map(p => (
            <button key={p.k} style={{ ...S.presetBtn, ...(filterPreset === p.k ? S.presetActive : {}) }} onClick={() => setFilterPreset(p.k)}>{p.l}</button>
          ))}
        </div>
        <span style={S.badge}>{filtered.length} سجل</span>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'إجمالي المبيعات', value: fmt(totalSales), color: '#7c6bff' },
          { label: 'عدد الطلبات', value: fmt(totalOrders, 'number'), color: '#00e5b0' },
          { label: 'متوسط الطلب (AOV)', value: fmt(aov), color: '#ff9900' },
          { label: 'رسوم المنصات', value: fmt(totalFees), color: '#ff6b6b' },
        ].map((k, i) => (
          <div key={i} style={{ ...S.kpiCard }}>
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={S.kpiLabel}>{k.label}</div>
            <div style={{ ...S.kpiValue, color: k.color, marginTop: 8 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Trend Chart */}
      <div style={{ ...S.chartCard, marginBottom: 20 }}>
        <div style={S.chartHeader}>
          <div style={S.chartTitle}>اتجاه المبيعات</div>
          <div style={S.chartSub}>{filtered.length} سجل مرشح</div>
        </div>
        {trend.length === 0 ? (
          <div style={S.emptyChart}>لا توجد بيانات للفترة المحددة</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d2d4a" />
              <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} />
              <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
              <Tooltip contentStyle={{ background: '#12121f', border: '1px solid #2d2d4a', borderRadius: 10, color: '#eeeef5' }} formatter={(v: number) => [fmt(v), 'مبيعات']} />
              <Bar dataKey="sales" fill="#7c6bff" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Data Table */}
      <div style={S.tableCard}>
        <div style={S.tableHeader}>
          <div style={S.chartTitle}>سجل الأداء التفصيلي</div>
          <span style={S.badge}>{filtered.length} سجل</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['التاريخ', 'التاجر', 'المنصة', 'الطلبات', 'المبيعات', 'رسوم المنصة', 'الهامش', 'الإنفاق'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد بيانات</td></tr>
              ) : filtered.slice(0, 100).map(r => (
                <tr key={r.id} style={S.tr}>
                  <td style={{ ...S.td, fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString('ar-SA')}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.merchant_code}</td>
                  <td style={S.td}>
                    <span style={{ ...S.platformTag, background: (PLATFORM_COLORS[r.platform] || '#5a5a7a') + '22', color: PLATFORM_COLORS[r.platform] || '#5a5a7a' }}>
                      {PLATFORM_MAP[r.platform] || r.platform}
                    </span>
                  </td>
                  <td style={S.td}>{r.order_count.toLocaleString()}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{fmt(r.total_sales)}</td>
                  <td style={S.td}>{fmt(r.platform_fees || 0)}</td>
                  <td style={{ ...S.td, color: r.margin >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{r.margin.toFixed(1)}%</td>
                  <td style={S.td}>{fmt(r.ad_spend || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && (
          <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text3)', borderTop: '1px solid var(--border)' }}>
            يُعرض أول 100 سجل من {filtered.length}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Integrations View ────────────────────────────────────────────────────────

function IntegrationsView({ merchants, credentials, onRefresh }: any) {
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null)

  const PLATFORMS_LIST = ['trendyol', 'noon', 'amazon']

  async function triggerSync(credential: PlatformCredential) {
    const key = credential.id
    setSyncing(key)
    setSyncMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      const res = await fetch(`${supabaseUrl}/functions/v1/sync-${credential.platform}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_code: credential.merchant_code }),
      })
      const json = await res.json()
      if (!res.ok || json.error) setSyncMsg({ id: key, text: json.error || 'خطأ', ok: false })
      else setSyncMsg({ id: key, text: `✓ ${json.orders} طلب — ${json.days_synced} يوم`, ok: true })
      onRefresh()
    } catch (e: any) {
      setSyncMsg({ id: key, text: e.message, ok: false })
    }
    setSyncing(null)
  }

  // Build grid: one row per merchant × 3 platforms
  const rows = merchants.map((m: Merchant) => ({
    merchant: m,
    creds: PLATFORMS_LIST.map(p => credentials.find((c: PlatformCredential) => c.merchant_code === m.merchant_code && c.platform === p) || null),
  }))

  const stats = PLATFORMS_LIST.map(p => ({
    platform: p,
    total: credentials.filter((c: PlatformCredential) => c.platform === p).length,
    active: credentials.filter((c: PlatformCredential) => c.platform === p && c.is_active).length,
  }))

  return (
    <div>
      {/* Platform stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.platform} style={{ ...S.chartCard, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: (PLATFORM_COLORS[s.platform] || '#5a5a7a') + '22', border: `1px solid ${PLATFORM_COLORS[s.platform] || '#5a5a7a'}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
              {s.platform === 'trendyol' ? '🟠' : s.platform === 'noon' ? '🟡' : '📦'}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{PLATFORM_MAP[s.platform]}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
                <span style={{ color: 'var(--accent2)', fontWeight: 700 }}>{s.active}</span> نشط من {s.total} مربوط
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main table */}
      <div style={S.tableCard}>
        <div style={S.tableHeader}>
          <div style={S.chartTitle}>حالة ربط التجار</div>
          <span style={S.badge}>{credentials.filter((c: PlatformCredential) => c.is_active).length} نشط</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>التاجر</th>
                {PLATFORMS_LIST.map(p => <th key={p} style={S.th}>{PLATFORM_MAP[p]}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>لا يوجد تجار</td></tr>
              ) : rows.map(({ merchant, creds }: any) => (
                <tr key={merchant.id} style={S.tr}>
                  <td style={S.td}>
                    <div style={{ fontWeight: 600 }}>{merchant.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>{merchant.merchant_code}</div>
                  </td>
                  {creds.map((cred: PlatformCredential | null, i: number) => (
                    <td key={i} style={S.td}>
                      {!cred ? (
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>— غير مربوط</span>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                              background: cred.is_active ? 'rgba(0,229,176,0.15)' : 'rgba(90,90,122,0.2)',
                              color: cred.is_active ? 'var(--accent2)' : 'var(--text3)',
                            }}>
                              {cred.is_active ? '● متصل' : '○ غير نشط'}
                            </span>
                          </div>
                          {cred.last_sync_at && (
                            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>
                              آخر مزامنة: {relativeTime(cred.last_sync_at)}
                            </div>
                          )}
                          {syncMsg?.id === cred.id && (
                            <div style={{ fontSize: 11, color: syncMsg.ok ? 'var(--green)' : 'var(--red)', marginBottom: 6 }}>{syncMsg.text}</div>
                          )}
                          <button
                            style={{ ...S.miniBtn, background: 'var(--surface3)', fontSize: 11 }}
                            onClick={() => triggerSync(cred)}
                            disabled={syncing === cred.id}
                          >
                            {syncing === cred.id ? '⟳ جاري...' : '⟳ مزامنة'}
                          </button>
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Sync Logs View ───────────────────────────────────────────────────────────

function SyncLogsView({ merchants, syncLogs }: any) {
  const [filterMerchant, setFilterMerchant] = useState('all')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  const filtered = syncLogs.filter((l: SyncLog) => {
    if (filterMerchant !== 'all' && l.merchant_code !== filterMerchant) return false
    if (filterPlatform !== 'all' && l.platform !== filterPlatform) return false
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    return true
  })

  const platforms = [...new Set(syncLogs.map((l: SyncLog) => l.platform))]

  const stats = {
    total: syncLogs.length,
    success: syncLogs.filter((l: SyncLog) => l.status === 'success').length,
    error: syncLogs.filter((l: SyncLog) => l.status === 'error').length,
    running: syncLogs.filter((l: SyncLog) => l.status === 'running').length,
  }

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'إجمالي', value: stats.total, color: 'var(--text)' },
          { label: 'ناجح', value: stats.success, color: 'var(--green)' },
          { label: 'خطأ', value: stats.error, color: 'var(--red)' },
          { label: 'جاري', value: stats.running, color: '#ffd166' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 20px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select style={S.filterSelect} value={filterMerchant} onChange={e => setFilterMerchant(e.target.value)}>
          <option value="all">كل التجار</option>
          {merchants.map((m: Merchant) => <option key={m.id} value={m.merchant_code}>{m.name}</option>)}
        </select>
        <select style={S.filterSelect} value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
          <option value="all">كل المنصات</option>
          {platforms.map((p: any) => <option key={p} value={p}>{PLATFORM_MAP[p] || p}</option>)}
        </select>
        <select style={S.filterSelect} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">كل الحالات</option>
          <option value="success">ناجح</option>
          <option value="error">خطأ</option>
          <option value="running">جاري</option>
        </select>
        <span style={{ ...S.badge, alignSelf: 'center' }}>{filtered.length} سجل</span>
      </div>

      {/* Chart */}
      {syncLogs.length > 0 && (() => {
        const byDay: Record<string, { success: number; error: number }> = {}
        for (const l of syncLogs) {
          const d = l.started_at.split('T')[0]
          if (!byDay[d]) byDay[d] = { success: 0, error: 0 }
          if (l.status === 'success') byDay[d].success++
          if (l.status === 'error') byDay[d].error++
        }
        const chartData = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([date, v]) => ({
          date: new Date(date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }),
          ...v,
        }))
        return (
          <div style={{ ...S.chartCard, marginBottom: 20 }}>
            <div style={S.chartHeader}>
              <div style={S.chartTitle}>نشاط المزامنات (آخر 14 يوم)</div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d2d4a" />
                <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} />
                <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#12121f', border: '1px solid #2d2d4a', borderRadius: 10, color: '#eeeef5' }} />
                <Bar dataKey="success" fill="#00e5b0" radius={[3, 3, 0, 0]} name="ناجح" stackId="a" />
                <Bar dataKey="error" fill="#ff4d6d" radius={[3, 3, 0, 0]} name="خطأ" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      })()}

      {/* Table */}
      <div style={S.tableCard}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['التاجر', 'المنصة', 'الحالة', 'السجلات', 'وقت البداية', 'المدة', 'رسالة الخطأ'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد سجلات</td></tr>
              ) : filtered.map((l: SyncLog) => {
                const duration = l.finished_at
                  ? Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000)
                  : null
                return (
                  <tr key={l.id} style={S.tr}>
                    <td style={{ ...S.td, fontSize: 12 }}>{l.merchant_code}</td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: PLATFORM_COLORS[l.platform] || 'var(--text2)' }}>
                        {PLATFORM_MAP[l.platform] || l.platform}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                        background: l.status === 'success' ? 'rgba(0,229,176,0.15)' : l.status === 'error' ? 'rgba(255,77,109,0.15)' : 'rgba(255,209,102,0.15)',
                        color: l.status === 'success' ? 'var(--green)' : l.status === 'error' ? 'var(--red)' : '#ffd166',
                      }}>
                        {l.status === 'success' ? '✓ نجح' : l.status === 'error' ? '✕ خطأ' : '⟳ جاري'}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontFamily: 'monospace' }}>{l.records_synced?.toLocaleString() || 0}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>
                      {new Date(l.started_at).toLocaleString('ar-SA')}
                    </td>
                    <td style={{ ...S.td, fontSize: 12, fontFamily: 'monospace' }}>
                      {duration !== null ? `${duration}ث` : '—'}
                    </td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--red)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.error_message || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Connections View ─────────────────────────────────────────────────────────

const PLATFORM_FIELDS: Record<string, { label: string; fields: { key: string; label: string; placeholder: string; type?: string; hint?: string }[] }> = {
  trendyol: {
    label: 'تراندايول',
    fields: [
      { key: 'api_key',    label: 'API Key',    placeholder: 'xxxxxxxxxxxxxxxx' },
      { key: 'api_secret', label: 'API Secret', placeholder: 'xxxxxxxxxxxxxxxx', type: 'password' },
    ],
  },
  noon: {
    label: 'نون',
    fields: [
      { key: 'extra.service_account', label: 'Service Account JSON', placeholder: '{"type":"service_account","private_key":"..."}', hint: 'محتوى ملف JSON كامل من Noon Developer Portal' },
    ],
  },
  amazon: {
    label: 'أمازون SP-API',
    fields: [
      { key: 'api_key',    label: 'LWA Client ID',     placeholder: 'amzn1.application-...' },
      { key: 'api_secret', label: 'LWA Client Secret', placeholder: 'xxxxxxxx', type: 'password' },
      { key: 'extra.refresh_token', label: 'Refresh Token', placeholder: 'Atzr|...', hint: 'من صفحة Authorization في Seller Central' },
    ],
  },
  respondly: {
    label: 'Respondly واتساب',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'rsp_live_xxxxxxxxxxxx', type: 'password', hint: 'من Respondly → الإعدادات → API Keys → أنشئ مفتاح بصلاحيات messages + customers' },
      { key: 'extra.channel_id', label: 'Channel ID (اختياري)', placeholder: 'uuid الخاص بالقناة', hint: 'اتركه فارغاً لاستخدام القناة الافتراضية' },
      { key: 'extra.base_url', label: 'API Base URL (اختياري)', placeholder: 'https://ovbrrumnqfvtgmqsscat.supabase.co/functions/v1/public-api', hint: 'اتركه فارغاً للقيمة الافتراضية' },
    ],
  },
}

function ConnectionsView({ merchants, onRefresh }: { merchants: Merchant[]; onRefresh: () => void }) {
  const [connections, setConnections] = useState<PlatformConnection[]>([])
  const [mappings, setMappings] = useState<MerchantPlatformMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'connections' | 'mappings' | 'whatsapp'>('connections')

  // Connection form
  const [showConnForm, setShowConnForm] = useState(false)
  const [connForm, setConnForm] = useState<Record<string, string>>({ platform: 'trendyol', label: '' })
  const [savingConn, setSavingConn] = useState(false)

  // WhatsApp / Respondly state
  const [waConn, setWaConn]         = useState<PlatformConnection | null>(null)
  const [waChannels, setWaChannels] = useState<any[]>([])
  const [waTemplates, setWaTemplates] = useState<any[]>([])
  const [waLoading, setWaLoading]   = useState(false)
  const [waForm, setWaForm]         = useState({ label: 'Respondly', api_key: '', base_url: '' })
  const [waSaving, setWaSaving]     = useState(false)
  const [waEditKey, setWaEditKey]   = useState(false)
  const [waQr, setWaQr]             = useState<{ instance_name: string; qr_code: string | null; status: string; loading: boolean } | null>(null)
  const waQrPollRef                 = useRef<ReturnType<typeof setInterval> | null>(null)
  const [waEvents, setWaEvents]     = useState<Record<string, { enabled: boolean; template: string | null }>>({
    sync_complete: { enabled: true,  template: null },
    low_stock:     { enabled: false, template: null },
    new_order:     { enabled: true,  template: null },
    ai_ready:      { enabled: false, template: null },
    daily_report:  { enabled: false, template: null },
  })

  // Mapping form
  const [showMapForm, setShowMapForm] = useState(false)
  const [mapForm, setMapForm] = useState({ merchant_code: '', connection_id: '', seller_id: '' })
  const [savingMap, setSavingMap] = useState(false)

  // Sync state
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncResults, setSyncResults] = useState<Record<string, { ok: boolean; text: string }>>({})

  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [deleteConn, setDeleteConn] = useState<string | null>(null)
  const [deleteMap, setDeleteMap] = useState<string | null>(null)

  // Respondly test panel
  const [respondlyPanel, setRespondlyPanel] = useState<{ connId: string; channels: any[]; templates: any[]; loading: boolean } | null>(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [c, m] = await Promise.all([
      supabase.from('platform_connections').select('*').order('created_at', { ascending: false }),
      supabase.from('merchant_platform_mappings').select('*').order('created_at', { ascending: false }),
    ])
    const allConns = c.data || []
    setConnections(allConns)
    setMappings(m.data || [])
    setLoading(false)
    // Sync waConn
    const found = allConns.find((x: PlatformConnection) => x.platform === 'respondly') || null
    setWaConn(found)
    if (found) {
      const evts = found.extra?.events
      if (evts) setWaEvents(evts)
    }
  }

  // ── WhatsApp helpers ──
  async function saveWaConnection() {
    if (!waForm.api_key.trim()) { setMsg({ type: 'err', text: 'API Key مطلوب' }); return }
    setWaSaving(true)
    const extra: Record<string, any> = {}
    if (waForm.base_url.trim()) extra.base_url = waForm.base_url.trim()
    extra.events = waEvents

    if (waConn) {
      const { error } = await supabase.from('platform_connections').update({ api_key: waForm.api_key.trim(), label: waForm.label || 'Respondly', extra }).eq('id', waConn.id)
      setWaSaving(false)
      if (error) { setMsg({ type: 'err', text: error.message }); return }
    } else {
      const { data: inserted, error } = await supabase.from('platform_connections').insert({ platform: 'respondly', label: waForm.label || 'Respondly', api_key: waForm.api_key.trim(), is_active: true, extra }).select().single()
      setWaSaving(false)
      if (error) { setMsg({ type: 'err', text: error.message }); return }
      setWaConn(inserted)
    }
    setWaEditKey(false)
    setMsg({ type: 'ok', text: '✓ تم حفظ إعدادات Respondly' })
    await loadData()
    loadWaInfo()
  }

  async function loadWaInfo() {
    const conn = waConn || (await supabase.from('platform_connections').select('*').eq('platform', 'respondly').eq('is_active', true).limit(1).single()).data
    if (!conn) return
    setWaLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: conn.id }),
      })
      const data = await res.json()
      if (data.ok) { setWaChannels(data.channels || []); setWaTemplates(data.templates || []) }
      else setMsg({ type: 'err', text: data.error || 'فشل الاتصال بـ Respondly' })
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    setWaLoading(false)
  }

  async function saveWaDefaultChannel(channelId: string) {
    if (!waConn) return
    const extra = { ...(waConn.extra || {}), channel_id: channelId }
    const { error } = await supabase.from('platform_connections').update({ extra }).eq('id', waConn.id)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setMsg({ type: 'ok', text: '✓ تم تحديد القناة الافتراضية' })
    loadData()
  }

  async function saveWaEvents() {
    if (!waConn) return
    const extra = { ...(waConn.extra || {}), events: waEvents }
    const { error } = await supabase.from('platform_connections').update({ extra }).eq('id', waConn.id)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setMsg({ type: 'ok', text: '✓ تم حفظ إعدادات الأحداث' })
    loadData()
  }

  // ── QR helpers ──
  async function waCall(action: string, extra: Record<string, any> = {}) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: waConn?.id, action, ...extra }),
    })
    return res.json()
  }

  async function startQrConnect() {
    if (!waConn) return
    setWaQr({ instance_name: '', qr_code: null, status: 'creating', loading: true })
    const data = await waCall('create_instance')
    if (data.error) {
      setWaQr(null)
      const isPermission = data.error.includes('صلاحية') || data.error.includes('403')
      setMsg({
        type: 'err',
        text: isPermission
          ? '⛔ الـ API Token لا يملك صلاحية whatsapp — تأكد من تفعيل صلاحية "whatsapp" في لوحة Respondly'
          : `خطأ: ${data.error}`,
      })
      return
    }
    const instName = data.instance_name
    let qrCode = data.qr_code || null
    if (!qrCode && instName) {
      const qrData = await waCall('get_qr', { instance_name: instName })
      qrCode = qrData.qr_code || null
    }
    setWaQr({ instance_name: instName, qr_code: qrCode, status: 'waiting', loading: false })
    startQrPolling(instName)
  }

  function startQrPolling(instName: string) {
    if (waQrPollRef.current) clearInterval(waQrPollRef.current)
    waQrPollRef.current = setInterval(async () => {
      const statusData = await waCall('status')
      const ch = (statusData.channels || []).find((c: any) => c.evolution_instance_name === instName)
      if (ch?.live_status === 'open' || ch?.is_connected) {
        clearInterval(waQrPollRef.current!)
        waQrPollRef.current = null
        setWaQr(null)
        setMsg({ type: 'ok', text: '✅ تم ربط الرقم بنجاح!' })
        loadWaInfo()
        return
      }
      // Always refresh QR (channel may not appear immediately)
      const qrData = await waCall('get_qr', { instance_name: instName })
      if (qrData.qr_code) setWaQr(prev => prev ? { ...prev, qr_code: qrData.qr_code, status: 'waiting' } : null)
    }, 4000)
  }

  async function disconnectChannel(instName: string) {
    const data = await waCall('logout', { instance_name: instName })
    if (data.error) { setMsg({ type: 'err', text: data.error }); return }
    setMsg({ type: 'ok', text: '✓ تم قطع الاتصال' })
    loadWaInfo()
  }

  async function deleteChannel(instName: string) {
    const data = await waCall('delete_instance', { instance_name: instName })
    if (data.error) { setMsg({ type: 'err', text: data.error }); return }
    setMsg({ type: 'ok', text: '✓ تم حذف الرقم' })
    loadWaInfo()
  }

  useEffect(() => () => { if (waQrPollRef.current) clearInterval(waQrPollRef.current) }, [])

  // ── Respondly Info ──
  async function loadRespondlyInfo(connId: string) {
    setRespondlyPanel({ connId, channels: [], templates: [], loading: true })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/respondly-info`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connId }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setMsg({ type: 'err', text: data.error || 'فشل جلب بيانات Respondly' })
        setRespondlyPanel(null)
      } else {
        setRespondlyPanel({ connId, channels: data.channels || [], templates: data.templates || [], loading: false })
      }
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message })
      setRespondlyPanel(null)
    }
  }

  async function saveChannelId(connId: string, channelId: string) {
    const conn = connections.find(c => c.id === connId)
    const extra = { ...(conn?.extra || {}), channel_id: channelId }
    const { error } = await supabase.from('platform_connections').update({ extra }).eq('id', connId)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setMsg({ type: 'ok', text: '✓ تم حفظ القناة الافتراضية' })
    loadData()
  }

  // ── Add Connection ──
  async function addConnection() {
    if (!connForm.label?.trim()) { setMsg({ type: 'err', text: 'أدخل اسماً مرجعياً للاتصال' }); return }
    setSavingConn(true)
    const platform = connForm.platform
    const fields = PLATFORM_FIELDS[platform]?.fields || []
    const payload: Record<string, any> = {
      platform, label: connForm.label.trim(), is_active: true, extra: {},
    }
    for (const f of fields) {
      if (f.key.startsWith('extra.')) {
        const k = f.key.replace('extra.', '')
        if (connForm[f.key]) {
          try { payload.extra[k] = JSON.parse(connForm[f.key]) }
          catch { payload.extra[k] = connForm[f.key] }
        }
      } else {
        if (connForm[f.key]) payload[f.key] = connForm[f.key]
      }
    }
    const { data: inserted, error } = await supabase.from('platform_connections').insert(payload).select().single()
    setSavingConn(false)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setMsg({ type: 'ok', text: `✓ تم حفظ اتصال ${PLATFORM_MAP[platform]} — ${connForm.label}` })
    setConnForm({ platform: 'trendyol', label: '' })
    setShowConnForm(false)
    await loadData()
    if (platform === 'respondly' && inserted?.id) loadRespondlyInfo(inserted.id)
  }

  // ── Add Mapping ──
  async function addMapping() {
    if (!mapForm.merchant_code || !mapForm.connection_id || !mapForm.seller_id.trim()) {
      setMsg({ type: 'err', text: 'اختر التاجر والاتصال وأدخل Seller ID' }); return
    }
    const conn = connections.find(c => c.id === mapForm.connection_id)
    setSavingMap(true)
    const { error } = await supabase.from('merchant_platform_mappings').insert({
      merchant_code: mapForm.merchant_code,
      connection_id: mapForm.connection_id,
      platform:      conn?.platform,
      seller_id:     mapForm.seller_id.trim(),
    })
    setSavingMap(false)
    if (error) {
      setMsg({ type: 'err', text: error.message.includes('unique') ? 'هذا التاجر مرتبط بهذه المنصة مسبقاً' : error.message })
      return
    }
    setMsg({ type: 'ok', text: '✓ تم ربط التاجر بالمنصة' })
    setMapForm({ merchant_code: '', connection_id: '', seller_id: '' })
    setShowMapForm(false)
    loadData(); onRefresh()
  }

  // ── Trigger Sync ──
  async function triggerSync(mapping: MerchantPlatformMapping) {
    setSyncing(mapping.id)
    setSyncResults(prev => ({ ...prev, [mapping.id]: { ok: false, text: '⟳ جاري...' } }))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-${mapping.platform}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ merchant_code: mapping.merchant_code, mapping_id: mapping.id }),
        }
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        setSyncResults(prev => ({ ...prev, [mapping.id]: { ok: false, text: '✕ ' + (json.error || 'خطأ') } }))
      } else {
        setSyncResults(prev => ({ ...prev, [mapping.id]: { ok: true, text: `✓ ${json.records_synced || 0} سجل` } }))
        loadData()
      }
    } catch (e: any) {
      setSyncResults(prev => ({ ...prev, [mapping.id]: { ok: false, text: '✕ ' + e.message } }))
    }
    setSyncing(null)
  }

  async function syncAll() {
    const active = mappings.filter(m => m.is_active)
    for (const m of active) await triggerSync(m)
  }

  const getMerchantName = (code: string) => merchants.find(m => m.merchant_code === code)?.name || code
  const getConnLabel   = (id: string)   => connections.find(c => c.id === id)?.label || id

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>⟳ جاري التحميل...</div>

  return (
    <div>
      {msg && (
        <div style={{ ...S.msgBox, ...(msg.type === 'err' ? S.msgErr : S.msgOk), marginBottom: 16 }}>
          {msg.text}
          <button style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginRight: 10 }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'اتصالات المنصات', value: connections.filter(c => c.is_active).length, icon: '🔌', color: '#7c6bff', sub: 'مفعّل' },
          { label: 'تجار مربوطون',    value: mappings.filter(m => m.is_active).length,     icon: '👥', color: '#00e5b0', sub: 'ربط نشط' },
          { label: 'آخر مزامنة ناجحة', value: mappings.filter(m => m.last_sync_status === 'success').length, icon: '✅', color: '#ff9900', sub: 'تاجر' },
        ].map((k, i) => (
          <div key={i} style={S.kpiCard}>
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={S.kpiTop}>
              <span style={S.kpiLabel}>{k.label}</span>
              <span style={{ ...S.kpiIcon, background: k.color + '22' }}>{k.icon}</span>
            </div>
            <div style={{ ...S.kpiValue, color: k.color }}>{k.value}</div>
            <div style={S.kpiSub}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {([['connections', '🔌 مفاتيح API'], ['mappings', '🗂️ ربط التجار'], ['whatsapp', '📱 واتساب']] as const).map(([k, l]) => (
          <button key={k} style={{ ...S.tabBtn, ...(tab === k ? S.tabActive : {}) }} onClick={() => { setTab(k); if (k === 'whatsapp' && waConn && waChannels.length === 0) loadWaInfo() }}>{l}{k === 'whatsapp' && waConn ? ' ●' : ''}</button>
        ))}
        {tab === 'mappings' && mappings.filter(m => m.is_active).length > 0 && (
          <button
            style={{ marginRight: 'auto', background: 'linear-gradient(135deg,var(--accent),#a594ff)', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', alignSelf: 'center', marginBottom: 1 }}
            onClick={syncAll}
            disabled={syncing !== null}
          >
            {syncing ? '⟳ جاري المزامنة...' : '⟳ مزامنة الكل'}
          </button>
        )}
      </div>

      {/* ── TAB: CONNECTIONS ── */}
      {tab === 'connections' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button style={S.addBtn} onClick={() => setShowConnForm(!showConnForm)}>
              {showConnForm ? '✕ إلغاء' : '+ إضافة اتصال'}
            </button>
          </div>

          {showConnForm && (
            <div style={{ ...S.formCard, marginBottom: 20 }}>
              <div style={S.formTitle}>🔌 إضافة اتصال منصة جديد</div>

              {/* Platform selector */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                {(['trendyol', 'noon', 'amazon'] as const).map(p => (
                  <div
                    key={p}
                    style={{ border: `2px solid ${connForm.platform === p ? PLATFORM_COLORS[p] : 'var(--border)'}`, borderRadius: 12, padding: '12px 16px', cursor: 'pointer', background: connForm.platform === p ? PLATFORM_COLORS[p] + '11' : 'var(--bg)', transition: 'all 0.15s' }}
                    onClick={() => setConnForm({ platform: p, label: '' })}
                  >
                    <div style={{ fontSize: 14, fontWeight: 800, color: PLATFORM_COLORS[p] }}>{PLATFORM_MAP[p]}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                      {p === 'trendyol' ? 'Basic Auth (API Key + Secret)' : p === 'noon' ? 'Service Account JSON' : 'LWA OAuth2'}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, maxWidth: 500 }}>
                <div>
                  <label style={S.label}>اسم مرجعي (لأغراض الإدارة فقط)</label>
                  <input style={S.input} placeholder='مثال: "تراندايول - حساب رئيسي"' value={connForm.label || ''} onChange={e => setConnForm({ ...connForm, label: e.target.value })} />
                </div>
                {(PLATFORM_FIELDS[connForm.platform]?.fields || []).map(f => (
                  <div key={f.key}>
                    <label style={S.label}>{f.label}</label>
                    {f.hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 5 }}>{f.hint}</div>}
                    {f.key.startsWith('extra.') && connForm.platform === 'noon' ? (
                      <textarea
                        style={{ ...S.input, height: 100, resize: 'vertical' as const, fontFamily: 'monospace', fontSize: 11 }}
                        placeholder={f.placeholder}
                        value={connForm[f.key] || ''}
                        onChange={e => setConnForm({ ...connForm, [f.key]: e.target.value })}
                      />
                    ) : (
                      <input
                        style={{ ...S.input, fontFamily: f.type === 'password' ? 'inherit' : 'monospace', fontSize: 12 }}
                        type={f.type || 'text'}
                        placeholder={f.placeholder}
                        value={connForm[f.key] || ''}
                        onChange={e => setConnForm({ ...connForm, [f.key]: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                <button style={S.saveBtn} onClick={addConnection} disabled={savingConn}>
                  {savingConn ? '⟳ جاري الحفظ...' : '✓ حفظ الاتصال'}
                </button>
              </div>
            </div>
          )}

          {connections.length === 0 ? (
            <div style={{ ...S.tableCard, padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔌</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>لا توجد اتصالات بعد</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>أضف مفاتيح API للمنصات من الزر أعلاه</div>
            </div>
          ) : (
            <div style={S.tableCard}>
              <table style={S.table}>
                <thead>
                  <tr>{['المنصة', 'الاسم المرجعي', 'الحالة', 'API Key', 'تاريخ الإضافة', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {connections.map(c => (
                    <tr key={c.id} style={S.tr}>
                      <td style={S.td}>
                        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: (PLATFORM_COLORS[c.platform] || '#5a5a7a') + '22', color: PLATFORM_COLORS[c.platform] || '#5a5a7a' }}>
                          {PLATFORM_MAP[c.platform] || c.platform}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{c.label}</td>
                      <td style={S.td}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.is_active ? 'rgba(0,229,176,0.15)' : 'rgba(90,90,122,0.2)', color: c.is_active ? 'var(--accent2)' : 'var(--text3)' }}>
                          {c.is_active ? '● نشط' : '○ معطّل'}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>
                        {c.api_key ? c.api_key.slice(0, 8) + '••••••••' : c.extra && Object.keys(c.extra).length > 0 ? '✓ JSON محفوظ' : '—'}
                      </td>
                      <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{new Date(c.created_at).toLocaleDateString('ar-SA')}</td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {c.platform === 'respondly' && (
                            <button
                              style={{ ...S.miniBtn, color: '#25D366', borderColor: '#25D366' }}
                              onClick={() => respondlyPanel?.connId === c.id ? setRespondlyPanel(null) : loadRespondlyInfo(c.id)}
                            >
                              {respondlyPanel?.connId === c.id ? '✕ إغلاق' : '🔍 اختبار'}
                            </button>
                          )}
                          {deleteConn === c.id ? (
                            <>
                              <button style={{ ...S.miniBtn, background: 'var(--red)', color: '#fff' }} onClick={async () => { await supabase.from('platform_connections').delete().eq('id', c.id); setDeleteConn(null); loadData() }}>تأكيد</button>
                              <button style={S.miniBtn} onClick={() => setDeleteConn(null)}>إلغاء</button>
                            </>
                          ) : (
                            <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => setDeleteConn(c.id)}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Respondly Test Panel ── */}
          {respondlyPanel && (
            <div style={{ ...S.formCard, marginTop: 16, borderColor: '#25D366' }}>
              <div style={{ ...S.formTitle, color: '#25D366' }}>🟢 Respondly — قنوات وقوالب</div>
              {respondlyPanel.loading ? (
                <div style={{ color: 'var(--text3)', fontSize: 13 }}>⟳ جاري الجلب...</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* Channels */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📱 القنوات (أرقام الواتساب)</div>
                    {respondlyPanel.channels.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>لا توجد قنوات — تحقق من صلاحيات API Key</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                        {respondlyPanel.channels.map((ch: any) => {
                          const conn = connections.find(c => c.id === respondlyPanel.connId)
                          const isSelected = conn?.extra?.channel_id === (ch.id || ch.channel_id)
                          return (
                            <div key={ch.id || ch.channel_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, border: `1.5px solid ${isSelected ? '#25D366' : 'var(--border)'}`, background: isSelected ? '#25D36611' : 'var(--bg2)' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{ch.name || ch.phone_number || ch.number || ch.id}</div>
                                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{ch.status || ch.phone_number || ''}</div>
                              </div>
                              <button
                                style={{ ...S.miniBtn, ...(isSelected ? { background: '#25D366', color: '#fff', borderColor: '#25D366' } : {}) }}
                                onClick={() => saveChannelId(respondlyPanel.connId, ch.id || ch.channel_id)}
                              >
                                {isSelected ? '✓ محدد' : 'اختر'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  {/* Templates */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📋 القوالب المعتمدة</div>
                    {respondlyPanel.templates.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>لا توجد قوالب — يتم الإرسال كرسائل نصية</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6, maxHeight: 260, overflowY: 'auto' as const }}>
                        {respondlyPanel.templates.map((t: any, i: number) => (
                          <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{t.name || t.template_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{t.status || t.language || ''}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: MAPPINGS ── */}
      {tab === 'mappings' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button style={S.addBtn} onClick={() => setShowMapForm(!showMapForm)} disabled={connections.length === 0}>
              {showMapForm ? '✕ إلغاء' : '+ ربط تاجر بمنصة'}
            </button>
          </div>

          {connections.length === 0 && (
            <div style={{ ...S.msgBox, ...S.msgErr, marginBottom: 14 }}>أضف اتصال منصة أولاً من تبويب "مفاتيح API"</div>
          )}

          {showMapForm && connections.length > 0 && (
            <div style={{ ...S.formCard, marginBottom: 20 }}>
              <div style={S.formTitle}>🗂️ ربط تاجر بمنصة</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={S.label}>التاجر</label>
                  <select style={S.input} value={mapForm.merchant_code} onChange={e => setMapForm({ ...mapForm, merchant_code: e.target.value })}>
                    <option value="">-- اختر تاجر --</option>
                    {merchants.map(m => <option key={m.id} value={m.merchant_code}>{m.name} ({m.merchant_code})</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>الاتصال (المنصة)</label>
                  <select style={S.input} value={mapForm.connection_id} onChange={e => setMapForm({ ...mapForm, connection_id: e.target.value })}>
                    <option value="">-- اختر اتصال --</option>
                    {connections.filter(c => c.is_active).map(c => (
                      <option key={c.id} value={c.id}>{PLATFORM_MAP[c.platform]} — {c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Seller ID (خاص بالتاجر)</label>
                  <input style={S.input} placeholder='مثال: 12345678' value={mapForm.seller_id} onChange={e => setMapForm({ ...mapForm, seller_id: e.target.value })} />
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>رقم البائع الخاص بهذا التاجر على المنصة</div>
                </div>
              </div>
              <button style={S.saveBtn} onClick={addMapping} disabled={savingMap}>
                {savingMap ? '⟳ جاري الربط...' : '✓ ربط التاجر'}
              </button>
            </div>
          )}

          {mappings.length === 0 ? (
            <div style={{ ...S.tableCard, padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗂️</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>لا يوجد تجار مربوطون بعد</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>اربط تجارك بالمنصات من الزر أعلاه</div>
            </div>
          ) : (
            <div style={S.tableCard}>
              <table style={S.table}>
                <thead>
                  <tr>{['التاجر', 'المنصة', 'Seller ID', 'الاتصال', 'آخر مزامنة', 'السجلات', 'الحالة', 'إجراء'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {mappings.map(m => {
                    const result = syncResults[m.id]
                    const status = result ? result : m.last_sync_status ? { ok: m.last_sync_status === 'success', text: m.last_sync_status === 'success' ? `✓ ${m.records_synced || 0} سجل` : `✕ ${m.last_sync_error?.slice(0, 40) || 'خطأ'}` } : null
                    return (
                      <tr key={m.id} style={S.tr}>
                        <td style={{ ...S.td, fontWeight: 600 }}>{getMerchantName(m.merchant_code)}</td>
                        <td style={S.td}>
                          <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: (PLATFORM_COLORS[m.platform] || '#5a5a7a') + '22', color: PLATFORM_COLORS[m.platform] || '#5a5a7a' }}>
                            {PLATFORM_MAP[m.platform] || m.platform}
                          </span>
                        </td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{m.seller_id}</td>
                        <td style={{ ...S.td, fontSize: 12, color: 'var(--text3)' }}>{getConnLabel(m.connection_id)}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{m.last_sync_at ? relativeTime(m.last_sync_at) : '—'}</td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{m.records_synced?.toLocaleString() || 0}</td>
                        <td style={S.td}>
                          {status && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: status.ok ? 'var(--accent2)' : 'var(--red)' }}>{status.text}</span>
                          )}
                        </td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              style={{ ...S.miniBtn, background: syncing === m.id ? 'var(--surface3)' : 'var(--accent)', color: '#fff', border: 'none' }}
                              onClick={() => triggerSync(m)}
                              disabled={syncing !== null}
                            >
                              {syncing === m.id ? '⟳' : '⟳ مزامنة'}
                            </button>
                            {deleteMap === m.id ? (
                              <>
                                <button style={{ ...S.miniBtn, background: 'var(--red)', color: '#fff' }} onClick={async () => { await supabase.from('merchant_platform_mappings').delete().eq('id', m.id); setDeleteMap(null); loadData() }}>حذف</button>
                                <button style={S.miniBtn} onClick={() => setDeleteMap(null)}>لا</button>
                              </>
                            ) : (
                              <button style={{ ...S.miniBtn, color: 'var(--red)' }} onClick={() => setDeleteMap(m.id)}>🗑</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: WHATSAPP ── */}
      {tab === 'whatsapp' && (
        <div>
          {/* Setup / Edit Key */}
          {(!waConn || waEditKey) ? (
            <div style={{ ...S.formCard, borderColor: '#25D366' }}>
              <div style={{ ...S.formTitle, color: '#25D366' }}>📱 ربط Respondly واتساب</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={S.label}>اسم مرجعي</label>
                  <input style={S.input} value={waForm.label} onChange={e => setWaForm({ ...waForm, label: e.target.value })} placeholder="Respondly" />
                </div>
                <div>
                  <label style={S.label}>API Key <span style={{ color: 'var(--red)' }}>*</span></label>
                  <input style={{ ...S.input, fontFamily: 'monospace', fontSize: 12 }} type="password" value={waForm.api_key} onChange={e => setWaForm({ ...waForm, api_key: e.target.value })} placeholder="rsp_live_xxxxxxxxxxxx" />
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>من Respondly ← الإعدادات ← API Keys — أنشئ مفتاح بصلاحية messages</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={S.saveBtn} onClick={saveWaConnection} disabled={waSaving}>{waSaving ? '⟳ جاري الحفظ...' : '✓ حفظ وربط'}</button>
                {waEditKey && <button style={S.miniBtn} onClick={() => setWaEditKey(false)}>إلغاء</button>}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'var(--surface2)', border: '1.5px solid #25D36633', marginBottom: 20 }}>
              <span style={{ fontSize: 20 }}>🟢</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Respondly مربوط</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'monospace' }}>{waConn.api_key?.slice(0, 12)}••••••••</div>
              </div>
              <button style={{ ...S.miniBtn }} onClick={() => { setWaForm({ label: waConn.label, api_key: '', base_url: waConn.extra?.base_url || '' }); setWaEditKey(true) }}>✏️ تعديل</button>
              <button style={{ ...S.miniBtn, color: '#25D366', borderColor: '#25D366' }} onClick={loadWaInfo} disabled={waLoading}>{waLoading ? '⟳' : '🔄 تحديث'}</button>
            </div>
          )}

          {waConn && !waEditKey && (
            <>
              {waLoading && <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 32 }}>⟳ جاري جلب البيانات من Respondly...</div>}

              {!waLoading && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                  {/* Channels */}
                  <div style={S.tableCard}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>📱 القنوات (أرقام الواتساب)</span>
                      <button
                        style={{ ...S.miniBtn, background: '#25D366', color: '#fff', borderColor: '#25D366', fontSize: 12 }}
                        onClick={startQrConnect}
                        disabled={!!waQr}
                      >
                        {waQr ? '⟳ جاري الربط...' : '➕ ربط رقم جديد'}
                      </button>
                    </div>

                    {/* QR Panel */}
                    {waQr && (
                      <div style={{ padding: 20, borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                        {waQr.loading || waQr.status === 'creating' ? (
                          <div style={{ color: 'var(--text3)', fontSize: 13 }}>⟳ جاري إنشاء الجلسة...</div>
                        ) : waQr.qr_code ? (
                          <>
                            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>امسح QR بتطبيق واتساب</div>
                            <img
                              src={waQr.qr_code.startsWith('data:') ? waQr.qr_code : `data:image/png;base64,${waQr.qr_code}`}
                              alt="WhatsApp QR"
                              style={{ width: 200, height: 200, borderRadius: 12, border: '2px solid #25D366' }}
                            />
                            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
                              واتساب ← النقاط الثلاث ← الأجهزة المرتبطة ← ربط جهاز
                            </div>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#25D366', animation: 'pulse 1.5s infinite' }} />
                              <span style={{ fontSize: 12, color: 'var(--text3)' }}>في انتظار المسح...</span>
                            </div>
                          </>
                        ) : (
                          <div style={{ color: 'var(--text3)', fontSize: 13 }}>⟳ جاري تحديث QR...</div>
                        )}
                        <button style={{ ...S.miniBtn, marginTop: 12, color: 'var(--red)' }} onClick={() => { if (waQrPollRef.current) clearInterval(waQrPollRef.current); setWaQr(null) }}>إلغاء</button>
                      </div>
                    )}

                    {waChannels.length === 0 && !waQr ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                        لا توجد قنوات بعد — اضغط "ربط رقم جديد" أعلاه
                      </div>
                    ) : waChannels.map((ch: any) => {
                      const isDefault = waConn.extra?.channel_id === ch.id
                      const isConnected = ch.is_connected || ch.live_status === 'open'
                      return (
                        <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: isDefault ? '#25D36608' : 'transparent' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: isConnected ? '#25D366' : 'var(--text3)', flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{ch.display_phone || ch.business_name || ch.evolution_instance_name || ch.id}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{ch.channel_label || ''} {isConnected ? 'متصل' : 'غير متصل'}</div>
                          </div>
                          <button style={{ ...S.miniBtn, ...(isDefault ? { background: '#25D366', color: '#fff', borderColor: '#25D366' } : {}), fontSize: 11 }} onClick={() => saveWaDefaultChannel(ch.id)}>
                            {isDefault ? '✓ افتراضي' : 'اختر'}
                          </button>
                          {ch.evolution_instance_name && (
                            <button style={{ ...S.miniBtn, color: 'var(--red)', fontSize: 11 }} onClick={() => deleteChannel(ch.evolution_instance_name)}>🗑</button>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Templates */}
                  <div style={S.tableCard}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>📋 القوالب المعتمدة</div>
                    {waTemplates.length === 0 ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
                        لا توجد قوالب<br />
                        <span style={{ fontSize: 11 }}>الإرسال سيكون كرسائل نصية مباشرة</span>
                      </div>
                    ) : (
                      <div style={{ maxHeight: 280, overflowY: 'auto' as const }}>
                        {waTemplates.map((t: any, i: number) => (
                          <div key={i} style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>{t.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.language} — {t.category} — {t.status}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Events Config */}
              <div style={S.tableCard}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>⚡ الأحداث والإشعارات</div>
                <table style={S.table}>
                  <thead>
                    <tr>{['الحدث', 'التوضيح', 'مفعّل', 'القالب (اختياري)'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {([
                      ['sync_complete', 'مزامنة ناجحة',       'بعد كل مزامنة للطلبات'],
                      ['low_stock',    'مخزون منخفض',        'عند انخفاض المخزون'],
                      ['new_order',    'طلب جديد',            'عند وصول طلب جديد'],
                      ['ai_ready',     'تحليل ذكي جاهز',      'بعد اكتمال التحليل'],
                      ['daily_report', 'تقرير يومي',          'تقرير يومي تلقائي'],
                    ] as const).map(([key, label, desc]) => (
                      <tr key={key} style={S.tr}>
                        <td style={{ ...S.td, fontWeight: 700 }}>{label}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{desc}</td>
                        <td style={S.td}>
                          <div
                            style={{ width: 40, height: 22, borderRadius: 11, background: waEvents[key]?.enabled ? '#25D366' : 'var(--surface3)', cursor: 'pointer', position: 'relative' as const, transition: 'background 0.2s' }}
                            onClick={() => setWaEvents(prev => ({ ...prev, [key]: { ...prev[key], enabled: !prev[key]?.enabled } }))}
                          >
                            <div style={{ position: 'absolute' as const, top: 3, left: waEvents[key]?.enabled ? 20 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                          </div>
                        </td>
                        <td style={S.td}>
                          <select
                            style={{ ...S.input, fontSize: 11, padding: '4px 8px', width: 180 }}
                            value={waEvents[key]?.template || ''}
                            onChange={e => setWaEvents(prev => ({ ...prev, [key]: { ...prev[key], template: e.target.value || null } }))}
                          >
                            <option value="">رسالة نصية (بدون قالب)</option>
                            {waTemplates.map((t: any) => <option key={t.name} value={t.name}>{t.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '12px 16px' }}>
                  <button style={S.saveBtn} onClick={saveWaEvents}>✓ حفظ إعدادات الأحداث</button>
                </div>
              </div>

              <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 8, background: 'var(--surface2)', fontSize: 12, color: 'var(--text3)' }}>
                💡 رقم واتساب كل تاجر يُحدد في ملفه عند الإنشاء — اذهب لـ التجار ← تعديل التاجر لتغيير الرقم
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── AI View ─────────────────────────────────────────────────────────────────

function AiView({ merchants }: { merchants: Merchant[] }) {
  const [selectedMerchant, setSelectedMerchant] = useState<string>('')
  const [mode, setMode] = useState<'quick' | 'deep'>('quick')
  const [insight, setInsight] = useState<AiInsight | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<AiInsight[]>([])
  const [showSetup, setShowSetup] = useState(false)

  useEffect(() => {
    if (merchants.length > 0 && !selectedMerchant) {
      setSelectedMerchant(merchants[0].merchant_code)
    }
  }, [merchants])

  useEffect(() => {
    if (!selectedMerchant) return
    loadHistory()
  }, [selectedMerchant])

  async function loadHistory() {
    const { data } = await supabase
      .from('ai_insights')
      .select('*')
      .eq('merchant_code', selectedMerchant)
      .order('created_at', { ascending: false })
      .limit(8)
    setHistory(data || [])
    if (data && data.length > 0) setInsight(data[0])
    else setInsight(null)
  }

  async function runAnalysis() {
    if (!selectedMerchant) return
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-merchant`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ target_merchant_code: selectedMerchant, mode }),
        }
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'خطأ')
        if (json.error?.includes('OPENROUTER_API_KEY')) setShowSetup(true)
      } else {
        setInsight(json.insight)
        loadHistory()
      }
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  const c = insight?.content
  const selectedName = merchants.find(m => m.merchant_code === selectedMerchant)?.name || selectedMerchant

  return (
    <div>
      {/* OpenRouter setup guide */}
      <div style={{ ...S.chartCard, marginBottom: 20, borderRight: '3px solid #ffd166', cursor: 'pointer' }} onClick={() => setShowSetup(v => !v)}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🔑</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>إعداد مفتاح OpenRouter</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>مطلوب لتشغيل تحليل AI — اضغط لعرض الخطوات</div>
            </div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{showSetup ? '▲' : '▼'}</span>
        </div>
        {showSetup && (
          <div style={{ padding: '0 18px 18px', borderTop: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {[
                { n: 1, t: 'إنشاء حساب OpenRouter', d: 'اذهب إلى openrouter.ai وسجّل حساباً مجانياً' },
                { n: 2, t: 'إنشاء API Key', d: 'من لوحة التحكم → "Keys" → "Create Key" — انسخ المفتاح' },
                { n: 3, t: 'إضافة المفتاح في Supabase', d: 'Supabase Dashboard → Edge Functions → Secrets → "Add Secret"' },
                { n: 4, t: 'اسم المتغير', d: 'الاسم: OPENROUTER_API_KEY  |  القيمة: مفتاحك (يبدأ بـ sk-or-)' },
                { n: 5, t: 'جاهز', d: 'ارجع هنا واضغط "تشغيل تحليل AI"' },
              ].map(s => (
                <div key={s.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ width: 24, height: 24, borderRadius: 8, background: 'rgba(255,209,102,0.2)', color: '#ffd166', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{s.n}</span>
                  <div><div style={{ fontSize: 13, fontWeight: 700 }}>{s.t}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.d}</div></div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, fontFamily: 'monospace', fontSize: 12, color: 'var(--text2)' }}>
              النماذج المتاحة:<br />
              ⚡ <strong>Quick</strong> — Gemini 2.0 Flash (سريع، رخيص، للفحص اليومي)<br />
              🧠 <strong>Deep</strong> — Claude Opus 4 (تحليل موسع، للتقارير الشهرية)
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <select style={{ ...S.filterSelect, minWidth: 220 }} value={selectedMerchant} onChange={e => setSelectedMerchant(e.target.value)}>
          {merchants.map(m => <option key={m.id} value={m.merchant_code}>{m.name} ({m.merchant_code})</option>)}
        </select>

        {/* Mode toggle */}
        <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {(['quick', 'deep'] as const).map(m => (
            <button
              key={m}
              style={{ border: 'none', padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--text2)' }}
              onClick={() => setMode(m)}
            >
              {m === 'quick' ? '⚡ سريع' : '🧠 عميق'}
            </button>
          ))}
        </div>

        <button
          style={{ background: 'linear-gradient(135deg,var(--accent),#a594ff)', border: 'none', color: '#fff', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(124,107,255,0.35)' }}
          onClick={runAnalysis}
          disabled={loading || !selectedMerchant}
        >
          {loading ? '⟳ جاري التحليل...' : '✨ تشغيل تحليل AI'}
        </button>
        {insight && (
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            آخر تحليل: {new Date(insight.created_at).toLocaleString('ar-SA')} · {insight.model_used?.split('/')[1] || insight.model_used}
          </span>
        )}
      </div>

      {error && (
        <div style={{ ...S.msgBox, ...S.msgErr, marginBottom: 16 }}>{error}</div>
      )}

      {!insight && !loading && (
        <div style={{ ...S.chartCard, padding: 60, textAlign: 'center', color: 'var(--text3)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>لا يوجد تحليل لـ {selectedName}</div>
          <div style={{ fontSize: 12 }}>اضغط "تشغيل تحليل AI" للحصول على رؤى مبنية على بيانات التاجر</div>
        </div>
      )}

      {insight && c && (
        <div>
          {/* Summary */}
          {c.summary && (
            <div style={{ ...S.chartCard, marginBottom: 16, borderRight: '3px solid var(--accent)', padding: '18px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>ملخص التاجر — {selectedName}</div>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text)' }}>{c.summary}</div>
            </div>
          )}

          {/* Cards grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 16 }}>

            {/* Forecast */}
            {c.forecast_next_week && (
              <div style={{ ...S.chartCard, padding: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>🔮 توقع الأسبوع القادم</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent)' }}>
                  {c.forecast_next_week.amount.toLocaleString()} ر.س
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  ثقة: <strong style={{ color: 'var(--text)' }}>{c.forecast_next_week.confidence}</strong>
                  {c.forecast_next_week.reasoning && ` — ${c.forecast_next_week.reasoning}`}
                </div>
              </div>
            )}

            {/* Best days */}
            {c.best_days && c.best_days.length > 0 && (
              <div style={{ ...S.chartCard, padding: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>📅 أفضل أيام البيع</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {c.best_days.map((d, i) => (
                    <span key={i} style={{ background: 'rgba(0,229,176,0.15)', color: 'var(--accent2)', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>{d}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Best platforms */}
            {c.best_platforms && c.best_platforms.length > 0 && (
              <div style={{ ...S.chartCard, padding: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>🏆 أفضل المنصات</div>
                {c.best_platforms.map((p, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginLeft: 6 }}>{PLATFORM_MAP[p.platform] || p.platform}</span>
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>{p.reason}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Low stock alert */}
            {c.low_stock_alert && c.low_stock_alert.length > 0 && (
              <div style={{ ...S.chartCard, padding: 20, borderRight: '3px solid #ff4d6d' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#ff4d6d', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>🚨 تحذير مخزون</div>
                {c.low_stock_alert.map((p, i) => (
                  <div key={i} style={{ fontSize: 13, color: '#ff4d6d', marginBottom: 5 }}>• {p}</div>
                ))}
              </div>
            )}
          </div>

          {/* Recommendations */}
          {c.recommendations && c.recommendations.length > 0 && (
            <div style={{ ...S.chartCard, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.5px' }}>💡 التوصيات</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {c.recommendations.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'var(--bg)', borderRadius: 10, padding: '12px 14px' }}>
                    <span style={{ width: 24, height: 24, borderRadius: 8, background: 'rgba(124,107,255,0.2)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Seasonal insights */}
          {c.seasonal_insights && c.seasonal_insights.length > 0 && (
            <div style={{ ...S.chartCard, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.5px' }}>🗓️ الرؤى الموسمية</div>
              {c.seasonal_insights.map((s, i) => (
                <div key={i} style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8, paddingRight: 12, borderRight: '2px solid var(--accent2)' }}>{s}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <div style={{ ...S.tableCard, marginTop: 20 }}>
          <div style={{ ...S.tableHeader }}>
            <div style={S.chartTitle}>📋 سجل التحليلات</div>
          </div>
          <table style={S.table}>
            <thead>
              <tr>
                {['التاريخ', 'النموذج', 'ملخص مختصر', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.id} style={{ ...S.tr, cursor: 'pointer' }} onClick={() => setInsight(h)}>
                  <td style={{ ...S.td, fontSize: 12 }}>{new Date(h.created_at).toLocaleString('ar-SA')}</td>
                  <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>{h.model_used}</td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(h.content as any).summary?.slice(0, 80) || '—'}
                  </td>
                  <td style={S.td}>
                    <span style={{ fontSize: 11, color: insight?.id === h.id ? 'var(--accent)' : 'var(--text3)' }}>
                      {insight?.id === h.id ? '● محدد' : 'عرض'}
                    </span>
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

// ─── Entry View ──────────────────────────────────────────────────────────────

const ENTRY_PLATFORMS = [
  { value: 'trendyol', label: 'تراندايول' },
  { value: 'noon',     label: 'نون'       },
  { value: 'amazon',   label: 'أمازون'    },
  { value: 'salla',    label: 'سلة'       },
  { value: 'zid',      label: 'زد'        },
  { value: 'shopify',  label: 'شوبيفاي'   },
  { value: 'other',    label: 'أخرى'      },
]

function EntryView({ merchants }: { merchants: any[] }) {
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
      setLog(p => [
        ...toSave.map(r => ({
          date: r.data_date,
          merchant: merchants.find(m => m.merchant_code === r.merchant_code)?.name || r.merchant_code,
          platform: PLATFORM_MAP[r.platform] || r.platform,
          sales: Number(r.total_sales),
        })),
        ...p,
      ].slice(0, 50))
      setRows([])
      setForm(blank)
    } finally { setSaving(false) }
  }

  const merchantName = (code: string) => merchants.find(m => m.merchant_code === code)?.name || code

  return (
    <div style={{ padding: '0 24px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>📝 إدخال بيانات مبيعات يدوياً</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>أدخل بيانات المبيعات لأي تاجر ومنصة — تظهر فوراً في لوحة التاجر كأنها جاءت من الربط التلقائي</div>
      </div>

      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600,
          background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)',
          color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)',
          border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.3)' : 'rgba(255,77,109,0.3)'}`,
        }}>{msg.text}</div>
      )}

      {/* Form */}
      <div style={{ ...S.chartCard, marginBottom: 20, padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, color: 'var(--text2)' }}>إضافة سجل</div>
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
          <button style={{ ...S.btn, background: 'var(--accent)', color: '#fff' }} onClick={addRow}>+ إضافة للقائمة</button>
          <button style={{ ...S.btn, background: 'var(--accent2)', color: '#111' }} onClick={submit} disabled={saving}>
            {saving ? '⟳ جاري الحفظ...' : `💾 حفظ${rows.length > 0 ? ` (${rows.length} سجل)` : ' مباشرة'}`}
          </button>
        </div>
      </div>

      {/* Pending rows */}
      {rows.length > 0 && (
        <div style={{ ...S.chartCard, marginBottom: 20 }}>
          <div style={{ padding: '14px 16px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>سجلات في الانتظار ({rows.length})</span>
            <button style={{ ...S.btn, background: 'var(--accent2)', color: '#111', fontSize: 12 }} onClick={submit} disabled={saving}>
              {saving ? '⟳ جاري...' : '💾 حفظ الكل'}
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead><tr>
                {['التاجر', 'المنصة', 'التاريخ', 'المبيعات', 'الطلبات', 'الرسوم', 'الإعلانات', 'الهامش', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
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
                    <td style={S.td}>
                      <button style={{ ...S.miniBtn, color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => removeRow(i)}>حذف</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Session log */}
      {log.length > 0 && (
        <div style={S.chartCard}>
          <div style={{ padding: '14px 16px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>
            سجل الإدخالات — هذه الجلسة
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead><tr>
                {['التاريخ', 'التاجر', 'المنصة', 'المبيعات'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  sidebar: {
    background: 'var(--surface)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column',
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 230, zIndex: 100,
  },
  sidebarLogo: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '20px 16px', borderBottom: '1px solid var(--border)',
  },
  logoIcon: {
    width: 40, height: 40, borderRadius: 12,
    background: 'linear-gradient(135deg,var(--accent),var(--accent2))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18, fontWeight: 800, color: '#fff', flexShrink: 0,
  },
  logoText: { fontSize: 17, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 },
  logoBadge: {
    fontSize: 10, fontWeight: 700, color: 'var(--accent)',
    background: 'rgba(124,107,255,0.15)', padding: '2px 7px',
    borderRadius: 20, marginTop: 3, display: 'inline-block',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '11px 16px', color: 'var(--text2)', cursor: 'pointer',
    transition: 'all 0.2s', fontSize: 13, fontWeight: 500,
  },
  navActive: { color: 'var(--accent)', background: 'rgba(124,107,255,0.1)', borderRight: '3px solid var(--accent)' },
  navIcon: { fontSize: 17, flexShrink: 0 },
  sidebarBottom: { padding: '16px', borderTop: '1px solid var(--border)' },
  adminInfo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  adminAvatar: {
    width: 36, height: 36, borderRadius: 10,
    background: 'linear-gradient(135deg,var(--accent),var(--accent2))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  adminName: { fontSize: 13, fontWeight: 600, color: 'var(--text)' },
  adminRole: { fontSize: 10, color: 'var(--accent)', marginTop: 2, fontWeight: 700 },
  logoutBtn: {
    width: '100%', background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text2)', padding: '8px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
  },
  main: { flex: 1, marginRight: 230, padding: '28px 32px', minHeight: '100vh' },
  topbar: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 },
  pageTitle: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  pageSub: { fontSize: 12, color: 'var(--text3)', marginTop: 3 },
  refreshBtn: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  cardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 },
  kpiCard: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
    padding: '20px', position: 'relative', overflow: 'hidden',
  },
  kpiBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0' },
  kpiTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  kpiLabel: { fontSize: 12, color: 'var(--text3)', fontWeight: 600 },
  kpiIcon: { width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 },
  kpiValue: { fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1 },
  kpiSub: { fontSize: 11, color: 'var(--text3)', marginTop: 6 },
  chartCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 },
  chartHeader: { marginBottom: 16 },
  chartTitle: { fontSize: 14, fontWeight: 700 },
  chartSub: { fontSize: 11, color: 'var(--text3)', marginTop: 3 },
  emptyChart: { height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 },
  tableCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' },
  tableHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', fontSize: 13, color: 'var(--text)' },
  badge: { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace' },
  codeTag: { background: 'rgba(124,107,255,0.15)', color: 'var(--accent)', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace', fontWeight: 700 },
  roleBadge: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
  platformTag: { padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  searchInput: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '10px 14px', borderRadius: 10, fontSize: 13, outline: 'none',
  },
  addBtn: {
    background: 'linear-gradient(135deg,var(--accent),#a594ff)', border: 'none', color: '#fff',
    padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
    boxShadow: '0 4px 16px rgba(124,107,255,0.3)', cursor: 'pointer',
  },
  formCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 },
  formTitle: { fontSize: 14, fontWeight: 700, marginBottom: 16 },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.5px' },
  input: {
    width: '100%', padding: '9px 12px', background: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)',
    fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const,
  },
  saveBtn: {
    background: 'var(--accent)', border: 'none', color: '#fff',
    padding: '10px 24px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  miniBtn: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  fieldGroup: { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.4px' },
  filterSelect: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '8px 12px', borderRadius: 9, fontSize: 12, outline: 'none', cursor: 'pointer',
  },
  presetBtn: {
    padding: '7px 14px', border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text2)', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  presetActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' },
  tabBtn:    { padding: '10px 20px', background: 'transparent', border: 'none', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1 },
  tabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  msgBox: { borderRadius: 10, padding: '12px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  msgOk: { background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.3)', color: 'var(--green)' },
  msgErr: { background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)', color: 'var(--red)' },
}
