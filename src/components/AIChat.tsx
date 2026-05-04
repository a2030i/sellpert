import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Sparkles, Send, X, MessageSquare } from 'lucide-react'

interface Msg { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'كيف أداء متجري آخر 30 يوم؟',
  'أي منصة تبيع أكثر؟',
  'أي منتج خاسر؟',
  'كيف أحسّن الـ ROAS؟',
  'هل عندي منتجات نفدت؟',
  'وش أهم تحذير عندي اليوم؟',
]

export default function AIChat({ merchantCode }: { merchantCode?: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)

  useEffect(() => { scroll.current?.scrollTo(0, scroll.current.scrollHeight) }, [messages])

  async function send(text?: string) {
    const q = (text ?? input).trim()
    if (!q || loading || !merchantCode) return
    setInput('')
    const newMessages: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages(newMessages)
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: q, merchant_code: merchantCode, history: messages }),
      })
      const data = await res.json()
      if (data.error) {
        setMessages([...newMessages, { role: 'assistant', content: '❌ ' + data.error }])
      } else {
        setMessages([...newMessages, { role: 'assistant', content: data.answer || 'لا إجابة' }])
      }
    } catch (e: any) {
      setMessages([...newMessages, { role: 'assistant', content: '❌ ' + e.message }])
    }
    setLoading(false)
  }

  return (
    <>
      {/* Floating button */}
      <button onClick={() => setOpen(true)} style={{
        position: 'fixed', bottom: 26, left: 26, zIndex: 9000,
        width: 56, height: 56, borderRadius: '50%',
        background: 'linear-gradient(135deg, #7c6bff, #00b894)',
        border: 'none', color: '#fff', cursor: 'pointer',
        boxShadow: '0 6px 24px rgba(124,107,255,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: open ? 'scale(0)' : 'scale(1)', transition: 'transform 0.2s',
      }} title="اسأل AI عن بياناتك">
        <Sparkles size={22} />
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 26, left: 26, zIndex: 9001,
          width: 'min(420px, calc(100vw - 32px))',
          height: 'min(560px, calc(100vh - 100px))',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 12px 50px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 18px', background: 'linear-gradient(135deg, #7c6bff, #00b894)',
            color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={18} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>مساعد Sellpert الذكي</div>
                <div style={{ fontSize: 11, opacity: 0.9 }}>اسألني عن أرقامك وأداء متجرك</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 8, padding: 6, cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>

          <div ref={scroll} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <MessageSquare size={36} color="var(--text3)" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14 }}>مرحباً 👋 — اختر سؤال جاهز أو اكتب سؤالك</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => send(s)} style={{
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      padding: '9px 12px', borderRadius: 9, fontSize: 12, color: 'var(--text2)',
                      cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit',
                    }}>💬 {s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--surface2)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                padding: '10px 14px', borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
              }}>{m.content}</div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '12px 16px', background: 'var(--surface2)', borderRadius: '12px 12px 12px 4px' }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--text3)', animation: `bounce 1.2s ${i * 0.15}s infinite ease-in-out` }} />
                ))}
                <style>{`@keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4 } 40% { transform: scale(1); opacity: 1 } }`}</style>
              </div>
            )}
          </div>

          <div style={{ padding: 12, borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="اكتب سؤالك..." disabled={loading}
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 10, fontSize: 13, outline: 'none', color: 'var(--text)', fontFamily: 'inherit' }} />
              <button onClick={() => send()} disabled={loading || !input.trim()}
                style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 10, padding: '0 14px', cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? 0.5 : 1 }}>
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
