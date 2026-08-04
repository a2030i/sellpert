import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabase'
import { listPlatformCredentials } from '../lib/platformCredentialManager'
import { fetchAll } from '../lib/db'
import { useMobile } from '../lib/hooks'
import { PLATFORM_MAP } from '../lib/constants'
import { performanceDateKey } from '../lib/adminPerformance'
import { uploadDisplayStatus } from '../lib/uploadStatus'
// كل الشاشات الإدارية lazy: الاستيراد المباشر كان يحمّل 24 شاشة (459KB +
// سلسلة xlsx 424KB) لكل مستخدم حتى لو كانت صلاحياته شاشتين فقط
const FeesView            = lazy(() => import('./FeesView'))
const OverviewView        = lazy(() => import('./admin/OverviewView'))
const MerchantsView       = lazy(() => import('./admin/MerchantsView'))
const PerformanceView     = lazy(() => import('./admin/PerformanceView'))
const ConnectionsView     = lazy(() => import('./admin/ConnectionsView'))
const AiView              = lazy(() => import('./admin/AiView'))
const EntryView           = lazy(() => import('./admin/EntryView'))
const ImportFilesView     = lazy(() => import('./admin/ImportFilesView'))
const UploadsLogView      = lazy(() => import('./admin/UploadsLogView'))
const InboundView         = lazy(() => import('./admin/InboundView'))
const AdsView             = lazy(() => import('./admin/AdsView'))
const OperationsView      = lazy(() => import('./admin/OperationsView'))
const TasksBoardView      = lazy(() => import('./admin/TasksBoardView'))
const WhatsAppManagerView = lazy(() => import('./admin/WhatsAppManagerView'))
const AuditLogView        = lazy(() => import('./admin/AuditLogView'))
const AdminProductsView   = lazy(() => import('./admin/AdminProductsView'))
const SallaView           = lazy(() => import('./admin/SallaView'))
const DBHealthView        = lazy(() => import('./admin/DBHealthView'))
const TeamDashboardView   = lazy(() => import('./admin/TeamDashboardView'))
const MerchantTimelineView = lazy(() => import('./admin/MerchantTimelineView'))
const EmployeesView       = lazy(() => import('./admin/EmployeesView'))
import CommandPalette from '../components/CommandPalette'
import PWAInstallPrompt from '../components/PWAInstallPrompt'
import type { Merchant, PerformanceData, PlatformCredential, SyncLog } from '../lib/supabase'
import {
  LayoutDashboard, Users, Tag, PenLine, Upload, Truck, Megaphone, History,
  Percent, ShoppingBag,
  BarChart2, Key, Sparkles, Activity, LogOut,
  ChevronUp, Settings, Wallet, Server,
  ClipboardList, PackageCheck, MessageCircle, FileInput,
  type LucideIcon,
} from 'lucide-react'

type AdminView = 'overview' | 'team' | 'merchants' | 'employees' | 'performance' | 'connections' | 'ai' | 'entry' | 'import' | 'uploads' | 'inbound' | 'ads' | 'operations' | 'tasks' | 'whatsapp' | 'audit' | 'products' | 'fees' | 'salla' | 'health'

const ADMIN_VIEWS: AdminView[] = ['overview', 'team', 'merchants', 'employees', 'performance', 'connections', 'ai', 'entry', 'import', 'uploads', 'inbound', 'ads', 'operations', 'tasks', 'whatsapp', 'audit', 'products', 'fees', 'salla', 'health']

function readAdminView(): AdminView {
  const parts = window.location.pathname.split('/')
  // بادئة /admin إلزامية حتى لا تتصادم مسارات التاجر مع مفاتيح الشاشات الإدارية.
  // الشاشات الإدارية فيتبدّل السياق صامتاً عند التحديث أثناء الانتحال
  if (parts[1] !== 'admin') return 'overview'
  if (parts[parts.length - 1] === 'requests') {
    window.history.replaceState(null, '', '/admin/tasks')
    return 'tasks'
  }
  const last = parts[parts.length - 1] as AdminView
  return ADMIN_VIEWS.includes(last) ? last : 'overview'
}

// ── Grouped sidebar navigation ──────────────────────────────────────────────

import type { PermKey } from '../lib/permissions'
import { hasPermission } from '../lib/permissions'

type NavItem = { key: AdminView; Icon: LucideIcon; label: string; perm?: PermKey | PermKey[]; adminOnly?: boolean }
type NavGroup = {
  key: string
  label: string
  Icon: LucideIcon
  items: NavItem[]
}

type AdminUpload = {
  id: string
  merchant_code: string
  platform: string
  status: string | null
  rows_inserted: number | null
  error_message: string | null
  uploaded_at: string | null
  finished_at: string | null
}

