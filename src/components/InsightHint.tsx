// AI-style inline hint component — للظهور في أعلى الصفحات بشكل lightweight
import { useState, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'

export interface Hint { type?: 'info' | 'warn' | 'good'; title: string; body?: string; action?: { label: string; onClick: () => void } }

export function InsightHint({ hints }: { hints: Hint[] }) {
  const [idx, setIdx] = useState(0)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  if (hints.length === 0) return null
  const visible = hints.filter((_, i) => !dismissed.has(i))
  if (visible.length === 0) return null
  const h = visible[idx % visible.length]
  const colors = h.type === 'warn' ? '#ff9900' : h.type === 'good' ? '#00b894' : '#7c6bff'

  return (
    <div style={{
      background: `linear-gradient(90deg, ${colors}10, var(--surface) 60%)`,
      border: `1px solid ${colors}30`, borderRight: `3px solid ${colors}`,
      borderRadius: 12, padding: '12px 16px', marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <Sparkles size={18} color={colors} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{h.title}</div>
        {h.body && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{h.body}</div>}
      </div>
      {h.action && <button onClick={h.action.onClick} style={{ background: colors, border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{h.action.label}</button>}
      {visible.length > 1 && (
        <button onClick={() => setIdx(i => i + 1)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', borderRadius: 6, padding: '4px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>التالي ({(idx % visible.length) + 1}/{visible.length})</button>
      )}
      <button onClick={() => setDismissed(p => new Set([...p, idx % visible.length]))} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4 }}>
        <X size={14} />
      </button>
    </div>
  )
}

// مولّد تلميحات تلقائي من البيانات
export function useGeneratedHints(merchantCode?: string): Hint[] {
  const [hints, setHints] = useState<Hint[]>([])
  useEffect(() => {
    if (!merchantCode) return
    let cancelled = false
    ;(async () => {
      const { data: scoreData } = await import('../lib/supabase').then(m => m.supabase.rpc('merchant_health_score', { p_merchant_code: merchantCode }))
      const score = scoreData?.score
      const breakdown = scoreData?.breakdown || {}
      const out: Hint[] = []
      if (score !== undefined) {
        if (score < 50) out.push({ type: 'warn', title: `📊 صحة متجرك: ${score}/100`, body: 'فيه مجال للتحسين — راجع التفاصيل في الإعدادات' })
        else if (score >= 80) out.push({ type: 'good', title: `🌟 صحة ممتازة: ${score}/100`, body: 'استمر! متجرك يعمل بكفاءة عالية' })
      }
      if (breakdown.returns_rate_pct > 15) out.push({ type: 'warn', title: '⚠️ نسبة المرتجعات مرتفعة', body: `${breakdown.returns_rate_pct}% — راجع جودة المنتجات والوصف` })
      if (breakdown.roas !== undefined && breakdown.roas < 1.5 && breakdown.roas > 0) out.push({ type: 'warn', title: '📉 ROAS منخفض', body: `${breakdown.roas}x — كل ريال إعلان يجيب ${breakdown.roas} ريال فقط` })
      if (breakdown.stockout_pct > 10) out.push({ type: 'warn', title: '📦 نفاد متكرر في المخزون', body: `${breakdown.stockout_pct}% من المنتجات نفد — تخسر مبيعات` })
      if (breakdown.revenue_growth_pct < -10) out.push({ type: 'warn', title: '⬇️ تراجع في الإيرادات', body: `${breakdown.revenue_growth_pct}% مقارنة بالفترة السابقة` })
      if (breakdown.revenue_growth_pct > 15) out.push({ type: 'good', title: '📈 نمو ممتاز', body: `+${breakdown.revenue_growth_pct}% نمو في الإيرادات` })
      if (!cancelled) setHints(out.slice(0, 4))
    })()
    return () => { cancelled = true }
  }, [merchantCode])
  return hints
}
