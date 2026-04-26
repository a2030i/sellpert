import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import { PLATFORM_MAP as PLT_NAMES, PLATFORM_COLORS as PLT_COLORS } from '../../lib/constants'
import type { Merchant } from '../../lib/supabase'

const PLATFORMS_LIST = ['trendyol', 'noon', 'amazon'] as const

export default function AdminProductsView({ merchants }: { merchants: Merchant[] }) {
  const [products, setProducts]   = useState<any[]>([])
  const [prices, setPrices]       = useState<any[]>([])
  const [rates, setRates]         = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [selMerchant, setSelMerchant] = useState('all')
  const [editRate, setEditRate]   = useState<any | null>(null)
  const [rateSaving, setRateSaving] = useState(false)
  const [msg, setMsg]             = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: prods }, { data: prics }, { data: rts }] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('product_platform_prices').select('*'),
      supabase.from('platform_commission_rates').select('*').order('platform'),
    ])
    setProducts(prods || [])
    setPrices(prics || [])
    setRates(rts || [])
    setLoading(false)
  }

  async function saveRate() {
    if (!editRate) return
    setRateSaving(true)
    const { error } = await supabase.from('platform_commission_rates')
      .update({ rate: editRate.rate, vat_rate: editRate.vat_rate, shipping_fee: editRate.shipping_fee, other_fees: editRate.other_fees, notes: editRate.notes, updated_at: new Date().toISOString() })
      .eq('id', editRate.id)
    if (error) setMsg({ type: 'err', text: error.message })
    else { setMsg({ type: 'ok', text: '✅ تم حفظ النسبة' }); setEditRate(null); load() }
    setRateSaving(false)
  }

  async function recalcAllPrices(platform: string) {
    const rate = rates.find(r => r.platform === platform && r.category === 'default')
    if (!rate) return
    const totalFeeRate = (rate.rate + rate.vat_rate) / 100
    const prodsToUpdate = products.filter(p => selMerchant === 'all' || p.merchant_code === selMerchant)
    const updates = prodsToUpdate.map(p => {
      const selling_price = Math.ceil((p.target_net_price + rate.shipping_fee + rate.other_fees) / (1 - totalFeeRate))
      return { product_id: p.id, merchant_code: p.merchant_code, platform, selling_price, commission_rate: rate.rate }
    })
    for (const u of updates) {
      await supabase.from('product_platform_prices').upsert(u, { onConflict: 'product_id,platform' })
    }
    setMsg({ type: 'ok', text: `✅ تم إعادة حساب أسعار ${platform} لـ ${updates.length} منتج` })
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
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)', border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.3)' : 'rgba(255,77,109,0.3)'}` }}>
          {msg.text}
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>نسب العمولات</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {rates.filter(r => r.category === 'default').map(r => (
            <div key={r.id} style={{ background: 'var(--bg)', border: `1px solid ${PLT_COLORS[r.platform] || '#5a5a7a'}33`, borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: PLT_COLORS[r.platform] }}>{PLT_NAMES[r.platform] || r.platform}</div>
                <button style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--accent)', padding: '4px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer' }} onClick={() => setEditRate({ ...r })}>تعديل</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
                <div><span style={{ color: 'var(--text3)' }}>عمولة: </span><strong>{r.rate}%</strong></div>
                <div><span style={{ color: 'var(--text3)' }}>ضريبة: </span><strong>{r.vat_rate}%</strong></div>
                <div><span style={{ color: 'var(--text3)' }}>شحن: </span><strong>{r.shipping_fee} ر.س</strong></div>
                <div><span style={{ color: 'var(--text3)' }}>رسوم أخرى: </span><strong>{r.other_fees} ر.س</strong></div>
              </div>
              <button style={{ marginTop: 10, width: '100%', background: PLT_COLORS[r.platform] + '22', border: `1px solid ${PLT_COLORS[r.platform]}44`, color: PLT_COLORS[r.platform], padding: '6px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }} onClick={() => recalcAllPrices(r.platform)}>
                ⟳ إعادة حساب جميع الأسعار
              </button>
            </div>
          ))}
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
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: prod.status === 'active' ? 'rgba(0,229,176,0.12)' : 'var(--surface2)', color: prod.status === 'active' ? 'var(--accent2)' : 'var(--text3)' }}>
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

      {editRate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '24px 28px', width: '100%', maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20 }}>تعديل نسبة {PLT_NAMES[editRate.platform] || editRate.platform}</div>
            {[
              { label: 'عمولة المنصة %', key: 'rate' },
              { label: 'ضريبة القيمة المضافة %', key: 'vat_rate' },
              { label: 'رسوم الشحن (ر.س)', key: 'shipping_fee' },
              { label: 'رسوم أخرى (ر.س)', key: 'other_fees' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input type="number" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 14, width: '100%', outline: 'none', boxSizing: 'border-box' as const }}
                  value={editRate[f.key]} onChange={e => setEditRate((r: any) => ({ ...r, [f.key]: parseFloat(e.target.value) || 0 }))} />
              </div>
            ))}
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>
              <div style={{ color: 'var(--text3)', marginBottom: 4 }}>معاينة: لو الصافي المستهدف = 200 ر.س</div>
              <div style={{ fontWeight: 800, color: PLT_COLORS[editRate.platform], fontSize: 16 }}>
                سعر البيع = {Math.ceil((200 + (editRate.shipping_fee || 0) + (editRate.other_fees || 0)) / (1 - (editRate.rate + editRate.vat_rate) / 100))} ر.س
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ background: 'var(--accent2)', color: '#111', border: 'none', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={saveRate} disabled={rateSaving}>{rateSaving ? '⟳' : '✓ حفظ'}</button>
              <button style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 10, fontSize: 13, cursor: 'pointer' }} onClick={() => setEditRate(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
