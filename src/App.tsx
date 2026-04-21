import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AdminPanel from './pages/AdminPanel'
import type { Session } from '@supabase/supabase-js'
import type { Merchant } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [loading, setLoading] = useState(true)

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
  return <Dashboard merchant={merchant} />
}
