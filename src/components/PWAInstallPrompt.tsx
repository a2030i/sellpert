import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'sellpert_pwa_dismissed_at'
const DISMISS_DAYS = 7

export default function PWAInstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Skip if already installed (running standalone)
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if ((window.navigator as any).standalone) return // iOS

    // Skip if recently dismissed
    const dismissed = localStorage.getItem(DISMISS_KEY)
    if (dismissed) {
      const days = (Date.now() - parseInt(dismissed, 10)) / 86400000
      if (days < DISMISS_DAYS) return
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault()
      setEvt(e as BeforeInstallPromptEvent)
      setTimeout(() => setShow(true), 4000) // delay 4s after page load
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  async function install() {
    if (!evt) return
    await evt.prompt()
    const { outcome } = await evt.userChoice
    if (outcome === 'accepted') {
      setShow(false)
      setEvt(null)
    } else {
      dismiss()
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setShow(false)
  }

  if (!show || !evt) return null

  return (
    <div style={{
      position: 'fixed', bottom: 80, right: 16, left: 16,
      maxWidth: 420, margin: '0 auto', zIndex: 9999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      animation: 'pwaSlide 0.35s ease',
    }}>
      <div style={{ width: 42, height: 42, borderRadius: 10, background: 'linear-gradient(135deg,#6c5ce7,#00b894)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Download size={20} color="#fff" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>ثبت Sellpert</div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>وصول أسرع وعمل بدون إنترنت</div>
      </div>
      <button onClick={install} style={{
        background: 'linear-gradient(135deg,#6c5ce7,#9f8fff)', border: 'none', color: '#fff',
        padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700,
        cursor: 'pointer', fontFamily: 'inherit',
      }}>تثبيت</button>
      <button onClick={dismiss} style={{
        background: 'transparent', border: 'none', color: 'var(--text3)',
        cursor: 'pointer', padding: 4,
      }}><X size={16} /></button>
      <style>{`@keyframes pwaSlide { from { transform: translateY(20px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
    </div>
  )
}
