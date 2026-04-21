import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AdminPanel from './pages/AdminPanel'
import Integrations from './pages/Integrations'
import Orders from './pages/Orders'
import Inventory from './pages/Inventory'
import type { Session } from '@supabase/supabase-js'
import type { Merchant } from './lib/supabase'

export type View = 'dashboard' | 'integrations' | 'orders' | 'inventory'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('dashboard')

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

    return () => subscription.unsubscribe()
  }, [])

  async function fetchMerchant(email: string) {
    const { data } = await supabase
      .from('merchants')
      .select('*')
      .eq('email', email)
      .single()
    setMerchant(data)
    setLoading(false)
  }

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
      {/* SIDEBAR */}
      <aside style={S.sidebar}>
        <div style={S.sidebarTop}>
          <div style={S.logoRow}>
            <div style={S.logoIcon}>S</div>
            <span style={S.logoName}>Sellpert</span>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '8px 0' }}>
          {[
            { icon: '📊', label: 'لوحة التحكم',  key: 'dashboard'    as View },
            { icon: '📦', label: 'الطلبات',       key: 'orders'       as View },
            { icon: '🗃️', label: 'المخزون',       key: 'inventory'    as View },
            { icon: '🔗', label: 'ربط المنصات',   key: 'integrations' as View },
          ].map(item => (
            <div
              key={item.key}
              style={{ ...S.navItem, ...(view === item.key ? S.navActive : {}) }}
              onClick={() => setView(item.key)}
            >
              <span style={S.navIcon}>{item.icon}</span>
              <span style={S.navLabel}>{item.label}</span>
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

      {/* MAIN CONTENT */}
      <main style={S.main}>
        {view === 'dashboard'    && <Dashboard    merchant={merchant} />}
        {view === 'orders'       && <Orders       merchant={merchant} />}
        {view === 'inventory'    && <Inventory    merchant={merchant} />}
        {view === 'integrations' && <Integrations merchant={merchant} />}
      </main>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  sidebar: {
    background: 'var(--surface)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column',
    position: 'fixed', right: 0, top: 0, bottom: 0,
    width: 220, zIndex: 100,
  },
  sidebarTop: {
    padding: '20px 16px', borderBottom: '1px solid var(--border)',
  },
  logoRow: { display: 'flex', alignItems: 'center', gap: 10 },
  logoIcon: {
    width: 36, height: 36, borderRadius: 10,
    background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0,
  },
  logoName: { fontSize: 18, fontWeight: 800, color: 'var(--text)' },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '11px 16px', color: 'var(--text2)', cursor: 'pointer',
    transition: 'all 0.2s', fontSize: 13, fontWeight: 500,
  },
  navActive: {
    color: 'var(--accent)', background: 'rgba(124,107,255,0.1)',
    borderRight: '2px solid var(--accent)',
  },
  navIcon: { fontSize: 17, flexShrink: 0 },
  navLabel: {},
  sidebarBottom: { padding: '16px', borderTop: '1px solid var(--border)' },
  merchantCard: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  merchantAvatar: {
    width: 36, height: 36, borderRadius: 10,
    background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  merchantName: { fontSize: 13, fontWeight: 600, color: 'var(--text)' },
  merchantCode: { fontSize: 11, color: 'var(--accent)', fontFamily: 'monospace', marginTop: 2 },
  logoutBtn: {
    width: '100%', background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text2)', padding: '8px', borderRadius: 8, fontSize: 12,
    transition: 'all 0.2s', cursor: 'pointer',
  },
  main: {
    flex: 1, marginRight: 220, minHeight: '100vh',
  },
}