// Permission gates per view. If `perm` is set, employees need that permission.
// If `adminOnly` is true, only admins (managers) can see it.
const NAV_GROUPS: NavGroup[] = [
  {
    key: 'home', label: 'الرئيسية', Icon: LayoutDashboard,
    items: [
      { key: 'overview', Icon: LayoutDashboard, label: 'نظرة عامة' },
      { key: 'team',     Icon: BarChart2,       label: 'لوحة الفريق', adminOnly: true },
    ],
  },
  {
    key: 'merchants', label: 'التجار والمنتجات', Icon: Users,
    items: [
      { key: 'merchants', Icon: Users,         label: 'التجار',           perm: 'view_merchants' },
      { key: 'products',  Icon: Tag,           label: 'المنتجات والأسعار', perm: 'view_merchants' },
    ],
  },
  {
    key: 'data_entry', label: 'البيانات والاستيراد', Icon: FileInput,
    items: [
      { key: 'import',    Icon: Upload,   label: 'استيراد ملفات', perm: 'upload_files' },
      { key: 'uploads',   Icon: History,  label: 'سجل الاستيراد', perm: ['upload_files', 'view_audit'] },
      { key: 'entry',     Icon: PenLine,  label: 'إدخال يدوي',   perm: 'upload_files' },
    ],
  },
  {
    key: 'analytics', label: 'التحليلات والتسويق', Icon: BarChart2,
    items: [
      { key: 'performance', Icon: BarChart2, label: 'أداء التجار',      perm: 'view_merchants' },
      { key: 'ads',         Icon: Megaphone, label: 'أداء الإعلانات',   perm: 'manage_ads' },
      { key: 'ai',          Icon: Sparkles,  label: 'التحليل الذكي',    perm: 'view_merchants' },
    ],
  },
  {
    key: 'logistics', label: 'العمليات', Icon: Truck,
    items: [
      { key: 'inbound',   Icon: PackageCheck, label: 'الإرساليات والاستلام', perm: 'manage_inbound' },
      { key: 'operations',Icon: Truck,        label: 'العمليات والشحن',      perm: 'manage_inbound' },
    ],
  },
  {
    key: 'team_mgmt', label: 'الفريق والمهام', Icon: Users,
    items: [
      { key: 'employees', Icon: Users, label: 'الموظفون والمدراء', perm: 'create_staff' },
      { key: 'tasks', Icon: ClipboardList, label: 'المهام وطلبات التجار', perm: 'tasks' },
    ],
  },
  {
    key: 'communication', label: 'التواصل', Icon: MessageCircle,
    items: [
      { key: 'whatsapp', Icon: MessageCircle, label: 'إدارة الواتساب', perm: ['whatsapp_send', 'whatsapp_bulk'] },
    ],
  },
  {
    key: 'finance', label: 'المالية', Icon: Wallet,
    items: [
      { key: 'fees',    Icon: Percent,    label: 'الرسوم والعمولات', perm: 'view_finance' },
    ],
  },
  {
    key: 'integrations', label: 'الربط والتكاملات', Icon: Key,
    items: [
      { key: 'connections', Icon: Key,         label: 'المفاتيح والاتصالات', adminOnly: true },
      { key: 'salla',       Icon: ShoppingBag, label: 'تكامل سلة',           adminOnly: true },
    ],
  },
  {
    key: 'system', label: 'النظام', Icon: Server,
    items: [
      { key: 'health', Icon: Activity, label: 'صحة قاعدة البيانات', perm: 'view_db_health' },
      { key: 'audit',  Icon: History,  label: 'سجل التدقيق',         perm: 'view_audit' },
    ],
  },
]

// Filter nav for a given user — managers see everything, platform staff see
// only their explicit administration permissions.
function filterNavForUser(user: Merchant | null): NavGroup[] {
  if (!user) return []
  if (user.role === 'admin' || user.role === 'super_admin') return NAV_GROUPS
  return NAV_GROUPS.map(g => ({
    ...g,
    items: g.items.filter(item => {
      if (item.adminOnly) return false
      if (!item.perm) return true  // no gate
      const perms = Array.isArray(item.perm) ? item.perm : [item.perm]
      return perms.some(p => hasPermission(user, p))
    }),
  })).filter(g => g.items.length > 0)
}

