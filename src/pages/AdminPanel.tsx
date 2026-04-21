import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant, PerformanceData, PlatformCredential, SyncLog } from '../lib/supabase'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'

// ─── Constants ───────────────────────────────────────────────────────────────

type AdminView = 'overview' | 'merchants' | 'performance' | 'integrations' | 'synclogs'

const NAV = [
  { key: 'overview' as AdminView, icon: '🏠', label: 'نظرة عامة' },
  { key: 'merchants' as AdminView, icon: '👥', label: 'التجار' },
  { key: 'performance' as AdminView, icon: '📊', label: 'الأداء' },
  { key: 'integrations' as AdminView, icon: '🔗', label: 'التكاملات' },
  { key: 'synclogs' as AdminView, icon: '🔄', label: 'سجل المزامنات' },
]

const PLATFORM_MAP: Record<string, string> = {
  trendyol: 'تراندايول', noon: 'نون', amazon: 'أمازون',
  salla: 'سلة', zid: 'زد', shopify: 'شوبيفاي', other: 'أخرى',
}
const PLATFORM_COLORS: Record<string, string> = {
  trendyol: '#f27a1a', noon: '#f5c518', amazon: '#ff9900',
  salla: '#7c6bff', zid: '#00e5b0', shopify: '#96bf48', other: '#5a5a7a',
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
  const [view, setView] = useState<AdminView>('overview')
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
              onClick={() => setView(item.key)}
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
        {view === 'integrations' && (
          <IntegrationsView
            merchants={merchantOnly}
            credentials={credentials}
            onRefresh={() => loadAll(true)}
          />
        )}
        {view === 'synclogs' && (
          <SyncLogsView
            merchants={merchantOnly}
            syncLogs={syncLogs}
          />
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
  const [addForm, setAddForm] = useState({ name: '', email: '', currency: 'SAR', role: 'merchant' })
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
    setSaving(true)
    const code = (addForm.role === 'merchant' ? 'M-' : 'A-') + Math.floor(1000 + Math.random() * 9000)
    const { error } = await supabase.from('merchants').insert({
      name: addForm.name.trim(),
      email: addForm.email.trim().toLowerCase(),
      currency: addForm.currency,
      role: addForm.role,
      merchant_code: code,
      subscription_plan: 'free',
    })
    setSaving(false)
    if (error) { setMsg({ type: 'err', text: 'خطأ: ' + error.message }); return }
    setMsg({ type: 'ok', text: `✓ تمت إضافة ${addForm.name} — الكود: ${code}` })
    setAddForm({ name: '', email: '', currency: 'SAR', role: 'merchant' })
    setShowAdd(false)
    onRefresh()
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            {[
              { key: 'name', label: 'الاسم الكامل', placeholder: 'متجر النور', type: 'text' },
              { key: 'email', label: 'البريد الإلكتروني', placeholder: 'merchant@example.com', type: 'email' },
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
              {saving ? 'جاري الحفظ...' : '✓ إضافة'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              ملاحظة: بعد الإضافة، أرسل للتاجر بريد الدعوة من Supabase Dashboard → Auth → Users → Invite
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
  filterSelect: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '8px 12px', borderRadius: 9, fontSize: 12, outline: 'none', cursor: 'pointer',
  },
  presetBtn: {
    padding: '7px 14px', border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text2)', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  presetActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' },
  msgBox: { borderRadius: 10, padding: '12px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  msgOk: { background: 'rgba(0,229,176,0.1)', border: '1px solid rgba(0,229,176,0.3)', color: 'var(--green)' },
  msgErr: { background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)', color: 'var(--red)' },
}
