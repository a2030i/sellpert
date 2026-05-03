import { useEffect, useState, useCallback } from 'react'

interface ToastMsg { id: number; type: 'ok' | 'err' | 'info'; text: string }

let nextId = 1
const subs = new Set<(t: ToastMsg) => void>()

export function toast(type: ToastMsg['type'], text: string) {
  const t: ToastMsg = { id: nextId++, type, text }
  for (const fn of subs) fn(t)
}

export const toastOk  = (s: string) => toast('ok', s)
export const toastErr = (s: string) => toast('err', s)
export const toastInfo= (s: string) => toast('info', s)

export function ToastContainer() {
  const [items, setItems] = useState<ToastMsg[]>([])
  const dismiss = useCallback((id: number) => setItems(p => p.filter(t => t.id !== id)), [])
  useEffect(() => {
    const fn = (t: ToastMsg) => {
      setItems(p => [...p, t])
      setTimeout(() => dismiss(t.id), t.type === 'err' ? 6000 : 3500)
    }
    subs.add(fn)
    return () => { subs.delete(fn) }
  }, [dismiss])

  return (
    <div style={{ position: 'fixed', top: 70, left: 16, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      {items.map(t => {
        const c = t.type === 'ok' ? '#00b894' : t.type === 'err' ? '#e84040' : '#7c6bff'
        return (
          <div key={t.id} onClick={() => dismiss(t.id)} style={{
            background: 'var(--surface)', border: `1px solid ${c}40`, borderRight: `3px solid ${c}`,
            color: 'var(--text)', padding: '12px 16px', borderRadius: 10,
            boxShadow: '0 4px 18px rgba(0,0,0,0.15)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
            animation: 'toastIn 0.25s ease',
          }}>
            <span style={{ fontSize: 18 }}>{t.type === 'ok' ? '✅' : t.type === 'err' ? '⚠️' : 'ℹ️'}</span>
            <span>{t.text}</span>
          </div>
        )
      })}
      <style>{`@keyframes toastIn { from { transform: translateX(-20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
    </div>
  )
}
