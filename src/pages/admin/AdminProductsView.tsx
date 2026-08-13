import { useState, useEffect } from 'react'
import { PRODUCT_SAFE_COLUMNS, supabase } from '../../lib/supabase'
import { PLATFORM_MAP as PLT_NAMES, PLATFORM_COLORS as PLT_COLORS } from '../../lib/constants'
import type { Merchant } from '../../lib/supabase'
import { categoryCommission } from '../../lib/commission'

const PLATFORMS_LIST = ['trendyol', 'noon', 'amazon'] as const

export default function AdminProductsView({ merchants }: { merchants: Merchant[] }) {
  const [products, setProducts]   = useState<any[]>([])
  const [prices, setPrices]       = useState<any[]>([])
  const [rates, setRates]         = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [selMerchant, setSelMerchant] = useState('all')
  const [msg, setMsg]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: prods }, { data: prics }, { data: rts }] = await Promise.all([
      supabase.from('products').select(PRODUCT_SAFE_COLUMNS).order('created_at', { ascending: false }),
      supabase.from('product_platform_prices').select('*'),
      supabase.from('platform_fee_categories').select('platform,category_key,category_ar,commission_rate,commission_fbn_fba,min_fee_sar').order('platform,sort_order'),
    ])
    setProducts(prods || [])
    setPrices(prics || [])
    setRates(rts || [])
    setLoading(false)
  }

  async function recalcAllPrices(platform: string) {
    const prodsToUpdate = products.filter(p => selMerchant === 'all' || p.merchant_code === selMerchant)
    const updates = prodsToUpdate.flatMap(p => {
      const exactRate = platform === 'trendyol' && Number(p.commission_rate || 0) > 0 ? Number(p.commission_rate) : null
      const categoryRate = exactRate == null ? categoryCommission(rates, platform, p.category) : null
      const commissionRate = exactRate ?? categoryRate?.rate
      if (!commissionRate) return []
      const totalFeeRate = commissionRate / 100 * 1.15
      const selling_price = Math.ceil(Number(p.target_net_price || 0) / (1 - totalFeeRate))
      return [{ product_id:p.id, merchant_code:p.merchant_code, platform, selling_price, commission_rate:commissionRate, category_key:categoryRate?.categoryKey || null, commission_source:exactRate != null ? 'platform_api' : 'category' }]
    })
    if (!updates.length) { setMsg({ type:'err', text:'لا توجد منتجات بتصنيف معروف لإعادة الحساب.' }); return }
    // upsert واحد دفعة واحدة بدل طلب لكل منتج
    const { error: upsertErr } = await supabase.from('product_platform_prices')
      .upsert(updates, { onConflict: 'product_id,platform' })
    if (upsertErr) { setMsg({ type: 'err', text: upsertErr.message }); return }
    setMsg({ type: 'ok', text: `تم إعادة حساب أسعار ${platform} لـ ${updates.length} منتج` })
    load()
  }

  const filtered = selMerchant === 'all' ? products : products.filter(p => p.merchant_code === selMerchant)
  const getMName = (code: string) => merchants.find(m => m.merchant_code === code)?.name || code

  function getPriceForProduct(productId: string, platform: string) {
    const p = prices.find(pr => pr.product_id === productId && pr.platform === platform)
    return p ? (p.override_price ?? p.selling_price) : null
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>جاري التحميل...</div>

  return (
    <div>
      {msg && (
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', background: msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)', border: `1px solid ${msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)'}` }}>
          {msg.text}
          <button aria-label="إغلاق الرسالة" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setMsg(null)}>إغلاق</button>
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>نسب العمولات حسب التصنيف</div>
        <div style={{ fontSize:11, color:'var(--text3)', marginBottom:16 }}>تُستخدم عمولة المنتج الواردة من المنصة أولًا، ثم نسبة تصنيفه. لا توجد نسبة موحدة لكل المنصة.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {PLATFORMS_LIST.map(platform => {
            const platformRates = rates.filter(rate => rate.platform === platform)
            const values = platformRates.map(rate => Number(rate.commission_rate || 0)).filter(Boolean)
            return <div key={platform} style={{ background: 'var(--bg)', border: `1px solid ${PLT_COLORS[platform] || '#5a5a7a'}33`, borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: PLT_COLORS[platform] }}>{PLT_NAMES[platform] || platform}</div>
                <span style={{fontSize:10,color:'var(--text3)'}}>{platformRates.length} تصنيف</span>
              </div>
              <div style={{fontSize:12}}><span style={{color:'var(--text3)'}}>النطاق: </span><strong>{values.length ? `${Math.min(...values)}% – ${Math.max(...values)}%` : '—'}</strong></div>
              <button style={{ marginTop: 10, width: '100%', background: PLT_COLORS[platform] + '22', border: `1px solid ${PLT_COLORS[platform]}44`, color: PLT_COLORS[platform], padding: '6px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }} onClick={() => recalcAllPrices(platform)}>
                ⟳ إعادة الحساب حسب تصنيف كل منتج
              </button>
            </div>
          })}
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>منتجات التجار ({filtered.length})</div>
          <select style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 12px', borderRadius: 8, fontSize: 12, outline: 'none' }} value={selMerchant} onChange={e => setSelMerchant(e.target.value)}>
            <option value="all">كل التجار</option>
            {merchants.map(m => <option key={m.merchant_code} value={m.merchant_code}>{m.name}</option>)}
          </select>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد منتجات</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['التاجر', 'المنتج', 'SKU', 'التكلفة', 'الصافي المستهدف', 'تراندايول', 'نون', 'أمازون', 'الحالة'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map(prod => (
                  <tr key={prod.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text3)' }}>{getMName(prod.merchant_code)}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{prod.name}</td>
                    <td style={{ padding: '10px 14px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>{prod.sku || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12 }}>{prod.cost_price > 0 ? prod.cost_price + ' ر.س' : '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{prod.target_net_price} ر.س</td>
                    {PLATFORMS_LIST.map(p => {
                      const pr = getPriceForProduct(prod.id, p)
                      return <td key={p} style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: PLT_COLORS[p] }}>{pr ? pr.toLocaleString() + ' ر.س' : <span style={{ color: 'var(--text3)', fontWeight: 400 }}>—</span>}</td>
                    })}
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: prod.status === 'active' ? 'var(--success-bg)' : 'var(--surface2)', color: prod.status === 'active' ? 'var(--accent2)' : 'var(--text3)' }}>
                        {prod.status === 'active' ? 'نشط' : prod.status === 'out_of_stock' ? 'نفد' : 'موقوف'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
