import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import { PLATFORM_MAP } from '../lib/constants'
import FeesView from './FeesView'
import OverviewView from './admin/OverviewView'
import MerchantsView from './admin/MerchantsView'
import PerformanceView from './admin/PerformanceView'
import ConnectionsView from './admin/ConnectionsView'
import AiView from './admin/AiView'
import EntryView from './admin/EntryView'
import ImportFilesView from './admin/ImportFilesView'
import AdminProductsView from './admin/AdminProductsView'
import AdminRequestsView from './admin/AdminRequestsView'
import SallaView from './admin/SallaView'
import DBHealthView from './admin/DBHealthView'
import RevenueView from './admin/RevenueView'
import AdminBillingView from './admin/AdminBillingView'
import type { Merchant, PerformanceData, PlatformCredential } from '../lib/supabase'
import {
  LayoutDashboard, Users, Tag, Inbox, PenLine, Upload,
  TrendingUp, CreditCard, Percent, ShoppingBag,
  BarChart2, Key, Sparkles, Activity, LogOut,
  ChevronUp, Settings, Wallet, Server,
  type LucideIcon,
} from 'lucide-react'

type AdminView = 'overview' | 'merchants' | 'performance' | 'connections' | 'ai' | 'entry' | 'import' | 'products' | 'requests' | 'fees' | 'revenue' | 'salla' | 'health' | 'billing'

const ADMIN_VIEWS: AdminView[] = ['overview', 'merchants', 'performance', 'connections', 'ai', 'entry', 'import', 'products', 'requests', 'fees', 'revenue', 'salla', 'health', 'billing']

function readAdminView(): AdminView {
  const parts = window.location.pathname.split('/')
  const last = parts[parts.length - 1] as AdminView
  return ADMIN_VIEWS.includes(last) ? last : 'overview'
}

// ── Grouped sidebar navigation ──────────────────────────────────────────────

type NavGroup = {
  key: string
  label: string
  Icon: LucideIcon
  items: { key: AdminView; Icon: LucideIcon; label: string }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'home', label: 'الرئيسية', Icon: LayoutDashboard,
    items: [{ key: 'overview', Icon: LayoutDashboard, label: 'نظرة عامة' }],
  },
  {
    key: 'merchants', label: 'التجار', Icon: Users,
    items: [
      { key: 'merchants', Icon: Users,    label: 'التجار' },
      { key: 'products',  Icon: Tag,      label: 'المنتجات والأسعار' },
      { key: 'requests',  Icon: Inbox,    label: 'طلبات التجار' },
      { key: 'entry',     Icon: PenLine,  label: 'إدخال يدوي' },
      { key: 'import',    Icon: Upload,   label: 'استيراد ملفات' },
    ],
  },
  {
    key: 'finance', label: 'المالية', Icon: Wallet,
    items: [
      { key: 'revenue', Icon: TrendingUp, label: 'إيرادات Sellpert' },
      { key: 'billing', Icon: CreditCard, label: 'طلبات الدفع' },
      { key: 'fees',    Icon: Percent,    label: 'الرسوم والعمولات' },
    ],
  },
  {
    key: 'salla', label: 'سلة', Icon: ShoppingBag,
    items: [{ key: 'salla', Icon: ShoppingBag, label: 'تجار سلة' }],
  },
  {
    key: 'ops', label: 'التشغيل', Icon: Settings,
    items: [
      { key: 'performance',  Icon: BarChart2,  label: 'الأداء' },
      { key: 'connections',  Icon: Key,        label: 'المفاتيح والربط' },
      { key: 'ai',           Icon: Sparkles,   label: 'تحليل AI' },
    ],
  },
  {
    key: 'system', label: 'النظام', Icon: Server,
    items: [{ key: 'health', Icon: Activity, label: 'صحة قاعدة البيانات' }],
  },
]

