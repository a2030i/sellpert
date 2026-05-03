import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { Bell, Check, AlertTriangle, Info, AlertCircle } from 'lucide-react'

interface Notif {
  id: string
  type: string
  title: string
  body: string | null
  is_read: boolean
  action_path: string | null
  created_at: string
}

const TYPE_META: Record<string, { color: string; bg: string; Icon: any }> = {
  warning: { color: '#ff9900', bg: 'rgba(255,153,0,0.08)', Icon: AlertTriangle },
  error:   { color: '#e84040', bg: 'rgba(232,64,64,0.08)', Icon: AlertCircle },
  info:    { color: '#7c6bff', bg: 'rgba(124,107,255,0.08)', Icon: Info },
  success: { color: '#00b894', bg: 'rgba(0,184,148,0.08)', Icon: Check },
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'الآن'
  if (m < 60) return `قبل ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24) return `قبل ${h} ساعة`
  return `قبل ${Math.floor(h / 24)} يوم`
}

export default function Notifications({ merchant }: { merchant: Merchant | null }) {
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread' | 'warning'>('all')

  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])

  async function load() {
    if (!merchant) return
    setLoading(true)
    const { data } = await supabase.from('notifications').select('*').eq('merchant_code', merchant.merchant_code)
      .order('created_at', { ascending: false }).limit(200)
    setNotifs((data as Notif[]) || [])
    setLoading(false)
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifs(p => p.map(n => n.id === id ? { ...n, is_read: true } : n))
  }
  async function markAllRead() {
    if (!merchant) return
    await supabase.from('notifications').update({ is_read: true }).eq('merchant_code', merchant.merchant_code).eq('is_read', false)
    setNotifs(p => p.map(n => ({ ...n, is_read: true })))
  }
  async function generateNew() {
    if (!merchant) return
    setLoading(true)
    await supabase.rpc('generate_proactive_alerts', { p_merchant_code: merchant.merchant_code })
    await load()
  }

  const filtered = notifs.filter(n =>
    filter === 'all' ? true :
    filter === 'unread' ? !n.is_read :
    n.type === 'warning' || n.type === 'error'
  )
  const unread = notifs.filter(n => !n.is_read).length

  return (
    <div style={{ padding: '28px 32px', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>🔔 التنبيهات</h2>
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>{unread > 0 ? `${unread} تنبيه غير مقروء` : 'كل شيء مقروء'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={generateNew} style={btn('var(--accent)')}>🔄 فحص الآن</button>
          {unread > 0 && <button onClick={markAllRead} style={btn('var(--surface2)', 'var(--text2)')}>✓ تعليم الكل كمقروء</button>}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {[
          { k: 'all', label: 'الكل', count: notifs.length },
          { k: 'unread', label: 'غير مقروء', count: unread },
          { k: 'warning', label: 'تحذيرات', count: notifs.filter(n => n.type === 'warning' || n.type === 'error').length },
        ].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k as any)} style={{
            padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
            background: filter === f.k ? 'var(--accent)' : 'var(--surface2)',
            color: filter === f.k ? '#fff' : 'var(--text2)',
          }}>{f.label} ({f.count})</button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>جارٍ التحميل…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Bell size={48} color="var(--text3)" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>لا توجد تنبيهات</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(n => {
            const meta = TYPE_META[n.type] || TYPE_META.info
            return (
              <div key={n.id} style={{
                background: n.is_read ? 'var(--surface)' : meta.bg,
                border: `1px solid ${n.is_read ? 'var(--border)' : meta.color + '40'}`,
                borderRadius: 12, padding: '14px 16px',
                display: 'flex', gap: 12,
                cursor: n.action_path ? 'pointer' : 'default',
              }}
                onClick={() => {
                  if (!n.is_read) markRead(n.id)
                  if (n.action_path) {
                    window.history.pushState(null, '', n.action_path)
                    window.dispatchEvent(new PopStateEvent('popstate'))
                  }
                }}>
                <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: meta.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <meta.Icon size={18} color={meta.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{n.title}</div>
                    {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />}
                  </div>
                  {n.body && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>{n.body}</div>}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{timeAgo(n.created_at)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function btn(bg: string, color: string = '#fff'): React.CSSProperties {
  return { background: bg, border: '1px solid var(--border)', color, padding: '8px 16px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
}
