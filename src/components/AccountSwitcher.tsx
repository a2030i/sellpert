import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { ChevronDown, Building2, Check } from 'lucide-react'

export default function AccountSwitcher({ currentCode, onSwitch }: { currentCode?: string; onSwitch: (code: string) => void }) {
  const [accounts, setAccounts] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.rpc('my_linked_merchants').then(({ data }) => {
      setAccounts(data || [])
    })
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // إخفي لو ما فيه أكثر من حساب
  if (accounts.length <= 1) return null

  const current = accounts.find(a => a.merchant_code === currentCode) || accounts[0]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
        color: 'inherit', padding: '7px 12px', borderRadius: 9, cursor: 'pointer',
        fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'inherit',
      }}>
        <Building2 size={14} />
        <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.name || 'حساب'}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          width: 240, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          overflow: 'hidden', zIndex: 1000,
        }}>
          <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 800, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>
            متاجرك ({accounts.length})
          </div>
          {accounts.map(a => (
            <div key={a.merchant_code} onClick={() => { onSwitch(a.merchant_code); setOpen(false) }} style={{
              padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              background: a.merchant_code === currentCode ? 'rgba(124,107,255,0.06)' : 'transparent',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{a.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace', marginTop: 2 }}>{a.merchant_code}</div>
              </div>
              {a.merchant_code === currentCode && <Check size={14} color="var(--accent)" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
