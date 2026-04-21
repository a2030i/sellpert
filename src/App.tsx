import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { useMobile } from './lib/hooks'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AdminPanel from './pages/AdminPanel'
import Integrations from './pages/Integrations'
import Orders from './pages/Orders'
import Inventory from './pages/Inventory'
import type { Session } from '@supabase/supabase-js'
import type { Merchant } from './lib/supabase'

export type View = 'dashboard' | 'integrations' | 'orders' | 'inventory'

const VALID_VIEWS: View[] = ['dashboard', 'integrations', 'orders', 'inventory']

const NAV_ITEMS = [
  { icon: '📊', label: 'الرئيسية',   key: 'dashboard'    as View },
  { icon: '📦', label: 'الطلبات',    key: 'orders'       as View },
  { icon: '🗃️', label: 'المخزون',    key: 'inventory'    as View },
  { icon: '🔗', label: 'المنصات',    key: 'integrations' as View },
]

function readHash(): View {
  const h = window.location.hash.replace('#', '') as View
  return VALID_VIEWS.includes(h) ? h : 'dashboard'
}

export default function App() {
  const [session, setSession]   = useState<Session | null>(null)
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [loading, setLoading]   = useState(true)
  const [view, setView]         = useState<View>(readHash)
  const isMobile                = useMobile()

  useEffect(() => {
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

    const onPopState = () => setView(readHash())
    window.addEventListener('popstate', onPopState)
    return () => { subscription.unsubscribe(); window.removeEventListener('popstate', onPopState) }
  }, [])

  async function fetchMerchant(email: string) {
    const { data } = await supabase.from('merchants').select('*').eq('email', email).single()
    setMerchant(data)
    setLoading(false)
  }

  function goTo(v: View) { setView(v); window.location.hash = v }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: 'var(--text2)', fontSize: 13 }}>جاري التحميل...</p>
      </div>
    </div>
  )

  if (!session) return <Login />
  if (merchant?.role === 'admin' || merchant?.role === 'super_admin') return <AdminPanel merchant={merchant} />

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Desktop Sidebar ── */}
      {!isMobile && (
        <aside style={S.sidebar}>
          <div style={S.sidebarTop}>
            <div style={S.logoRow}>
              <div style={S.logoIcon}>S</div>
              <span style={S.logoName}>Sellpert</span>
            </div>
          </div>

          <nav style={{ flex: 1, padding: '8px 0' }}>
            {NAV_ITEMS.map(item => (
              <div key={item.key}
                style={{ ...S.navItem, ...(view === item.key ? S.navActive : {}) }}
                onClick={() => goTo(item.key)}
              >
                <span style={S.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </nav>

          <div style={S.sidebarBottom}>
            {merchant && (
              <div style={S.merchantCard}>
                <div style={S.merchantAvatar}>{merchant.name?.[0] || 'T'}</div>
                <div>
                  <div style={S.merchantName}>{merchant.name}</div>
                  <div style={S.merchantCode}>{merchant.merchant_code}</div>
                </div>
              </div>
            )}
            <button style={S.logoutBtn} onClick={() => supabase.auth.signOut()}>
              🚪 تسجيل الخروج
            </button>
          </div>
        </aside>
      )}

      {/* ── Main Content ── */}
      <main style={{
        ...S.main,
        marginRight: isMobile ? 0 : 220,
        paddingTop: isMobile ? 52 : 0,
        paddingBottom: isMobile ? 68 : 0,
      }}>
        {view === 'dashboard'    && <Dashboard    merchant={merchant} />}
        {view === 'orders'       && <Orders       merchant={merchant} />}
        {view === 'inventory'    && <Inventory    merchant={merchant} />}
        {view === 'integrations' && <Integrations merchant={merchant} />}
      </main>

      {/* ── Mobile Top Bar ── */}
      {isMobile && (
        <header style={S.mobileHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={S.logoIconSm}>S</div>
            <span style={{ fontSize: 15, fontWeight: 800 }}>Sellpert</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{merchant?.name}</div>
        </header>
      )}

      {/* ── Mobile Bottom Nav ── */}
      {isMobile && (
        <nav style={S.bottomNav}>
          {NAV_ITEMS.map(item => (
            <button key={item.key} onClick={() => goTo(item.key)} style={{
              ...S.bottomNavBtn,
              color: view === item.key ? 'var(--accent)' : 'var(--text3)',
            }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              <span style={{ fontSize: 10, marginTop: 2 }}>{item.label}</span>
            </button>
          ))}
          <button style={{ ...S.bottomNavBtn, color: 'var(--text3)' }}
            onClick={() => supabase.auth.signOut()}>
            <span style={{ fontSize: 22 }}>🚪</span>
            <span style={{ fontSize: 10, marginTop: 2 }}>خروج</span>
          </button>
        </nav>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  sidebar: {
    background: 'var(--surface)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column',
    position: 'fixed', right: 0, top: 0, bottom: 0, width: 220, zIndex: 100,
  },
  sidebarTop:    { padding: '20px 16px', borderBottom: '1px solid var(--border)' },
  logoRow:       { display: 'flex', alignItems: 'center', gap: 10 },
  logoIcon: {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 800, color: '#fff',
  },
  logoIconSm: {
    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
    background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 800, color: '#fff',
  },
  logoName:  { fontSize: 18, fontWeight: 800, color: 'var(--text)' },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '11px 16px', color: 'var(--text2)', cursor: 'pointer',
    transition: 'all 0.2s', fontSize: 13, fontWeight: 500,
  },
  navActive: {
    color: 'var(--accent)', background: 'rgba(124,107,255,0.1)',
    borderRight: '2px solid var(--accent)',
  },
  navIcon:      { fontSize: 17, flexShrink: 0 },
  sidebarBottom: { padding: '16px', borderTop: '1px solid var(--border)' },
  merchantCard:  { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  merchantAvatar: {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 700, color: '#fff',
  },
  merchantName: { fontSize: 13, fontWeight: 600, color: 'var(--text)' },
  merchantCode: { fontSize: 11, color: 'var(--accent)', fontFamily: 'monospace', marginTop: 2 },
  logoutBtn: {
    width: '100%', background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text2)', padding: '8px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
  },
  main:         { flex: 1, minHeight: '100vh' },
  mobileHeader: {
    position: 'fixed', top: 0, left: 0, right: 0, height: 52,
    background: 'var(--surface)', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px', zIndex: 100,
  },
  bottomNav: {
    position: 'fixed', bottom: 0, left: 0, right: 0, height: 60,
    background: 'var(--surface)', borderTop: '1px solid var(--border)',
    display: 'flex', zIndex: 200,
  },
  bottomNavBtn: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 0, border: 'none', background: 'transparent',
    fontFamily: 'inherit', cursor: 'pointer', padding: '4px 0',
  },
}