function findGroupKey(v: AdminView): string | undefined {
  return NAV_GROUPS.find(g => g.items.some(i => i.key === v))?.key
}

const NAV_FLAT = NAV_GROUPS.flatMap(g => g.items)

// ── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  sidebar: {
    background: 'var(--surface)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column',
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 230, zIndex: 100,
    overflowY: 'auto', overflowX: 'hidden',
  },
  sidebarLogo: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '18px 16px', borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  logoIcon: {
    width: 36, height: 36, borderRadius: 10,
    background: 'linear-gradient(135deg,var(--accent),var(--accent2))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0,
  },
  logoText: { fontSize: 16, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 },
  logoBadge: { fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'rgba(124,107,255,0.15)', padding: '2px 7px', borderRadius: 20, marginTop: 3, display: 'inline-block' },
  navGroup: { padding: '6px 10px 2px' },
  navGroupHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
    fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.7px',
    userSelect: 'none' as const,
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', color: 'var(--text2)', cursor: 'pointer',
    borderRadius: 8, fontSize: 12, fontWeight: 500, marginBottom: 1,
    transition: 'all 0.15s',
  },
  navActive: { color: 'var(--accent)', background: 'rgba(124,107,255,0.1)', fontWeight: 700 },
  navIcon: { fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' as const },
  sidebarBottom: { padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0, marginTop: 'auto' },
  adminAvatar: {
    width: 32, height: 32, borderRadius: 8,
    background: 'linear-gradient(135deg,var(--accent),var(--accent2))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  refreshBtn: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  pageTitle: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  pageSub: { fontSize: 12, color: 'var(--text3)', marginTop: 3 },
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminPanel({ merchant: adminMerchant, onImpersonate }: { merchant: Merchant | null; onImpersonate: (m: Merchant) => void }) {
  const [view, setView]         = useState<AdminView>(readAdminView)
  const [mobileMore, setMobileMore] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const gk = findGroupKey(readAdminView())
    return gk ? new Set([gk]) : new Set()
  })
  const isMobile                = useMobile()

  function navTo(v: AdminView) {
    setView(v)
    setMobileMore(false)
    window.history.pushState(null, '', '/admin/' + v)
    const gk = findGroupKey(v)
    if (gk) setOpenGroups(prev => new Set([...prev, gk]))
  }

  function toggleGroup(key: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  useEffect(() => {
    const onPop = () => setView(readAdminView())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [perfData, setPerfData]   = useState<PerformanceData[]>([])
  const [credentials, setCredentials] = useState<PlatformCredential[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    const [m, p, c] = await Promise.all([
      supabase.from('merchants').select('*').order('created_at', { ascending: false }),
      supabase.from('performance_data').select('*').order('created_at', { ascending: false }),
      supabase.from('platform_credentials').select('*').order('updated_at', { ascending: false }),
    ])
    setMerchants(m.data || [])
    setPerfData(p.data || [])
    setCredentials(c.data || [])
    setLoading(false)
    setRefreshing(false)
  }

  const merchantOnly = useMemo(() => merchants.filter(m => m.role === 'merchant'), [merchants])

  const totalGMV = useMemo(() => perfData.reduce((s, r) => s + r.total_sales, 0), [perfData])
  const totalOrders = useMemo(() => perfData.reduce((s, r) => s + r.order_count, 0), [perfData])
  const activeIntegrations = useMemo(() => credentials.filter(c => c.is_active).length, [credentials])

  const gmvByMerchant = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of perfData) map[r.merchant_code] = (map[r.merchant_code] || 0) + r.total_sales
    return map
  }, [perfData])

  const gmvTrend = useMemo(() => {
    const map: Record<string, number> = {}
    const cutoff = Date.now() - 30 * 86400000
    for (const r of perfData) {
      const d = r.data_date || r.created_at.split('T')[0]
      if (new Date(d).getTime() < cutoff) continue
      map[d] = (map[d] || 0) + r.total_sales
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, gmv]) => ({
      date: new Date(date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }),
      gmv: Math.round(gmv),
    }))
  }, [perfData])

  const gmvByPlatform = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of perfData) map[r.platform] = (map[r.platform] || 0) + r.total_sales
    return Object.entries(map).map(([platform, gmv]) => ({ platform, name: PLATFORM_MAP[platform] || platform, gmv: Math.round(gmv) }))
  }, [perfData])

  const topMerchants = useMemo(() =>
    merchantOnly.map(m => ({ ...m, gmv: gmvByMerchant[m.merchant_code] || 0 })).sort((a, b) => b.gmv - a.gmv).slice(0, 5),
    [merchantOnly, gmvByMerchant]
  )

  const currentLabel = NAV_FLAT.find(n => n.key === view)?.label || ''

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

      {/* ── SIDEBAR (desktop) ── */}
      {!isMobile && (
        <aside style={S.sidebar}>
          <div style={S.sidebarLogo}>
            <div style={S.logoIcon}>S</div>
            <div>
              <div style={S.logoText}>Sellpert</div>
              <div style={S.logoBadge}>لوحة الإدارة</div>
            </div>
          </div>

          <nav style={{ flex: 1, padding: '8px 0 0' }}>
            {NAV_GROUPS.map(group => {
              const isOpen = openGroups.has(group.key)
              const hasActive = group.items.some(i => i.key === view)
              const GIcon = group.Icon
              return (
                <div key={group.key} style={S.navGroup}>
                  <div
                    style={{ ...S.navGroupHeader, color: hasActive ? 'var(--accent)' : 'var(--text3)' }}
                    onClick={() => toggleGroup(group.key)}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <GIcon size={12} />
                      {group.label}
                    </span>
                    <ChevronUp size={12} style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(0deg)' : 'rotate(180deg)' }} />
                  </div>
                  {isOpen && group.items.map(item => {
                    const IIcon = item.Icon
                    return (
                      <div
                        key={item.key}
                        style={{ ...S.navItem, ...(view === item.key ? S.navActive : {}) }}
                        onClick={() => navTo(item.key)}
                      >
                        <IIcon size={15} style={{ flexShrink: 0 }} />
                        <span>{item.label}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </nav>

          <div style={S.sidebarBottom}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={S.adminAvatar}>{adminMerchant?.name?.[0] || 'A'}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{adminMerchant?.name || 'مدير النظام'}</div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>{adminMerchant?.role === 'super_admin' ? 'Super Admin' : 'Admin'}</div>
              </div>
            </div>
            <button style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', padding: '8px', borderRadius: 8, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              onClick={() => supabase.auth.signOut()}><LogOut size={13} /> تسجيل الخروج</button>
          </div>
        </aside>
      )}

      {/* ── MAIN ── */}
      <main style={{ flex: 1, minHeight: '100vh', marginRight: isMobile ? 0 : 230, padding: isMobile ? '70px 12px 80px' : '28px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: isMobile ? 16 : 28 }}>
          <div>
            <h2 style={{ ...S.pageTitle, fontSize: isMobile ? 18 : 24 }}>{currentLabel}</h2>
            {!isMobile && <p style={S.pageSub}>{new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>}
          </div>
          <button style={S.refreshBtn} onClick={() => loadAll(true)} disabled={refreshing}>
            {refreshing ? '⟳' : '⟳ تحديث'}
          </button>
        </div>

        {view === 'overview'    && <OverviewView merchantOnly={merchantOnly} merchants={merchants} totalGMV={totalGMV} totalOrders={totalOrders} activeIntegrations={activeIntegrations} gmvTrend={gmvTrend} gmvByPlatform={gmvByPlatform} topMerchants={topMerchants} syncLogs={[]} perfData={perfData} />}
        {view === 'merchants'   && <MerchantsView merchants={merchants} gmvByMerchant={gmvByMerchant} credentials={credentials} onRefresh={() => loadAll(true)} onImpersonate={onImpersonate} />}
        {view === 'performance' && <PerformanceView merchants={merchantOnly} perfData={perfData} />}
        {view === 'connections' && <ConnectionsView merchants={merchantOnly} onRefresh={() => loadAll(true)} />}
        {view === 'ai'          && <AiView merchants={merchantOnly} />}
        {view === 'entry'       && <EntryView merchants={merchantOnly} />}
        {view === 'import'      && <ImportFilesView merchants={merchantOnly} />}
        {view === 'products'    && <AdminProductsView merchants={merchantOnly} />}
        {view === 'requests'    && <AdminRequestsView merchants={merchantOnly} />}
        {view === 'fees'        && <FeesView />}
        {view === 'revenue'     && <RevenueView merchants={merchantOnly} perfData={perfData} />}
        {view === 'salla'       && <SallaView onRefresh={() => loadAll(true)} />}
        {view === 'health'      && <DBHealthView />}
        {view === 'billing'     && <AdminBillingView />}
      </main>

      {/* ── Mobile Header ── */}
      {isMobile && (
        <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 52, background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', zIndex: 150 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,var(--accent),var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff' }}>S</div>
            <span style={{ fontSize: 14, fontWeight: 800 }}>Sellpert Admin</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{adminMerchant?.role === 'super_admin' ? 'Super Admin' : 'Admin'}</span>
        </header>
      )}

      {/* ── Mobile Bottom Nav ── */}
      {isMobile && (
        <>
          <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 60, background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', zIndex: 200 }}>
            {([
              { key: 'overview',    Icon: LayoutDashboard, label: 'نظرة'  },
              { key: 'merchants',   Icon: Users,           label: 'التجار' },
              { key: 'entry',       Icon: PenLine,         label: 'إدخال'  },
              { key: 'connections', Icon: Key,             label: 'الربط'  },
              { key: 'performance', Icon: BarChart2,       label: 'الأداء' },
            ] as { key: AdminView; Icon: LucideIcon; label: string }[]).map(item => {
              const BIcon = item.Icon
              return (
                <button key={item.key} onClick={() => navTo(item.key)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: view === item.key ? 'var(--accent)' : 'var(--text3)', fontFamily: 'inherit', cursor: 'pointer', padding: '4px 0' }}>
                  <BIcon size={20} />
                  <span style={{ fontSize: 9, marginTop: 2, fontWeight: view === item.key ? 700 : 400 }}>{item.label}</span>
                </button>
              )
            })}
            <button onClick={() => setMobileMore(v => !v)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: mobileMore ? 'var(--accent)' : 'var(--text3)', fontFamily: 'inherit', cursor: 'pointer', padding: '4px 0' }}>
              <Settings size={20} />
              <span style={{ fontSize: 9, marginTop: 2 }}>المزيد</span>
            </button>
          </nav>

          {mobileMore && (
            <div style={{ position: 'fixed', bottom: 60, left: 0, right: 0, background: 'var(--surface)', borderTop: '1px solid var(--border)', zIndex: 199, padding: '8px 0', maxHeight: '60vh', overflowY: 'auto' }}>
              {NAV_FLAT.filter(n => !['overview', 'merchants', 'entry', 'connections', 'performance'].includes(n.key)).map(item => {
                const MIcon = item.Icon
                return (
                  <div key={item.key} onClick={() => navTo(item.key)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', cursor: 'pointer', color: view === item.key ? 'var(--accent)' : 'var(--text)', fontWeight: view === item.key ? 700 : 400, fontSize: 14 }}>
                    <MIcon size={18} />
                    <span>{item.label}</span>
                  </div>
                )
              })}
              <div onClick={() => supabase.auth.signOut()} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, borderTop: '1px solid var(--border)', marginTop: 4 }}>
                <LogOut size={18} />
                <span>تسجيل الخروج</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
