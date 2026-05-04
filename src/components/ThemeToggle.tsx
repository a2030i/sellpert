import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export function applyStoredTheme() {
  const t = localStorage.getItem('sellpert-theme') || 'light'
  document.documentElement.setAttribute('data-theme', t)
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('sellpert-theme') as any) || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('sellpert-theme', theme)
  }, [theme])

  return (
    <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
      title={theme === 'light' ? 'الوضع المظلم' : 'الوضع الفاتح'}
      style={{
        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 9, cursor: 'pointer', padding: '6px 8px', color: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  )
}
