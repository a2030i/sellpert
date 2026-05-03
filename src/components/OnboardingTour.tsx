import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CheckCircle2, Circle, X } from 'lucide-react'

const STEPS = [
  { key: 'has_products',   label: 'إضافة المنتجات',     desc: 'أضف منتجاتك الأولى — ستراها في "منتجاتي"', path: '/products' },
  { key: 'has_costs',      label: 'تحديد سعر التكلفة',  desc: 'أدخل تكلفة المنتجات لحساب الربحية', path: '/products' },
  { key: 'has_inventory',  label: 'تسجيل المخزون',      desc: 'سجّل كميات المخزون للحصول على تنبيهات النفاد', path: '/inventory' },
  { key: 'has_orders',     label: 'استقبال الطلبات',    desc: 'تظهر تلقائياً عند رفع تقارير المنصات أو ربط سلة', path: '/orders' },
  { key: 'has_ad_metrics', label: 'تتبّع الإعلانات',    desc: 'ارفع تقارير الإعلانات لتحليل ROAS', path: '/marketing' },
  { key: 'has_salla',      label: 'ربط سلة',            desc: 'ربط متجرك على سلة لمزامنة تلقائية', path: '/integrations' },
  { key: 'has_ai_insight', label: 'تحليل AI الأول',      desc: 'احصل على تحليل ذكي لمتجرك من Dashboard', path: '/dashboard' },
]

export default function OnboardingTour({ merchantCode }: { merchantCode?: string }) {
  const [activation, setActivation] = useState<Record<string, boolean>>({})
  const [closed, setClosed] = useState(localStorage.getItem('sellpert-onb-closed') === 'true')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!merchantCode) return
    supabase.rpc('merchant_activation', { p_merchant_code: merchantCode })
      .then(({ data }) => { setActivation(data || {}); setLoading(false) })
  }, [merchantCode])

  if (loading || closed) return null
  const completed = STEPS.filter(s => activation[s.key]).length
  const total = STEPS.length
  if (completed >= total - 1) return null  // نخفي لو شبه مكتمل
  const pct = Math.round((completed / total) * 100)

  function go(path: string) {
    window.history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  function close() {
    setClosed(true)
    localStorage.setItem('sellpert-onb-closed', 'true')
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(124,107,255,0.06), rgba(0,184,148,0.04))',
      border: '1px solid rgba(124,107,255,0.2)',
      borderRadius: 14, padding: 18, marginBottom: 18, position: 'relative',
    }}>
      <button onClick={close} style={{ position: 'absolute', top: 10, left: 10, background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4 }}>
        <X size={14} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>👋 ابدأ مع Sellpert — {pct}% مكتمل</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{completed} من {total} خطوات</div>
        </div>
        <div style={{ flex: 1, maxWidth: 220, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #7c6bff, #00b894)', borderRadius: 4, transition: 'width 0.6s' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 12 }}>
        {STEPS.map(s => {
          const done = !!activation[s.key]
          return (
            <div key={s.key} onClick={() => !done && go(s.path)} style={{
              background: done ? 'rgba(0,184,148,0.06)' : 'var(--surface2)',
              border: `1px solid ${done ? 'rgba(0,184,148,0.2)' : 'var(--border)'}`,
              borderRadius: 9, padding: '10px 12px',
              display: 'flex', alignItems: 'flex-start', gap: 10,
              cursor: done ? 'default' : 'pointer',
              opacity: done ? 0.7 : 1,
            }}>
              {done ? <CheckCircle2 size={16} color="#00b894" style={{ flexShrink: 0, marginTop: 2 }} /> : <Circle size={16} color="var(--text3)" style={{ flexShrink: 0, marginTop: 2 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: done ? 'var(--text2)' : 'var(--text)', textDecoration: done ? 'line-through' : 'none' }}>{s.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{s.desc}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
