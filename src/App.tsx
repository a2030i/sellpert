import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase'
import { useCallback } from 'react'
import { useMobile } from './lib/hooks'
import Login from './pages/Login'
import PasswordRecovery from './pages/PasswordRecovery'
import { ToastContainer, toastErr } from './components/Toast'
import OnboardingFlow from './components/OnboardingFlow'
import AIChat from './components/AIChat'
import ThemeToggle from './components/ThemeToggle'
import AccountSwitcher from './components/AccountSwitcher'
import CommandPalette from './components/CommandPalette'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import NPSWidget from './components/NPSWidget'
import AccountAccessState from './components/AccountAccessState'
import {
  LayoutDashboard, Tags, Package, Megaphone, LifeBuoy,
  FileText, Link2, Settings as SettingsIcon, LogOut, Boxes, Users,
  Search, MoreHorizontal, X, Bell, ChevronDown, ListChecks,
  type LucideIcon,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import type { Merchant } from './lib/supabase'
import { hasMerchantPermission, type MerchantPermissionKey } from './lib/merchantPermissions'

// Lazy-loaded routes (code splitting)
// Dashboard lazy أيضاً: استيراده المباشر كان يسحب recharts كاملة (~870KB)
// إلى حزمة الدخول التي تُحمَّل حتى في شاشة تسجيل الدخول
const Dashboard     = lazy(() => import('./pages/DashboardV2'))
const AdminPanel    = lazy(() => import('./pages/AdminPanel'))
const Integrations  = lazy(() => import('./pages/Integrations'))
const Orders        = lazy(() => import('./pages/Orders'))
const Inventory     = lazy(() => import('./pages/Inventory'))
const Actions       = lazy(() => import('./pages/Actions'))
const Settings      = lazy(() => import('./pages/Settings'))
const Products      = lazy(() => import('./pages/Products'))
const Requests      = lazy(() => import('./pages/Requests'))
const Statement     = lazy(() => import('./pages/Statement'))
const Marketing     = lazy(() => import('./pages/Marketing'))
const Notifications = lazy(() => import('./pages/Notifications'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const ProductCompare = lazy(() => import('./pages/ProductCompare'))
const Help = lazy(() => import('./pages/Help'))
const QuickInventory = lazy(() => import('./pages/QuickInventory'))
const Team = lazy(() => import('./pages/Team'))

const PageFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
    <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
)

export type View = 'dashboard' | 'actions' | 'integrations' | 'orders' | 'inventory' | 'settings' | 'products' | 'requests' | 'statement' | 'marketing' | 'notifications' | 'product-detail' | 'product-compare' | 'help' | 'quick-inventory' | 'team'

const VALID_VIEWS: View[] = ['dashboard', 'actions', 'integrations', 'orders', 'inventory', 'settings', 'products', 'requests', 'statement', 'marketing', 'notifications', 'product-detail', 'product-compare', 'help', 'quick-inventory', 'team']

type NavItem = { Icon: LucideIcon; label: string; key: View; permission?: MerchantPermissionKey }
type NavGroup = { key: string; label: string; placement?: 'primary' | 'secondary'; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  { key: 'main', label: 'الرئيسية', items: [
    { Icon: LayoutDashboard, label: 'مركز القرارات', key: 'dashboard', permission: 'dashboard' },
  ]},
  { key: 'store', label: 'إدارة المتجر', items: [
    { Icon: ListChecks, label: 'خطة العمل', key: 'actions', permission: 'dashboard' },
    { Icon: Package, label: 'الطلبات', key: 'orders', permission: 'orders' },
    { Icon: Tags, label: 'المنتجات', key: 'products', permission: 'products' },
    { Icon: Boxes, label: 'المخزون', key: 'inventory', permission: 'inventory' },
  ]},
  { key: 'analytics', label: 'التقارير والتحليلات', items: [
    { Icon: FileText, label: 'الأرباح والتسويات', key: 'statement', permission: 'statement' },
    { Icon: Megaphone, label: 'الإعلانات والأداء', key: 'marketing', permission: 'marketing' },
  ]},
  { key: 'settings', label: 'الإعدادات', placement: 'secondary', items: [
    { Icon: Link2, label: 'الربط ورفع الملفات', key: 'integrations', permission: 'integrations' },
    { Icon: Users, label: 'الفريق والصلاحيات', key: 'team', permission: 'team' },
    { Icon: SettingsIcon, label: 'إعدادات المتجر', key: 'settings', permission: 'settings' },
  ]},
  { key: 'support', label: 'المساعدة', placement: 'secondary', items: [
    { Icon: LifeBuoy, label: 'الدعم ومركز المعرفة', key: 'requests' },
  ]},
]

const DEFAULT_COLLAPSED_GROUPS = new Set<string>(NAV_GROUPS.map(group => group.key))
const NAV_PARENT: Partial<Record<View, View>> = {
  help: 'requests', 'quick-inventory': 'inventory',
  'product-detail': 'products', 'product-compare': 'products',
  notifications: 'dashboard',
}

type SidebarBadges = {
  orders: number
  support: number
  integrationNeedsUpdate: boolean
}

const NAV_FLAT: NavItem[] = NAV_GROUPS.flatMap(g => g.items)
const NAV_ITEMS = NAV_FLAT  // alias للحفاظ على التوافق

const VIEW_PERMISSION: Partial<Record<View, MerchantPermissionKey>> = {
  dashboard: 'dashboard', actions: 'dashboard', notifications: 'dashboard',
  orders: 'orders',
  products: 'products', 'product-detail': 'products', 'product-compare': 'products',
  inventory: 'inventory', 'quick-inventory': 'inventory',
  marketing: 'marketing',
  statement: 'statement',
  integrations: 'integrations',
  team: 'team',
  settings: 'settings',
}

function canAccessMerchantView(account: Merchant | null, view: View): boolean {
  if (!account || account.role !== 'employee') return true
  const permission = VIEW_PERMISSION[view]
  return permission ? hasMerchantPermission(account, permission) : true
}

function visibleMerchantNav(account: Merchant | null): NavGroup[] {
  if (!account || account.role !== 'employee') return NAV_GROUPS
  return NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => !item.permission || hasMerchantPermission(account, item.permission)),
  })).filter(group => group.items.length > 0)
}

