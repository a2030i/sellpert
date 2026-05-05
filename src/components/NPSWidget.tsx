import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { X, Star } from 'lucide-react'
import { toastOk, toastErr } from './Toast'

const SHOWN_KEY = 'sellpert_nps_shown_at'
const SHOW_AFTER_DAYS = 14
const RECHECK_AFTER_DAYS = 90

interface Props { merchantCode?: string }

export default function NPSWidget({ merchantCode }: Props) {
  const [show, setShow] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!merchantCode) return
    const shown = localStorage.getItem(SHOWN_KEY)
    if (shown) {
      const days = (Date.now() - parseInt(shown, 10)) / 86400000
      if (days < RECHECK_AFTER_DAYS) return
    }

    // Check account age
    ;(async () => {
      const { data: m } = await supabase.from('merchants').select('created_at').eq('merchant_code', merchantCode).maybeSingle()
      if (!m?.created_at) return
      const ageDays = (Date.now() - new Date(m.created_at).getTime()) / 86400000
      if (ageDays < SHOW_AFTER_DAYS) return

      // Check if already responded recently
      const { data: prev } = await supabase.from('nps_responses').select('created_at')
        .eq('merchant_code', merchantCode).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (prev?.created_at) {
        const respondedDays = (Date.now() - new Date(prev.created_at).getTime()) / 86400000
        if (respondedDays < RECHECK_AFTER_DAYS) return
      }

      setTimeout(() => setShow(true), 8000) // 8s after page load
    })()
  }, [merchantCode])

  function dismiss() {
    localStorage.setItem(SHOWN_KEY, String(Date.now()))
    setShow(false)
  }

  async function submit() {
    if (score === null || !merchantCode) return
    setSubmitting(true)
    const category = score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor'
    const { error } = await supabase.from('nps_responses').insert({
      merchant_code: merchantCode, score, feedback: feedback.trim() || null, category,
    })
    setSubmitting(false)
    if (error) {
      toastErr('تعذر الإرسال: ' + error.message)
    } else {
      setSubmitted(true)
      localStorage.setItem(SHOWN_KEY, String(Date.now()))
      toastOk('شكراً لتقييمك! 🙏')
      setTimeout(() => setShow(false), 2500)
    }
  }

  if (!show) return null

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, zIndex: 9998,
      width: 360, maxWidth: 'calc(100vw - 32px)',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: 16, boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
      animation: 'npsSlide 0.4s ease',
    }}>
      <button onClick={dismiss} style={{
        position: 'absolute', top: 8, left: 8, background: 'transparent',
        border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4,
      }}><X size={16} /></button>

      {submitted ? (
        <div style={{ textAlign: 'center', padding: '20px 8px' }}>
          <div style={{ fontSize: 38, marginBottom: 6 }}>🎉</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>شكراً لتقييمك!</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>ملاحظاتك تساعدنا نتطور</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Star size={18} color="#f0a800" fill="#f0a800" />
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
              كيف تقيّم تجربتك مع Sellpert؟
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
            ما احتمال أن توصي بنا لتاجر آخر؟ (0 = مستحيل، 10 = أكيد)
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: 4, marginBottom: 12 }}>
            {Array.from({ length: 11 }, (_, i) => (
              <button key={i} onClick={() => setScore(i)} style={{
                aspectRatio: '1', border: '1px solid ' + (score === i ? 'var(--accent)' : 'var(--border)'),
                background: score === i ? 'var(--accent)' : 'var(--surface2)',
                color: score === i ? '#fff' : 'var(--text2)',
                borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>{i}</button>
            ))}
          </div>

          {score !== null && (
            <>
              <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3}
                placeholder={score >= 9 ? 'وش الشي اللي يعجبك أكثر؟' : score >= 7 ? 'وش يخلينا أحسن؟' : 'وش المشكلة اللي صادفتك؟'}
                style={{
                  width: '100%', border: '1px solid var(--border)', borderRadius: 9,
                  padding: 10, fontSize: 12, fontFamily: 'inherit', resize: 'none',
                  background: 'var(--surface2)', color: 'var(--text)', marginBottom: 10,
                }} />
              <button onClick={submit} disabled={submitting} style={{
                width: '100%', background: submitting ? 'var(--surface3)' : 'linear-gradient(135deg,#6c5ce7,#9f8fff)',
                border: 'none', color: '#fff', padding: 10, borderRadius: 9,
                fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}>{submitting ? 'جاري الإرسال...' : 'إرسال'}</button>
            </>
          )}
        </>
      )}

      <style>{`@keyframes npsSlide { from { transform: translateY(20px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
    </div>
  )
}
