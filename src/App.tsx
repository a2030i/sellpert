import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase'
import { useMobile } from './lib/hooks'
import Login from './pages/Login'
import PasswordRecovery from './pages/PasswordRecovery'
import { ToastContainer, toastErr } from './components/Toast'
import OnboardingFlow from './components/OnboardingFlow'
import AccountSwitcher from './components/AccountSwitcher'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import AccountAccessState from './components/AccountAccessState'
import PageErrorBoundary from './components/PageErrorBoundary'
import MfaChallenge from './components/MfaChallenge'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import {
  LayoutDashboard, Tags, Package, Link2, LogOut, Boxes, Eye, BookOpen,
  type LucideIcon,
} from 'lucide-react'
import type { EmailOtpType, Session } from '@supabase/supabase-js'
import type { Merchant } from './lib/supabase'
import { hasMerchantPermission, type MerchantPermissionKey } from './lib/merchantPermissions'
import { requiresMfaChallenge } from './lib/accountSecurity'
import { userErrorMessage } from './lib/userError'

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
const ProductCatalog = lazy(() => import('./pages/ProductCatalog'))
const Requests      = lazy(() => import('./pages/Requests'))
const Statement     = lazy(() => import('./pages/Statement'))
const Marketing     = lazy(() => import('./pages/Marketing'))
const Notifications = lazy(() => import('./pages/Notifications'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const ProductCompare = lazy(() => import('./pages/ProductCompare'))
const Help = lazy(() => import('./pages/Help'))
const QuickInventory = lazy(() => import('./pages/QuickInventory'))
const Team = lazy(() => import('./pages/Team'))
const StoreStatus = lazy(() => import('./pages/StoreStatus'))
const StoreActivity = lazy(() => import('./pages/StoreActivity'))
const AccountSecurity = lazy(() => import('./pages/AccountSecurity'))
const CustomerService = lazy(() => import('./pages/CustomerService'))

const PageFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
    <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
)

export type View = 'dashboard' | 'actions' | 'integrations' | 'store-status' | 'activity' | 'security' | 'orders' | 'customers' | 'inventory' | 'settings' | 'products' | 'product-catalog' | 'requests' | 'statement' | 'marketing' | 'notifications' | 'product-detail' | 'product-compare' | 'help' | 'quick-inventory' | 'team'

const VALID_VIEWS: View[] = ['dashboard', 'actions', 'integrations', 'store-status', 'activity', 'security', 'orders', 'customers', 'inventory', 'settings', 'products', 'product-catalog', 'requests', 'statement', 'marketing', 'notifications', 'product-detail', 'product-compare', 'help', 'quick-inventory', 'team']
const PHASE_ONE_VIEWS = new Set<View>(['dashboard', 'integrations', 'orders', 'inventory', 'products', 'product-catalog', 'product-detail', 'quick-inventory'])

type NavItem = { Icon: LucideIcon; label: string; key: View; permission?: MerchantPermissionKey }
type NavGroup = { key: string; label: string; placement?: 'primary' | 'secondary'; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  { key: 'phase-one', label: 'المرحلة الأولى', items: [
    { Icon: LayoutDashboard, label: 'الرئيسية', key: 'dashboard', permission: 'dashboard' },
    { Icon: Package, label: 'الطلبات', key: 'orders', permission: 'orders' },
    { Icon: Tags, label: 'المنتجات', key: 'products', permission: 'products' },
    { Icon: BookOpen, label: 'دليل المنتجات', key: 'product-catalog', permission: 'products' },
    { Icon: Boxes, label: 'المخزون', key: 'inventory', permission: 'inventory' },
    { Icon: Link2, label: 'الربط', key: 'integrations', permission: 'integrations' },
  ]},
]

const NAV_PARENT: Partial<Record<View, View>> = {
  help: 'requests', 'quick-inventory': 'inventory',
  'product-detail': 'products', 'product-compare': 'products',
  notifications: 'dashboard',
}

const VIEW_PERMISSION: Partial<Record<View, MerchantPermissionKey>> = {
  dashboard: 'dashboard', actions: 'dashboard', notifications: 'dashboard',
  orders: 'orders',
  customers: 'customers',
  products: 'products', 'product-catalog': 'products', 'product-detail': 'products', 'product-compare': 'products',
  inventory: 'inventory', 'quick-inventory': 'inventory',
  marketing: 'marketing',
  statement: 'statement',
  integrations: 'integrations',
  'store-status': 'integrations',
  activity: 'settings',
  security: 'settings',
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

const MOBILE_PRIMARY: View[] = ['dashboard', 'orders', 'products', 'inventory', 'integrations']

function readView(): View {
  const path = window.location.pathname.replace(/^\//, '').split('/')[0] as View
  return VALID_VIEWS.includes(path) && PHASE_ONE_VIEWS.has(path) ? path : 'dashboard'
}

// ── Notification Bell ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession]               = useState<Session | null>(null)
  const [merchant, setMerchant]             = useState<Merchant | null>(null)
  const [merchantLoadError, setMerchantLoadError] = useState('')
  const [loading, setLoading]               = useState(true)
  const [mfaRequired, setMfaRequired]       = useState(false)
  const [view, setView]                     = useState<View>(readView)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(() => window.location.pathname === '/auth/recovery')
  const [passwordSetupMode, setPasswordSetupMode] = useState<'recovery' | 'invite'>(() =>
    new URLSearchParams(window.location.search).get('flow') === 'invite' ? 'invite' : 'recovery',
  )
  const [impersonating, setImpersonating]   = useState<Merchant | null>(null)
  const explicitSignOut                     = useRef(false)
  const isMobile                            = useMobile()
  const activeMerchant                      = impersonating || merchant
  const continueSessionRef                  = useRef<(nextSession: Session, skipMfa?: boolean) => Promise<void>>(async () => undefined)
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
    const type = params.get('type') as EmailOtpType | null

    if (tokenHash && type) {
      // Clear URL params first, then exchange token
      const isPasswordSetup = type === 'recovery' || type === 'invite'
      window.history.replaceState(null, '', isPasswordSetup ? '/auth/recovery' : '/')
      supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ data, error }) => {
        if (!error && data.session) {
          if (isPasswordSetup) {
            setPasswordSetupMode(type === 'invite' ? 'invite' : 'recovery')
            setShowPasswordRecovery(true)
          }
          continueSessionRef.current(data.session, isPasswordSetup)
        } else {
          window.history.replaceState(null, '', '/?auth_error=verification_failed')
          setLoading(false)
        }
      })
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) continueSessionRef.current(session)
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
      // SIGNED_IN, PASSWORD_RECOVERY and MFA_CHALLENGE_VERIFIED
      explicitSignOut.current = false
      if (session) continueSessionRef.current(session, event === 'PASSWORD_RECOVERY')
      else { setMerchant(null); setLoading(false) }
    })
    const onPopState = () => setView(readView())
    window.addEventListener('popstate', onPopState)
    return () => { subscription.unsubscribe(); window.removeEventListener('popstate', onPopState) }
  }, [])

  useEffect(() => {
    if (!activeMerchant || canAccessMerchantView(activeMerchant, view)) return
    const fallback = visibleMerchantNav(activeMerchant).flatMap(group => group.items)[0]?.key || 'requests'
    setView(fallback)
    window.history.replaceState(null, '', '/' + (fallback === 'dashboard' ? '' : fallback))
  }, [activeMerchant, view])

  async function fetchMerchant(userId: string) {
    setMerchantLoadError('')
    const { data: identity, error } = await supabase
      .from('merchants')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      setMerchantLoadError('تعذر الوصول إلى سجل مساحة العمل. تحقق من الاتصال ثم أعد المحاولة.')
      console.error('load account', error)
      toastErr(userErrorMessage(error, 'تعذّر تحميل بيانات الحساب. أعد المحاولة.'))
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
        console.error('load employee owner store', ownerError)
        toastErr(userErrorMessage(ownerError, 'تعذّر تحميل المتجر المرتبط بالحساب.'))
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

  async function continueAuthenticatedSession(nextSession: Session, skipMfa = false) {
    setSession(nextSession)
    if (!skipMfa) {
      const { data: assurance, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(nextSession.access_token)
      if (!error && requiresMfaChallenge(assurance)) {
        setMerchant(null)
        setMfaRequired(true)
        setLoading(false)
        return
      }
    }
    setMfaRequired(false)
    await fetchMerchant(nextSession.user.id)
  }
  continueSessionRef.current = continueAuthenticatedSession

  function goTo(v: View) {
    const destination = PHASE_ONE_VIEWS.has(v) ? v : 'dashboard'
    if (!canAccessMerchantView(activeMerchant, destination)) {
      toastErr('ليس لديك صلاحية لفتح هذا القسم')
      return
    }
    setView(destination)
    window.history.pushState(null, '', '/' + (destination === 'dashboard' ? '' : destination))
    window.scrollTo(0, 0)
  }

  async function signOut() {
    explicitSignOut.current = true
    setSession(null)
    setMerchant(null)
    setImpersonating(null)
    setMfaRequired(false)
    setShowOnboarding(false)
    setView('dashboard')
    window.history.replaceState(null, '', '/')
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) { console.error('sign out', error); toastErr(userErrorMessage(error, 'تعذّر إنهاء الجلسة بالكامل. أغلق الصفحة إذا استمرت المشكلة.')) }
  }

  // خريطة ابن→أب: تمييز «أين أنا» في القائمة يبقى مضاءً على المسارات الثانوية (كشف/مساعدة/مخزون...)
  const isActiveNav = (key: View) => view === key || NAV_PARENT[view] === key

  if (window.location.pathname === '/privacy') return <Privacy />
  if (window.location.pathname === '/terms') return <Terms />

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, border: '3px solid var(--border2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>جاري التحميل...</p>
      </div>
    </div>
  )

  if (!session) return <Login />
  if (showPasswordRecovery) return <PasswordRecovery mode={passwordSetupMode} onComplete={async () => {
    setShowPasswordRecovery(false)
    setLoading(true)
    const { data } = await supabase.auth.getSession()
    if (data.session) await continueAuthenticatedSession(data.session)
    else setLoading(false)
  }} />
  if (mfaRequired) return <MfaChallenge onVerified={verifiedSession => {
    setLoading(true)
    continueAuthenticatedSession(verifiedSession)
  }} onSignOut={signOut} />
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
            <Eye size={16} color="#fff" aria-hidden="true" />
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
        <aside className="app-sidebar sidebar-dark" style={{ ...S.sidebar, top: impersonating ? BANNER_H : 0 }}>
          {/* Logo */}
          <div style={S.sidebarTop}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={S.logoIcon}>S</div>
                <div>
                  <div className="sidebar-brand-name" style={{ fontSize: 16, color: '#f5fafc', lineHeight: 1.4 }}>Sellpert</div>
                  <div className="sidebar-brand-caption" style={{ color: '#9fb5c2', fontWeight: 500, marginTop: 3 }}>لوحة التاجر</div>
                </div>
              </div>
              {activeMerchant?.role !== 'employee' && <AccountSwitcher currentCode={activeMerchant?.merchant_code} onSwitch={async (code) => {
                const { data } = await supabase.from('merchants').select('*').eq('merchant_code', code).maybeSingle()
                if (data) setMerchant(data)
              }} />}
            </div>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '18px 8px', overflowY: 'auto' }} aria-label="التنقل الرئيسي">
            {visibleNavItems.map(item => {
              const Icon = item.Icon
              return (
                <button type="button" key={item.key}
                  className={`nav-item${isActiveNav(item.key) ? ' active' : ''}`}
                  style={S.navItem}
                  onClick={() => goTo(item.key)}
                >
                  <Icon size={17} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {isActiveNav(item.key) && <div className="nav-dot" />}
                </button>
              )
            })}
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
                  <div className="sidebar-account-name" style={{ fontSize: 13, fontWeight: 600, color: '#f1f7fa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeMerchant.name}</div>
                  <div className="sidebar-account-caption" style={{ color: '#9db1bd', marginTop: 3 }}>{activeMerchant.role === 'employee' ? 'عضو فريق' : 'حساب المتجر'}</div>
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
        <PageErrorBoundary resetKey={view} onGoHome={() => goTo('dashboard')}>
          <Suspense fallback={<PageFallback />}>
            {view === 'dashboard'    && <Dashboard merchant={activeMerchant} onNavigate={goTo} />}
            {view === 'actions'      && <Actions      merchant={activeMerchant} />}
            {view === 'products'     && <Products     merchant={activeMerchant} />}
            {view === 'product-catalog' && <ProductCatalog merchant={activeMerchant} />}
            {view === 'orders'       && <Orders       merchant={activeMerchant} />}
            {view === 'customers'    && <CustomerService merchant={activeMerchant} />}
            {view === 'inventory'    && <Inventory    merchant={activeMerchant} />}
            {view === 'requests'     && <Requests     merchant={activeMerchant} />}
            {view === 'statement'    && <Statement    merchant={activeMerchant} />}
            {view === 'integrations' && <Integrations merchant={activeMerchant} />}
            {view === 'store-status' && <StoreStatus merchant={activeMerchant} />}
            {view === 'activity' && <StoreActivity merchant={activeMerchant} />}
            {view === 'security' && <AccountSecurity merchant={activeMerchant} />}
            {view === 'marketing'    && <Marketing    merchant={activeMerchant} />}
            {view === 'notifications'&& <Notifications merchant={activeMerchant} />}
            {view === 'product-detail'  && <ProductDetail  merchant={activeMerchant} />}
            {view === 'product-compare' && <ProductCompare merchant={activeMerchant} />}
            {view === 'help'            && <Help           merchant={activeMerchant} />}
            {view === 'quick-inventory' && <QuickInventory  merchant={activeMerchant} />}
            {view === 'team'            && <Team            merchant={activeMerchant} />}
            {view === 'settings'     && <Settings     merchant={activeMerchant} onUpdate={m => { if (!impersonating) setMerchant(m) }} />}
          </Suspense>
        </PageErrorBoundary>
      </main>
      <ToastContainer />
      <PWAInstallPrompt />

      {/* ── Mobile Top Bar ── */}
      {isMobile && (
        <header style={{ ...S.mobileHeader, top: impersonating ? BANNER_H : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={S.logoIconSm}>S</div>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Sellpert</span>
          </div>
          <span style={{ maxWidth: '48vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text3)' }}>{activeMerchant?.name}</span>
        </header>
      )}

      {/* ── Mobile Bottom Nav: phase-one destinations only ── */}
      {isMobile && (
        <nav style={S.bottomNav}>
          {visibleMobilePrimary.map(key => {
            const item = visibleNavItems.find(n => n.key === key)
            if (!item) return null
            const Icon = item.Icon
            return (
              <button key={item.key} onClick={() => goTo(item.key)} style={{ ...S.bottomNavBtn, color: isActiveNav(item.key) ? 'var(--accent)' : 'var(--text2)' }}>
                <Icon size={20} />
                <span style={{ fontSize: 11, marginTop: 2, fontWeight: 500 }}>{item.label}</span>
              </button>
            )
          })}
        </nav>
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
    fontSize: 14.25, fontWeight: 500, lineHeight: 1.75,
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
