import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase'
import { useMobile } from './lib/hooks'
import { isSuspended, getPlan, PLANS, getUpgradePlan } from './lib/subscription'
import type { PlanKey } from './lib/subscription'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import { ToastContainer } from './components/Toast'
import SubscriptionBanner from './components/SubscriptionBanner'
import OnboardingFlow from './components/OnboardingFlow'
import AIChat from './components/AIChat'
import ThemeToggle, { applyStoredTheme } from './components/ThemeToggle'
import {
  LayoutDashboard, Tags, Package, Megaphone, LifeBuoy, ChevronDown, HelpCircle,
  FileText, CreditCard, Link2, Settings as SettingsIcon, LogOut, Boxes, BarChart3,
  type LucideIcon,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import type { Merchant } from './lib/supabase'

// Lazy-loaded routes (code splitting)
const AdminPanel    = lazy(() => import('./pages/AdminPanel'))
const EmployeePanel = lazy(() => import('./pages/EmployeePanel'))
const Integrations  = lazy(() => import('./pages/Integrations'))
const Orders        = lazy(() => import('./pages/Orders'))
const Inventory     = lazy(() => import('./pages/Inventory'))
const Settings      = lazy(() => import('./pages/Settings'))
const Products      = lazy(() => import('./pages/Products'))
const Requests      = lazy(() => import('./pages/Requests'))
const Statement     = lazy(() => import('./pages/Statement'))
const Billing       = lazy(() => import('./pages/Billing'))
const Marketing     = lazy(() => import('./pages/Marketing'))
const Notifications = lazy(() => import('./pages/Notifications'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const ProductCompare = lazy(() => import('./pages/ProductCompare'))
const Help = lazy(() => import('./pages/Help'))

const PageFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
    <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
)

export type View = 'dashboard' | 'integrations' | 'orders' | 'inventory' | 'settings' | 'products' | 'requests' | 'statement' | 'billing' | 'marketing' | 'notifications' | 'product-detail' | 'product-compare' | 'help'

const VALID_VIEWS: View[] = ['dashboard', 'integrations', 'orders', 'inventory', 'settings', 'products', 'requests', 'statement', 'billing', 'marketing', 'notifications', 'product-detail', 'product-compare', 'help']

type NavItem = { Icon: LucideIcon; label: string; key: View }
type NavGroup = { key: string; label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  { key: 'main',      label: 'الرئيسية', items: [
    { Icon: LayoutDashboard, label: 'لوحة التحكم', key: 'dashboard' },
  ]},
  { key: 'sales',     label: 'المبيعات',  items: [
    { Icon: Package,    label: 'الطلبات',     key: 'orders'    },
    { Icon: FileText,   label: 'كشف الحساب', key: 'statement' },
  ]},
  { key: 'catalog',   label: 'الكاتالوج', items: [
    { Icon: Tags,       label: 'منتجاتي',  key: 'products'  },
    { Icon: Boxes,      label: 'المخزون',  key: 'inventory' },
  ]},
  { key: 'growth',    label: 'النمو',      items: [
    { Icon: Megaphone,  label: 'التسويق',  key: 'marketing' },
  ]},
  { key: 'support',   label: 'الحساب والدعم', items: [
    { Icon: LifeBuoy,   label: 'الدعم',      key: 'requests'    },
    { Icon: HelpCircle, label: 'مركز المساعدة', key: 'help' },
    { Icon: CreditCard, label: 'الاشتراك',   key: 'billing'     },
  ]},
  { key: 'system',    label: 'النظام',    items: [
    { Icon: Link2,         label: 'المنصات',    key: 'integrations' },
    { Icon: SettingsIcon,  label: 'الإعدادات',  key: 'settings'     },
  ]},
]

const NAV_FLAT: NavItem[] = NAV_GROUPS.flatMap(g => g.items)
const NAV_ITEMS = NAV_FLAT  // alias للحفاظ على التوافق

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

  useEffect(() => {
    if (!merchantCode) return
    loadNotifs()
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [merchantCode])

  async function loadNotifs() {
    const { data } = await supabase.from('notifications').select('*')
      .eq('merchant_code', merchantCode).order('created_at', { ascending: false }).limit(20)
    setNotifs(data || [])
  }

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
        <span style={{ fontSize: 16 }}>🔔</span>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -3, right: -3, width: 15, height: 15, borderRadius: '50%', background: '#e84040', color: '#fff', fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 340, maxWidth: 'calc(100vw - 32px)', maxHeight: 420, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', zIndex: 10000, color: 'var(--text)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2c3356', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e6f4' }}>الإشعارات</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ background: 'transparent', border: 'none', color: '#a598ff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>قراءة الكل</button>
            )}
          </div>
          {notifs.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: '#545d82', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔔</div>لا توجد إشعارات
            </div>
          ) : notifs.map(n => (
            <div key={n.id} style={{ padding: '12px 16px', background: n.is_read ? 'transparent' : 'rgba(108,92,231,0.08)', borderBottom: '1px solid #2c3356' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                {!n.is_read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a598ff', flexShrink: 0, marginTop: 5 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e6f4', marginBottom: 3 }}>{n.title}</div>
                  <div style={{ fontSize: 11, color: '#8891b4', lineHeight: 1.5 }}>{n.body}</div>
                  <div style={{ fontSize: 10, color: '#545d82', marginTop: 5 }}>{relTime(n.created_at)}</div>
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
  const [loading, setLoading]               = useState(true)
  const [view, setView]                     = useState<View>(readView)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showUpgrade, setShowUpgrade]       = useState(false)
  const [impersonating, setImpersonating]   = useState<Merchant | null>(null)
  const isMobile                            = useMobile()

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
          setSession(data.session)
          fetchMerchant(data.session.user.email!)
        } else {
          setLoading(false)
        }
      })
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchMerchant(session.user.email!)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchMerchant(session.user.email!)
      else { setMerchant(null); setLoading(false) }
    })
    const onPopState = () => setView(readView())
    window.addEventListener('popstate', onPopState)
    return () => { subscription.unsubscribe(); window.removeEventListener('popstate', onPopState) }
  }, [])

  async function fetchMerchant(email: string) {
    const { data } = await supabase.from('merchants').select('*').eq('email', email).maybeSingle()
    setMerchant(data)
    setLoading(false)
    if (data && !data.onboarding_done && data.role === 'merchant') setShowOnboarding(true)
  }

  function goTo(v: View) {
    setView(v)
    window.history.pushState(null, '', '/' + (v === 'dashboard' ? '' : v))
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, border: '3px solid var(--border2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>جاري التحميل...</p>
      </div>
    </div>
  )

  if (!session) return <Login />
  if ((merchant?.role === 'admin' || merchant?.role === 'super_admin') && !impersonating)
    return <AdminPanel merchant={merchant} onImpersonate={startImpersonate} />
  if (merchant?.role === 'employee') return <EmployeePanel merchant={merchant} />

  const activeMerchant = impersonating || merchant
  const suspended = isSuspended(activeMerchant)
  const plan      = (activeMerchant?.subscription_plan as PlanKey) ?? 'free'
  const upgradeTo = getUpgradePlan(plan)
  const planCfg   = getPlan(activeMerchant)

  // Upgrade modal
  if (showUpgrade && upgradeTo) {
    const upgradeCfg = PLANS[upgradeTo]
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,40,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 28px', maxWidth: 440, width: '100%', textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, color: 'var(--text)' }}>ترقية إلى {upgradeCfg.label}</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 20, lineHeight: 1.7 }}>فتح قنوات إضافية: {upgradeCfg.channels.join(' · ')}</p>
          <div style={{ background: 'var(--surface2)', borderRadius: 12, padding: '16px', marginBottom: 24, textAlign: 'right' }}>
            {upgradeCfg.features.map((f, i) => (
              <div key={i} style={{ fontSize: 13, padding: '5px 0', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--accent2)', fontWeight: 700 }}>✓</span>{f}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', marginBottom: 20 }}>
            {upgradeCfg.price} <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text3)' }}>ر.س / شهر</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowUpgrade(false)} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: 12, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>لاحقاً</button>
            <a href="https://salla.sa/apps" target="_blank" rel="noopener noreferrer"
              style={{ flex: 2, background: 'linear-gradient(135deg,var(--accent),#9f8fff)', border: 'none', color: '#fff', padding: 12, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(108,92,231,0.35)' }}>
              ترقية من متجر سلة →
            </a>
          </div>
        </div>
      </div>
    )
  }

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

      {suspended && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(10,12,28,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', border: '1px solid #fcc', borderRadius: 20, padding: '40px 28px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 0 60px rgba(232,64,64,0.2)' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🚫</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#e84040', marginBottom: 10 }}>تم إيقاف اشتراكك</h2>
            <p style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.8, marginBottom: 28 }}>
              تم إيقاف الوصول إلى بيانات متجرك. لاستئناف المزامنة والخدمات، يرجى تجديد الاشتراك من متجر سلة.
            </p>
            <a href="https://salla.sa/apps" target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', background: 'linear-gradient(135deg,#e84040,#c9184a)', color: '#fff', padding: '14px', borderRadius: 12, fontSize: 14, fontWeight: 800, textDecoration: 'none', boxShadow: '0 4px 20px rgba(232,64,64,0.3)', marginBottom: 10 }}>
              تجديد الاشتراك من سلة
            </a>
            <button onClick={() => supabase.auth.signOut()} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', padding: '10px 20px', borderRadius: 10, fontSize: 12, cursor: 'pointer' }}>
              تسجيل الخروج
            </button>
          </div>
        </div>
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
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e6f4', lineHeight: 1.1 }}>Sellpert</div>
                  <div style={{ fontSize: 10, color: '#a598ff', fontWeight: 600 }}>لوحة التاجر</div>
                </div>
              </div>
              <ThemeToggle />
              <NotificationBell merchantCode={activeMerchant?.merchant_code} />
            </div>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '8px 0 12px', overflowY: 'auto' }}>
            {NAV_GROUPS.map(group => (
              <div key={group.key} style={{ padding: '6px 8px 2px' }}>
                <div style={{ padding: '8px 12px 4px', fontSize: 9, fontWeight: 800, color: '#545d82', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                  {group.label}
                </div>
                {group.items.map(item => {
                  const Icon = item.Icon
                  return (
                    <div key={item.key}
                      className={`nav-item${view === item.key ? ' active' : ''}`}
                      style={S.navItem}
                      onClick={() => goTo(item.key)}
                    >
                      <Icon size={16} style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {view === item.key && <div className="nav-dot" />}
                    </div>
                  )
                })}
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeMerchant.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                    <span style={{ fontSize: 10, color: '#a598ff', fontFamily: 'monospace' }}>{activeMerchant.merchant_code}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: planCfg.color + '25', color: planCfg.color }}>
                      {planCfg.label}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <button style={S.logoutBtn} onClick={impersonating ? stopImpersonate : () => supabase.auth.signOut()}>
              {impersonating ? '← العودة للأدمن' : '🚪 تسجيل الخروج'}
            </button>
          </div>
        </aside>
      )}

      {/* ── Main Content ── */}
      <main style={{ flex: 1, minHeight: '100vh', marginRight: isMobile ? 0 : 220, paddingTop: isMobile ? 52 + (impersonating ? BANNER_H : 0) : (impersonating ? BANNER_H : 0), paddingBottom: isMobile ? 68 : 0, background: 'var(--bg)' }}>
        <SubscriptionBanner merchant={activeMerchant} onUpgrade={() => setShowUpgrade(true)} />
        <Suspense fallback={<PageFallback />}>
          {view === 'dashboard'    && <Dashboard    merchant={activeMerchant} />}
          {view === 'products'     && <Products     merchant={activeMerchant} />}
          {view === 'orders'       && <Orders       merchant={activeMerchant} />}
          {view === 'inventory'    && <Inventory    merchant={activeMerchant} />}
          {view === 'requests'     && <Requests     merchant={activeMerchant} />}
          {view === 'statement'    && <Statement    merchant={activeMerchant} />}
          {view === 'billing'      && <Billing      merchant={activeMerchant} />}
          {view === 'integrations' && <Integrations merchant={activeMerchant} />}
          {view === 'marketing'    && <Marketing    merchant={activeMerchant} />}
          {view === 'notifications'&& <Notifications merchant={activeMerchant} />}
          {view === 'product-detail'  && <ProductDetail  merchant={activeMerchant} />}
          {view === 'product-compare' && <ProductCompare merchant={activeMerchant} />}
          {view === 'help'            && <Help           merchant={activeMerchant} />}
          {view === 'settings'     && <Settings     merchant={activeMerchant} onUpdate={m => { if (!impersonating) setMerchant(m) }} />}
        </Suspense>
      </main>
      <ToastContainer />
      {activeMerchant && <AIChat merchantCode={activeMerchant.merchant_code} />}

      {/* ── Mobile Top Bar ── */}
      {isMobile && (
        <header style={{ ...S.mobileHeader, top: impersonating ? BANNER_H : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={S.logoIconSm}>S</div>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Sellpert</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{activeMerchant?.name}</span>
          </div>
        </header>
      )}

      {/* ── Mobile Bottom Nav ── */}
      {isMobile && (
        <nav style={S.bottomNav}>
          {NAV_ITEMS.slice(0, 5).map(item => {
            const Icon = item.Icon
            return (
              <button key={item.key} onClick={() => goTo(item.key)} style={{ ...S.bottomNavBtn, color: view === item.key ? 'var(--accent)' : 'var(--text3)' }}>
                <Icon size={20} />
                <span style={{ fontSize: 9, marginTop: 1 }}>{item.label}</span>
              </button>
            )
          })}
          <button style={{ ...S.bottomNavBtn, color: 'var(--text3)' }} onClick={() => supabase.auth.signOut()}>
            <LogOut size={20} />
            <span style={{ fontSize: 9, marginTop: 1 }}>خروج</span>
          </button>
        </nav>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  sidebar: {
    display: 'flex', flexDirection: 'column',
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 220, zIndex: 100,
    background: '#1e2239',
    borderLeft: '1px solid #2c3356',
  },
  sidebarTop: {
    padding: '18px 16px',
    borderBottom: '1px solid #2c3356',
    flexShrink: 0,
  },
  logoIcon: {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    background: 'linear-gradient(135deg, #6c5ce7, #00b894)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 800, color: '#fff',
  },
  logoIconSm: {
    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
    background: 'linear-gradient(135deg, #6c5ce7, #00b894)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 800, color: '#fff',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 11,
    padding: '10px 12px', cursor: 'pointer',
    fontSize: 13, fontWeight: 500,
    color: '#8891b4',
  },
  navIcon:      { fontSize: 16, flexShrink: 0, width: 20, textAlign: 'center' as const },
  sidebarBottom: { padding: '14px 16px', borderTop: '1px solid #2c3356', flexShrink: 0 },
  merchantCard:  { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  merchantAvatar: {
    width: 34, height: 34, borderRadius: 9, flexShrink: 0,
    background: 'linear-gradient(135deg, #6c5ce7, #00b894)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, color: '#fff',
  },
  logoutBtn: {
    width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid #2c3356',
    color: '#8891b4', padding: '8px', borderRadius: 9, fontSize: 12, cursor: 'pointer',
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