// تبويبات الجوال الأساسية (الباقي في ورقة «المزيد») — مختارة عمداً لا أول 5
const MOBILE_PRIMARY: View[] = ['dashboard', 'orders', 'products', 'inventory']

function readView(): View {
  const path = window.location.pathname.replace(/^\//, '').split('/')[0] as View
  return VALID_VIEWS.includes(path) ? path : 'dashboard'
}

// ── Notification Bell ─────────────────────────────────────────────────────────

interface Notification {
  id: string; title: string; body: string; is_read: boolean; created_at: string; type?: string
}

function NotificationBell({ merchantCode }: { merchantCode?: string }) {
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [open, setOpen]     = useState(false)
  const ref                 = useRef<HTMLDivElement>(null)
  const unread              = notifs.filter(n => !n.is_read).length

  const loadNotifs = useCallback(async () => {
    const { data } = await supabase.from('notifications').select('*')
      .eq('merchant_code', merchantCode).order('created_at', { ascending: false }).limit(20)
    setNotifs(data || [])
  }, [merchantCode])

  useEffect(() => {
    if (!merchantCode) return
    loadNotifs()
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [merchantCode, loadNotifs])

  async function markAllRead() {
    await supabase.from('notifications').update({ is_read: true })
      .eq('merchant_code', merchantCode).eq('is_read', false)
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  function relTime(iso: string) {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (m < 1) return 'الآن'
    if (m < 60) return `منذ ${m} د`
    const h = Math.floor(m / 60)
    if (h < 24) return `منذ ${h} س`
    return `منذ ${Math.floor(h / 24)} يوم`
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => { setOpen(v => !v); if (!open) loadNotifs() }}
        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <Bell size={17} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -3, right: -3, width: 15, height: 15, borderRadius: '50%', background: 'var(--red)', color: '#fff', fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 340, maxWidth: 'calc(100vw - 32px)', maxHeight: 420, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', zIndex: 10000, color: 'var(--text)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1d3b4d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e6f4' }}>الإشعارات</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ background: 'transparent', border: 'none', color: '#a598ff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>قراءة الكل</button>
            )}
          </div>
          {notifs.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--text3)' }}>لا توجد إشعارات</div>
            </div>
          ) : notifs.map(n => (
            <div key={n.id} style={{ padding: '12px 16px', background: n.is_read ? 'transparent' : 'rgba(108,92,231,0.08)', borderBottom: '1px solid #1d3b4d' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {!n.is_read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a598ff', flexShrink: 0, marginTop: 5 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e6f4', marginBottom: 3 }}>{n.title}</div>
                  <div style={{ fontSize: 11, color: '#8891b4', lineHeight: 1.5 }}>{n.body}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 5 }}>{relTime(n.created_at)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession]               = useState<Session | null>(null)
  const [merchant, setMerchant]             = useState<Merchant | null>(null)
  const [merchantLoadError, setMerchantLoadError] = useState('')
  const [loading, setLoading]               = useState(true)
  const [view, setView]                     = useState<View>(readView)
  const [mobileMore, setMobileMore]         = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(() => window.location.pathname === '/auth/recovery')
  const [impersonating, setImpersonating]   = useState<Merchant | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(DEFAULT_COLLAPSED_GROUPS))
  const [sidebarBadges, setSidebarBadges] = useState<SidebarBadges>({ orders: 0, support: 0, integrationNeedsUpdate: false })
  const explicitSignOut                     = useRef(false)
  const isMobile                            = useMobile()
  const activeMerchant                      = impersonating || merchant
  const merchantNavGroups                   = visibleMerchantNav(activeMerchant)
  const visibleNavItems                     = merchantNavGroups.flatMap(group => group.items)
  const visibleMobilePrimary                = MOBILE_PRIMARY.filter(key => visibleNavItems.some(item => item.key === key))

  function startImpersonate(m: Merchant) {
    setImpersonating(m)
    setView('dashboard')
    window.history.pushState(null, '', '/')
  }
  function stopImpersonate() {
    setImpersonating(null)
    window.history.pushState(null, '', '/admin/merchants')
  }

  useEffect(() => {
    // Handle magic link / token_hash in URL (e.g. impersonate from admin)
    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    const type = params.get('type') as 'magiclink' | 'recovery' | null

    if (tokenHash && type) {
      // Clear URL params first, then exchange token
      window.history.replaceState(null, '', '/')
      supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ data, error }) => {
        if (!error && data.session) {
          if (type === 'recovery') setShowPasswordRecovery(true)
          setSession(data.session)
          fetchMerchant(data.session.user.id)
        } else {
          setLoading(false)
        }
      })
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchMerchant(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') setShowPasswordRecovery(true)
      // Ignore transient events that aren't actual login/logout
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        if (session) setSession(session)
        return
      }
      if (event === 'SIGNED_OUT') {
        if (explicitSignOut.current) {
          setSession(null); setMerchant(null); setLoading(false)
          return
        }
        // Double-check before clearing state — sometimes a refresh race triggers
        // a spurious SIGNED_OUT. If the storage still has a valid session, ignore it.
        await new Promise(r => setTimeout(r, 250))
        const { data } = await supabase.auth.getSession()
        if (data.session) {
          setSession(data.session)
          return  // false alarm — session is fine
        }
        setSession(null); setMerchant(null); setLoading(false)
        return
      }
      // SIGNED_IN, PASSWORD_RECOVERY
      explicitSignOut.current = false
      setSession(session)
      if (session) fetchMerchant(session.user.id)
      else { setMerchant(null); setLoading(false) }
    })
    const onPopState = () => setView(readView())
    window.addEventListener('popstate', onPopState)
    return () => { subscription.unsubscribe(); window.removeEventListener('popstate', onPopState) }
  }, [])

  useEffect(() => {
    const code = (impersonating || merchant)?.merchant_code
    if (!code) return
    let cancelled = false
    Promise.all([
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('merchant_code', code).eq('platform', 'trendyol'),
      supabase.from('merchant_requests').select('id', { count: 'exact', head: true }).eq('merchant_code', code).eq('status', 'pending'),
      supabase.from('platform_credentials').select('is_active,last_sync_at').eq('merchant_code', code).eq('platform', 'trendyol').maybeSingle(),
    ]).then(([ordersResult, supportResult, credentialResult]) => {
      if (cancelled) return
      const credential = credentialResult.data
      const lastSyncAge = credential?.last_sync_at ? Date.now() - new Date(credential.last_sync_at).getTime() : Number.POSITIVE_INFINITY
      setSidebarBadges({
        orders: ordersResult.count || 0,
        support: supportResult.count || 0,
        integrationNeedsUpdate: !credential?.is_active || lastSyncAge > 24 * 60 * 60 * 1000,
      })
    })
    return () => { cancelled = true }
  }, [merchant?.merchant_code, impersonating?.merchant_code])

  useEffect(() => {
    if (!activeMerchant || canAccessMerchantView(activeMerchant, view)) return
    const fallback = visibleMerchantNav(activeMerchant).flatMap(group => group.items)[0]?.key || 'requests'
    setView(fallback)
    window.history.replaceState(null, '', '/' + (fallback === 'dashboard' ? '' : fallback))
  }, [activeMerchant?.id, activeMerchant?.role, activeMerchant?.permissions, view])

  function toggleNavGroup(key: string) {
    setCollapsedGroups(current => {
      const opening = current.has(key)
      const next = opening
        ? new Set(merchantNavGroups.filter(group => group.key !== key).map(group => group.key))
        : new Set(merchantNavGroups.map(group => group.key))
      return next
    })
  }

  async function fetchMerchant(userId: string) {
    setMerchantLoadError('')
    const { data: identity, error } = await supabase
      .from('merchants')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      setMerchantLoadError('تعذر الوصول إلى سجل مساحة العمل. تحقق من الاتصال ثم أعد المحاولة.')
      toastErr('تعذر تحميل بيانات الحساب: ' + error.message)
    }

    let resolved = identity as Merchant | null
    if (identity?.role === 'employee' && identity.owner_merchant_code) {
      const { data: owner, error: ownerError } = await supabase
        .from('merchants')
        .select('*')
        .eq('merchant_code', identity.owner_merchant_code)
        .maybeSingle()

      if (ownerError) {
        setMerchantLoadError('تعذر الوصول إلى المتجر المرتبط بهذا الحساب.')
        toastErr('تعذر تحميل المتجر المرتبط بالموظف: ' + ownerError.message)
      }
      if (owner) {
        resolved = {
          ...owner,
          role: identity.role,
          owner_merchant_code: identity.owner_merchant_code,
          permissions: identity.permissions,
          is_active: identity.is_active !== false && owner.is_active !== false,
          job_title: identity.job_title,
          department: identity.department,
          auth_user_id: identity.id,
          account_email: identity.email,
        } as Merchant
      }
    }

    if (!resolved && !error) {
      setMerchantLoadError('لم يتم العثور على مساحة عمل مرتبطة بهذا الحساب.')
    }

    setMerchant(resolved)
    setLoading(false)
    if (resolved && !resolved.onboarding_done && resolved.role === 'merchant') setShowOnboarding(true)
  }

  function goTo(v: View) {
    if (!canAccessMerchantView(activeMerchant, v)) {
      toastErr('ليس لديك صلاحية لفتح هذا القسم')
      return
    }
    setView(v)
    window.history.pushState(null, '', '/' + (v === 'dashboard' ? '' : v))
    window.scrollTo(0, 0)
  }

  async function signOut() {
    explicitSignOut.current = true
    setSession(null)
    setMerchant(null)
    setImpersonating(null)
    setShowOnboarding(false)
    setView('dashboard')
    window.history.replaceState(null, '', '/')
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) toastErr('تعذر إنهاء الجلسة بالكامل: ' + error.message)
  }

  // خريطة ابن→أب: تمييز «أين أنا» في القائمة يبقى مضاءً على المسارات الثانوية (كشف/مساعدة/مخزون...)
  const isActiveNav = (key: View) => view === key || NAV_PARENT[view] === key

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, border: '3px solid var(--border2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>جاري التحميل...</p>
      </div>
    </div>
  )

  if (!session) return <Login />
  if (showPasswordRecovery) return <PasswordRecovery onComplete={() => setShowPasswordRecovery(false)} />
  if (!merchant) return (
    <AccountAccessState
      state="missing"
      email={session.user.email}
      detail={merchantLoadError}
      onRetry={() => { setLoading(true); fetchMerchant(session.user.id) }}
      onSignOut={signOut}
    />
  )
  if (merchant.is_active === false) return (
    <AccountAccessState state="suspended" email={session.user.email} onSignOut={signOut} />
  )
  // Platform administrators use the administration console. Merchant
  // employees stay inside their owner's store with tenant permissions.
  if ((merchant?.role === 'admin' || merchant?.role === 'super_admin' || merchant?.role === 'staff') && !impersonating)
    return <AdminPanel merchant={merchant} onImpersonate={startImpersonate} onSignOut={signOut} />

  const BANNER_H = 44

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Impersonation Banner ── */}
      {impersonating && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: BANNER_H, zIndex: 10000, background: 'linear-gradient(90deg,#d97706,#b45309)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14 }}>👁</span>
            <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>
              تعرض حساب: <strong>{impersonating.name}</strong>
              <span style={{ opacity: 0.75, fontWeight: 400, marginRight: 6 }}>({impersonating.merchant_code})</span>
            </span>
          </div>
          <button onClick={stopImpersonate} style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)', color: '#fff', padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            ← العودة للأدمن
          </button>
        </div>
      )}

      {showOnboarding && activeMerchant && (
        <OnboardingFlow merchant={activeMerchant} onComplete={() => setShowOnboarding(false)} />
      )}

      {/* ── Desktop Sidebar ── */}
      {!isMobile && (
        <aside className="sidebar-dark" style={{ ...S.sidebar, top: impersonating ? BANNER_H : 0 }}>
          {/* Logo */}
          <div style={S.sidebarTop}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={S.logoIcon}>S</div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#f5fafc', lineHeight: 1.25, fontFamily: 'var(--font-heading)' }}>Sellpert</div>
                  <div style={{ fontSize: 11, color: '#9fb5c2', fontWeight: 500, marginTop: 2 }}>لوحة التاجر</div>
                </div>
              </div>
              {activeMerchant?.role !== 'employee' && <AccountSwitcher currentCode={activeMerchant?.merchant_code} onSwitch={async (code) => {
                const { data } = await supabase.from('merchants').select('*').eq('merchant_code', code).maybeSingle()
                if (data) setMerchant(data)
              }} />}
              <ThemeToggle />
              <NotificationBell merchantCode={activeMerchant?.merchant_code} />
            </div>
          </div>

          {/* Visible search trigger (الـ CommandPalette كان Cmd+K فقط) */}
          <div style={{ padding: '4px 14px 8px' }}>
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#b4c5cf', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'right' }}>
              <Search size={15} />
              <span style={{ flex: 1 }}>ابحث عن صفحة أو منتج…</span>
              <span style={{ fontSize: 11, opacity: 0.75, direction: 'ltr' }}>Ctrl K</span>
            </button>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '8px 0 12px', overflowY: 'auto' }}>
            {merchantNavGroups.map(group => (
              <div key={group.key} style={{
                padding: '6px 8px 2px',
                marginTop: group.placement === 'secondary' && group.key === 'settings' ? 14 : 0,
                paddingTop: group.placement === 'secondary' && group.key === 'settings' ? 14 : 6,
                borderTop: group.placement === 'secondary' && group.key === 'settings' ? '1px solid rgba(255,255,255,0.08)' : undefined,
              }}>
                <button type="button" aria-expanded={!collapsedGroups.has(group.key)} onClick={() => toggleNavGroup(group.key)} style={{ width: '100%', border: 0, background: 'transparent', padding: '9px 12px 6px', display: 'flex', alignItems: 'center', gap: 8, color: '#8fa6b5', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-heading)', cursor: 'pointer', textAlign: 'right' }}>
                  <span style={{ flex: 1 }}>{group.label}</span>
                  <ChevronDown size={13} style={{ transition: 'transform .2s ease', transform: collapsedGroups.has(group.key) ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                </button>
                {!collapsedGroups.has(group.key) ? group.items.map(item => {
                  const Icon = item.Icon
                  const numericBadge = item.key === 'orders' ? sidebarBadges.orders : item.key === 'requests' ? sidebarBadges.support : 0
                  const statusBadge = item.key === 'integrations' && sidebarBadges.integrationNeedsUpdate ? 'تحديث مطلوب' : ''
                  return (
                    <button type="button" key={item.key}
                      className={`nav-item${isActiveNav(item.key) ? ' active' : ''}`}
                      style={S.navItem}
                      onClick={() => goTo(item.key)}
                    >
                      <Icon size={16} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {numericBadge > 0 ? <span style={{ minWidth: 24, height: 20, padding: '0 6px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.11)', color: '#e2edf2', fontSize: 11, fontWeight: 700 }}>
                        {numericBadge > 999 ? '999+' : numericBadge.toLocaleString('ar-SA')}
                      </span> : null}
                      {statusBadge ? <span style={{ padding: '3px 7px', borderRadius: 9, background: 'rgba(242,122,26,.18)', color: '#ffc188', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{statusBadge}</span> : null}
                      {isActiveNav(item.key) && <div className="nav-dot" />}
                    </button>
                  )
                }) : null}
              </div>
            ))}
          </nav>

          {/* Merchant card */}
          <div style={S.sidebarBottom}>
            {activeMerchant && (
              <div style={S.merchantCard}>
                {activeMerchant.logo_url
                  ? <img src={activeMerchant.logo_url} alt="logo" style={{ ...S.merchantAvatar, objectFit: 'cover' } as React.CSSProperties} />
                  : <div style={S.merchantAvatar}>{activeMerchant.name?.[0] || 'T'}</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f7fa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeMerchant.name}</div>
                  <div style={{ fontSize: 11, color: '#9db1bd', marginTop: 3 }}>{activeMerchant.role === 'employee' ? 'عضو فريق' : 'حساب المتجر'}</div>
                </div>
              </div>
            )}
            <button style={S.logoutBtn} onClick={impersonating ? stopImpersonate : signOut}>
              {impersonating ? 'العودة للإدارة' : <><LogOut size={14}/> تسجيل الخروج</>}
            </button>
          </div>
        </aside>
      )}

      {/* ── Main Content ── */}
      <main style={{ flex: 1, minWidth: 0, minHeight: '100vh', marginRight: isMobile ? 0 : 220, paddingTop: isMobile ? 52 + (impersonating ? BANNER_H : 0) : (impersonating ? BANNER_H : 0), paddingBottom: isMobile ? 68 : 0, background: 'var(--bg)' }}>
        <Suspense fallback={<PageFallback />}>
          {view === 'dashboard'    && <Dashboard    merchant={activeMerchant} />}
          {view === 'actions'      && <Actions      merchant={activeMerchant} />}
          {view === 'products'     && <Products     merchant={activeMerchant} />}
          {view === 'orders'       && <Orders       merchant={activeMerchant} />}
          {view === 'inventory'    && <Inventory    merchant={activeMerchant} />}
          {view === 'requests'     && <Requests     merchant={activeMerchant} />}
          {view === 'statement'    && <Statement    merchant={activeMerchant} />}
          {view === 'integrations' && <Integrations merchant={activeMerchant} />}
          {view === 'marketing'    && <Marketing    merchant={activeMerchant} />}
          {view === 'notifications'&& <Notifications merchant={activeMerchant} />}
          {view === 'product-detail'  && <ProductDetail  merchant={activeMerchant} />}
          {view === 'product-compare' && <ProductCompare merchant={activeMerchant} />}
          {view === 'help'            && <Help           merchant={activeMerchant} />}
          {view === 'quick-inventory' && <QuickInventory  merchant={activeMerchant} />}
          {view === 'team'            && <Team            merchant={activeMerchant} />}
          {view === 'settings'     && <Settings     merchant={activeMerchant} onUpdate={m => { if (!impersonating) setMerchant(m) }} />}
        </Suspense>
      </main>
      <ToastContainer />
      <PWAInstallPrompt />
      <CommandPalette
        isAdmin={false}
        merchantCode={activeMerchant?.merchant_code}
        onNavigate={(p) => {
          const v = p.replace(/^\//, '').split('?')[0].split('/')[0] as View
          if (VALID_VIEWS.includes(v)) goTo(v)
          else window.location.href = p
        }}
      />
      {activeMerchant && activeMerchant.role !== 'employee' && <NPSWidget merchantCode={activeMerchant.merchant_code} />}
      {activeMerchant && hasMerchantPermission(activeMerchant, 'dashboard') && <AIChat merchantCode={activeMerchant.merchant_code} />}

      {/* ── Mobile Top Bar ── */}
      {isMobile && (
        <header style={{ ...S.mobileHeader, top: impersonating ? BANNER_H : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={S.logoIconSm}>S</div>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Sellpert</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', padding: 4, display: 'flex' }} aria-label="بحث">
              <Search size={20} />
            </button>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{activeMerchant?.name}</span>
          </div>
        </header>
      )}

      {/* ── Mobile Bottom Nav (4 أساسية + المزيد) ── */}
      {isMobile && (
        <nav style={S.bottomNav}>
          {visibleMobilePrimary.map(key => {
            const item = visibleNavItems.find(n => n.key === key)
            if (!item) return null
            const Icon = item.Icon
            return (
              <button key={item.key} onClick={() => goTo(item.key)} style={{ ...S.bottomNavBtn, color: isActiveNav(item.key) ? 'var(--accent)' : 'var(--text3)' }}>
                <Icon size={20} />
                <span style={{ fontSize: 11, marginTop: 2, fontWeight: 500 }}>{item.label}</span>
              </button>
            )
          })}
          <button aria-expanded={mobileMore} aria-controls="mobile-more-sheet" style={{ ...S.bottomNavBtn, color: mobileMore ? 'var(--accent)' : 'var(--text3)' }} onClick={() => setMobileMore(true)}>
            <MoreHorizontal size={20} />
            <span style={{ fontSize: 11, marginTop: 2, fontWeight: 500 }}>المزيد</span>
          </button>
        </nav>
      )}

      {/* ── Mobile "المزيد" sheet (كل الوجهات المتبقية) ── */}
      {isMobile && mobileMore && (
        <div onClick={() => setMobileMore(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
          <div id="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="كل صفحات النظام" onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--surface)', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: '16px 14px 24px', maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>كل الصفحات</span>
              <button aria-label="إغلاق قائمة الصفحات" onClick={() => setMobileMore(false)} style={{ background: 'var(--surface2)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: 'var(--text2)', display: 'flex' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {visibleNavItems.filter(n => !visibleMobilePrimary.includes(n.key)).map(item => {
                const Icon = item.Icon
                return (
                  <button key={item.key} onClick={() => { goTo(item.key); setMobileMore(false) }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 6px', background: view === item.key ? 'var(--accent-12)' : 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, color: view === item.key ? 'var(--accent)' : 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600 }}>
                    <Icon size={20} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
              <button onClick={signOut}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 6px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--danger-text)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600 }}>
                <LogOut size={20} />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  sidebar: {
    display: 'flex', flexDirection: 'column',
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 220, zIndex: 100,
    background: '#071c2c',
    borderLeft: '1px solid #1d3b4d',
  },
  sidebarTop: {
    padding: '18px 16px',
    borderBottom: '1px solid #1d3b4d',
    flexShrink: 0,
  },
  logoIcon: {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    background: 'var(--accent-strong)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 800, color: '#fff',
  },
  logoIconSm: {
    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
    background: 'var(--accent-strong)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 800, color: '#fff',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 11,
    padding: '10px 12px', cursor: 'pointer',
    fontSize: 14, fontWeight: 500,
    color: '#b8c9d2', width: '100%', border: 'none', background: 'transparent',
    fontFamily: 'inherit', textAlign: 'right',
  },
  navIcon:      { fontSize: 16, flexShrink: 0, width: 20, textAlign: 'center' as const },
  sidebarBottom: { padding: '14px 16px', borderTop: '1px solid #1d3b4d', flexShrink: 0 },
  merchantCard:  { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  merchantAvatar: {
    width: 34, height: 34, borderRadius: 9, flexShrink: 0,
    background: 'var(--accent-strong)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, color: '#fff',
  },
  logoutBtn: {
    width: '100%', background: 'rgba(255,255,255,0.035)', border: '1px solid #1d3b4d',
    color: '#b8c9d2', padding: '9px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'inherit',
  },
  mobileHeader: {
    position: 'fixed', top: 0, left: 0, right: 0, height: 52,
    background: 'var(--surface)', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px', zIndex: 100,
    boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
  },
  bottomNav: {
    position: 'fixed', bottom: 0, left: 0, right: 0, height: 60,
    background: 'var(--surface)', borderTop: '1px solid var(--border)',
    display: 'flex', zIndex: 200,
    boxShadow: '0 -2px 12px rgba(0,0,0,0.06)',
  },
  bottomNavBtn: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 0, border: 'none', background: 'transparent',
    fontFamily: 'inherit', cursor: 'pointer', padding: '4px 0',
  },
}