function canAccessView(user: Merchant | null, view: AdminView): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'super_admin') return true
  if (view === 'overview') return true
  for (const g of NAV_GROUPS) {
    const item = g.items.find(i => i.key === view)
    if (!item) continue
    if (item.adminOnly) return false
    if (!item.perm) return true
    const perms = Array.isArray(item.perm) ? item.perm : [item.perm]
    return perms.some(p => hasPermission(user, p))
  }
  return false
}

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
    background: 'var(--accent-strong)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0,
  },
  logoText: { fontSize: 16, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 },
  logoBadge: { fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'rgba(15,149,140,0.15)', padding: '2px 7px', borderRadius: 20, marginTop: 3, display: 'inline-block' },
  navGroup: { padding: '6px 10px 2px' },
  navGroupHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
    fontSize: 10, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.7px',
    userSelect: 'none' as const, width: '100%', border: 'none', background: 'transparent', fontFamily: 'inherit',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', color: 'var(--text2)', cursor: 'pointer',
    borderRadius: 8, fontSize: 12, fontWeight: 500, marginBottom: 1,
    transition: 'all 0.15s', width: '100%', border: 'none', background: 'transparent', fontFamily: 'inherit', textAlign: 'right',
  },
  navActive: { color: '#d9fffb', background: 'rgba(15,149,140,0.20)', fontWeight: 700 },
  navIcon: { fontSize: 15, flexShrink: 0, width: 20, textAlign: 'center' as const },
  sidebarBottom: { padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0, marginTop: 'auto' },
  adminAvatar: {
    width: 32, height: 32, borderRadius: 8,
    background: 'var(--accent-strong)',
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

export default function AdminPanel({ merchant: adminMerchant, onImpersonate, onSignOut }: { merchant: Merchant | null; onImpersonate: (m: Merchant) => void; onSignOut: () => void }) {
  const [view, setView]         = useState<AdminView>(readAdminView)
  const [mobileMore, setMobileMore] = useState(false)
  const [timelineCode, setTimelineCode] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('code')
  })
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const gk = findGroupKey(readAdminView())
    return gk ? new Set([gk]) : new Set()
  })
  const isMobile                = useMobile()

  // Filter navigation by current user's permissions (admins see all, employees see allowed only)
  const visibleNav = useMemo(() => filterNavForUser(adminMerchant), [adminMerchant])
  const visibleNavFlat = useMemo(() => visibleNav.flatMap(g => g.items), [visibleNav])
  // أهم الرحلات اليومية أولاً، مع احترام صلاحيات الموظف وملء المواقع المتبقية تلقائياً.
  const mobileTabs = useMemo(() => {
    const preferred: AdminView[] = ['overview', 'merchants', 'import', 'performance']
    const preferredItems = preferred.map(key => visibleNavFlat.find(item => item.key === key)).filter(Boolean) as NavItem[]
    const remaining = visibleNavFlat.filter(item => !preferred.includes(item.key))
    return [...preferredItems, ...remaining].slice(0, 4)
  }, [visibleNavFlat])
  const mobileTabKeys = useMemo(() => mobileTabs.map(t => t.key), [mobileTabs])
  const isManager = adminMerchant?.role === 'admin' || adminMerchant?.role === 'super_admin'

  function navTo(v: AdminView) {
    if (!canAccessView(adminMerchant, v)) {
      // Redirect to first allowed view if employee tries to access blocked
      const first = visibleNavFlat[0]?.key || 'overview'
      v = first
    }
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
    const onPop = () => {
      setView(readAdminView())
      const p = new URLSearchParams(window.location.search)
      setTimelineCode(p.get('code'))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function openTimeline(code: string) {
    setTimelineCode(code)
    setView('merchants')
    window.history.pushState(null, '', '/admin/merchants?code=' + code)
  }
  function closeTimeline() {
    setTimelineCode(null)
    window.history.pushState(null, '', '/admin/merchants')
  }

  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [perfData, setPerfData]   = useState<PerformanceData[]>([])
  const [credentials, setCredentials] = useState<PlatformCredential[]>([])
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [openTaskCount, setOpenTaskCount] = useState(0)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    const [m, p, c, uploads, tasks] = await Promise.all([
      supabase.from('merchants').select('*').order('created_at', { ascending: false }),
      // fetchAll: GMV الكلي يُجمع من هذا الاستعلام — اقتطاع PostgREST عند
      // 1000 صف كان يعني أرقام نظرة عامة ناقصة بصمت
      fetchAll<PerformanceData>((f, t) =>
        supabase.from('performance_data').select('*')
          .order('data_date', { ascending: false }).order('merchant_code').order('platform').range(f, t), 'بيانات الأداء'),
      listPlatformCredentials(),
      supabase.from('platform_file_uploads')
        .select('id,merchant_code,platform,status,rows_inserted,error_message,uploaded_at,finished_at')
        .order('uploaded_at', { ascending: false }).limit(20),
      supabase.from('merchant_requests').select('status'),
    ])
    setMerchants(m.data || [])
    setPerfData(p)
    setCredentials(c || [])
    setSyncLogs(((uploads.data || []) as AdminUpload[]).map(upload => {
      const displayStatus = uploadDisplayStatus(upload.status, upload.uploaded_at)
      return {
        id: upload.id,
        merchant_code: upload.merchant_code,
        platform: upload.platform,
        status: displayStatus === 'success' ? 'success' : displayStatus === 'processing' ? 'running' : displayStatus === 'stalled' ? 'stalled' : 'error',
        records_synced: upload.rows_inserted || 0,
        error_message: upload.error_message || undefined,
        started_at: upload.uploaded_at || upload.finished_at || new Date().toISOString(),
        finished_at: upload.finished_at || undefined,
      }
    }))
    setOpenTaskCount((tasks.data || []).filter(task => !['done', 'rejected'].includes(task.status)).length)
    setLoading(false)
    setRefreshing(false)
  }

  const merchantOnly = useMemo(() => merchants.filter(m => m.role === 'merchant'), [merchants])

  const totalGMV = useMemo(() => perfData.reduce((s, r) => s + r.total_sales, 0), [perfData])
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
      const d = performanceDateKey(r)
      if (!d) continue
      if (new Date(d).getTime() < cutoff) continue
      map[d] = (map[d] || 0) + r.total_sales
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, gmv]) => ({
      date: new Date(date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric' }),
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

  const currentLabel = visibleNavFlat.find(n => n.key === view)?.label || NAV_FLAT.find(n => n.key === view)?.label || ''

  // Auto-redirect if current view is not allowed for this user
  useEffect(() => {
    if (!loading && adminMerchant && !canAccessView(adminMerchant, view)) {
      const first = visibleNavFlat[0]?.key || 'overview'
      if (view !== first) {
        setView(first)
        window.history.replaceState(null, '', '/admin/' + first)
      }
    }
  }, [view, adminMerchant, loading, visibleNavFlat])

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
        <aside className="app-sidebar sidebar-dark" style={S.sidebar}>
          <div style={S.sidebarLogo}>
            <div style={S.logoIcon}>S</div>
            <div>
              <div className="sidebar-brand-name" style={S.logoText}>Sellpert</div>
              <div className="sidebar-brand-caption" style={S.logoBadge}>لوحة الإدارة</div>
            </div>
          </div>

          <nav style={{ flex: 1, padding: '8px 0 0' }}>
            {visibleNav.map(group => {
              const isOpen = openGroups.has(group.key)
              const hasActive = group.items.some(i => i.key === view)
              const GIcon = group.Icon
              return (
                <div key={group.key} style={S.navGroup}>
                  <button type="button" className="sidebar-group-label"
                    aria-expanded={isOpen}
                    style={{ ...S.navGroupHeader, color: hasActive ? 'var(--accent)' : 'var(--text3)' }}
                    onClick={() => toggleGroup(group.key)}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <GIcon size={12} />
                      {group.label}
                    </span>
                    <ChevronUp size={12} style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(0deg)' : 'rotate(180deg)' }} />
                  </button>
                  {isOpen && group.items.map(item => {
                    const IIcon = item.Icon
                    return (
                      <button type="button"
                        key={item.key}
                        className={`nav-item${view === item.key ? ' active' : ''}`}
                        style={{ ...S.navItem, ...(view === item.key ? S.navActive : {}) }}
                        onClick={() => navTo(item.key)}
                      >
                        <IIcon size={15} style={{ flexShrink: 0 }} />
                        <span>{item.label}</span>
                      </button>
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
                <div className="sidebar-account-name" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{adminMerchant?.name || 'مدير النظام'}</div>
                <div style={{ fontSize: 10, color: isManager ? 'var(--accent)' : '#f59e0b', fontWeight: 700 }}>
                  {isManager ? 'مدير' : `موظف · ${visibleNavFlat.length} صلاحية`}
                </div>
              </div>
            </div>
            <button style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', padding: '8px', borderRadius: 8, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              onClick={onSignOut}><LogOut size={13} /> تسجيل الخروج</button>
          </div>
        </aside>
      )}

      {/* ── MAIN ── */}
      <main style={{ flex: 1, minWidth: 0, width: '100%', overflowX: 'hidden', minHeight: '100vh', marginRight: isMobile ? 0 : 230, padding: isMobile ? '70px 12px 80px' : '28px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: isMobile ? 16 : 28 }}>
          <div>
            <h2 style={{ ...S.pageTitle, fontSize: isMobile ? 18 : 24 }}>{currentLabel}</h2>
            {!isMobile && <p style={S.pageSub}>{new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>}
          </div>
          <button style={S.refreshBtn} onClick={() => loadAll(true)} disabled={refreshing}>
            {refreshing ? '⟳' : '⟳ تحديث'}
          </button>
        </div>

        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}><div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>}>
        {view === 'overview'    && <OverviewView merchantOnly={merchantOnly} totalGMV={totalGMV} activeIntegrations={activeIntegrations} totalIntegrations={credentials.length} openTaskCount={openTaskCount} gmvTrend={gmvTrend} gmvByPlatform={gmvByPlatform} topMerchants={topMerchants} syncLogs={syncLogs} perfData={perfData} />}
        {view === 'team'        && <TeamDashboardView />}
        {view === 'merchants'   && (
          timelineCode
            ? <MerchantTimelineView merchantCode={timelineCode} onBack={closeTimeline} />
            : <MerchantsView currentUser={adminMerchant} merchants={merchants} gmvByMerchant={gmvByMerchant} credentials={credentials} onRefresh={() => loadAll(true)} onImpersonate={onImpersonate} onOpenTimeline={openTimeline} />
        )}
        {view === 'employees'   && <EmployeesView merchants={merchants} currentUser={adminMerchant} currentUserId={adminMerchant?.id} onRefresh={() => loadAll(true)} />}
        {view === 'performance' && <PerformanceView merchants={merchantOnly} perfData={perfData} />}
        {view === 'connections' && <ConnectionsView merchants={merchantOnly} onRefresh={() => loadAll(true)} />}
        {view === 'ai'          && <AiView merchants={merchantOnly} canManageKey={Boolean(adminMerchant && ['admin', 'super_admin'].includes(adminMerchant.role))} />}
        {view === 'entry'       && <EntryView merchants={merchantOnly} />}
        {view === 'import'      && <ImportFilesView merchants={merchantOnly} />}
        {view === 'uploads'     && <UploadsLogView merchants={merchants} />}
        {view === 'inbound'     && <InboundView merchants={merchantOnly} />}
        {view === 'ads'         && <AdsView merchants={merchantOnly} />}
        {view === 'operations'  && <OperationsView merchants={merchantOnly} />}
        {view === 'whatsapp'    && <WhatsAppManagerView merchants={merchantOnly} />}
        {view === 'tasks'       && <TasksBoardView merchants={merchants} currentUserCode={adminMerchant?.merchant_code} currentUserRole={adminMerchant?.role} />}
        {view === 'audit'       && <AuditLogView merchants={merchantOnly} />}
        {view === 'products'    && <AdminProductsView merchants={merchantOnly} />}
        {view === 'fees'        && <FeesView />}
        {view === 'salla'       && <SallaView onRefresh={() => loadAll(true)} />}
        {view === 'health'      && <DBHealthView />}
        </Suspense>
      </main>

      <PWAInstallPrompt />
      <CommandPalette
        isAdmin
        onNavigate={(path) => {
          if (path.startsWith('/admin/')) {
            const part = path.replace('/admin/', '').split('?')[0]
            const code = new URLSearchParams(path.split('?')[1] || '').get('code')
            if (code && part === 'merchants') openTimeline(code)
            else if (ADMIN_VIEWS.includes(part as AdminView)) navTo(part as AdminView)
          } else {
            window.location.href = path
          }
        }}
      />

      {/* ── Mobile Header ── */}
      {isMobile && (
        <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 52, background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', zIndex: 150 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,var(--accent),var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff' }}>S</div>
            <span style={{ fontSize: 14, fontWeight: 800 }}>Sellpert {isManager ? 'Admin' : 'Staff'}</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>Admin</span>
        </header>
      )}

      {/* ── Mobile Bottom Nav ── */}
      {isMobile && (
        <>
          <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 60, background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', zIndex: 200 }}>
            {mobileTabs.map(item => {
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
              {visibleNavFlat.filter(n => !mobileTabKeys.includes(n.key)).map(item => {
                const MIcon = item.Icon
                return (
                  <div key={item.key} onClick={() => navTo(item.key)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', cursor: 'pointer', color: view === item.key ? 'var(--accent)' : 'var(--text)', fontWeight: view === item.key ? 700 : 400, fontSize: 14 }}>
                    <MIcon size={18} />
                    <span>{item.label}</span>
                  </div>
                )
              })}
              <button type="button" onClick={onSignOut} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, border: 'none', borderTop: '1px solid var(--border)', marginTop: 4, width: '100%', background: 'transparent', fontFamily: 'inherit' }}>
                <LogOut size={18} />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
