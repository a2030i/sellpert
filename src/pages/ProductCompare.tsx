import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { fmtCurrency, fmtNumber, fmtPercent } from '../lib/formatters'
import { ChevronLeft, X } from 'lucide-react'

export default function ProductCompare({ merchant }: { merchant: Merchant | null }) {
  const params = new URLSearchParams(window.location.search)
  const ids = params.get('ids')?.split(',').filter(Boolean) || []
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!merchant || ids.length === 0) { setLoading(false); return }
    Promise.all([
      supabase.from('products').select('*').in('id', ids).eq('merchant_code', merchant.merchant_code),
      supabase.from('product_profitability').select('*').in('product_id', ids).eq('merchant_code', merchant.merchant_code),
    ]).then(([p, prof]) => {
      const profMap = new Map((prof.data || []).map((r: any) => [r.product_id, r]))
      setProducts((p.data || []).map((prod: any) => ({ ...prod, ...(profMap.get(prod.id) || {}) })))
      setLoading(false)
    })
  }, [merchant?.merchant_code, ids.join(',')])

  function back() {
    window.history.pushState(null, '', '/products')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}>جاري التحميل...</div>
  if (products.length === 0) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>لم يتم اختيار منتجات للمقارنة</div>
      <button onClick={back} style={btnPrimary}>العودة للمنتجات</button>
    </div>
  )

  const metrics = [
    { key: 'cost_price', label: 'سعر التكلفة', format: fmtCurrency, lower: true },
    { key: 'target_net_price', label: 'سعر البيع المستهدف', format: fmtCurrency, lower: false },
    { key: 'units_sold', label: 'الوحدات المباعة', format: fmtNumber, lower: false },
    { key: 'revenue', label: 'الإيرادات', format: fmtCurrency, lower: false },
    { key: 'platform_fees', label: 'رسوم المنصة', format: fmtCurrency, lower: true },
    { key: 'ad_spend', label: 'الإنفاق الإعلاني', format: fmtCurrency, lower: true },
    { key: 'returns_count', label: 'المرتجعات', format: fmtNumber, lower: true },
    { key: 'net_profit', label: 'صافي الربح', format: fmtCurrency, lower: false },
    { key: 'profit_margin_pct', label: 'هامش الربح', format: (v: any) => v != null ? fmtPercent(v) : '—', lower: false },
    { key: 'roas', label: 'ROAS', format: (v: any) => v != null ? Number(v).toFixed(2) + 'x' : '—', lower: false },
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <button onClick={back} style={{ background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
        <ChevronLeft size={16} /> العودة للمنتجات
      </button>

      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 18 }}>⚖️ مقارنة المنتجات ({products.length})</h2>

      <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              <th style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text3)', textAlign: 'right', minWidth: 140 }}>المؤشر</th>
              {products.map((p, i) => (
                <th key={i} style={{ padding: '12px 14px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace', marginTop: 2 }}>{p.sku || '—'}</div>
                    </div>
                    {products.length > 1 && (
                      <button onClick={() => {
                        const newIds = ids.filter(id => id !== p.id).join(',')
                        window.history.pushState(null, '', `/product-compare?ids=${newIds}`)
                        window.dispatchEvent(new PopStateEvent('popstate'))
                      }} style={{ background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 2 }}>
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m, mi) => {
              const vals = products.map(p => Number(p[m.key])).filter(v => !isNaN(v))
              const best  = vals.length === 0 ? null : (m.lower ? Math.min(...vals) : Math.max(...vals))
              const worst = vals.length === 0 ? null : (m.lower ? Math.max(...vals) : Math.min(...vals))
              return (
                <tr key={mi} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{m.label}</td>
                  {products.map((p, i) => {
                    const v = p[m.key]
                    const isBest  = best !== null && Number(v) === best
                    const isWorst = worst !== null && Number(v) === worst && best !== worst
                    const bg = isBest ? 'rgba(0,184,148,0.08)' : isWorst ? 'rgba(232,64,64,0.06)' : 'transparent'
                    return (
                      <td key={i} style={{ padding: '12px 14px', fontSize: 13, fontWeight: isBest || isWorst ? 800 : 600, color: isBest ? '#00b894' : isWorst ? '#e84040' : 'var(--text)', background: bg }}>
                        {m.format(v)}
                        {isBest && products.length > 1 && <span style={{ fontSize: 9, marginRight: 6, color: '#00b894' }}> ★</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const btnPrimary: React.CSSProperties = { background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
