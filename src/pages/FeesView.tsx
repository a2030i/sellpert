import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

type Platform = 'trendyol' | 'noon' | 'amazon'

const PLT_META: Record<Platform, { label: string; color: string; flag: string }> = {
  trendyol: { label: 'تراندايول',  color: '#f27a1a', flag: '🇹🇷' },
  noon:     { label: 'نون',         color: '#f5c518', flag: '🟡' },
  amazon:   { label: 'أمازون',     color: '#ff9900', flag: '📦' },
}

const VAT = 15 // Saudi VAT %

export default function FeesView() {
  const [activePlt, setActivePlt] = useState<Platform>('noon')
  const [categories, setCategories]   = useState<any[]>([])
  const [shipping, setShipping]       = useState<any[]>([])
  const [otherFees, setOtherFees]     = useState<any[]>([])
  const [models, setModels]           = useState<any[]>([])
  const [loading, setLoading]         = useState(true)
  const [editCat, setEditCat]         = useState<any | null>(null)
  const [saving, setSaving]           = useState(false)
  const [msg, setMsg]                 = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Calculator state
  const [calcPrice,    setCalcPrice]    = useState('100')
  const [calcWeight,   setCalcWeight]   = useState('0.5')
  const [calcCategory, setCalcCategory] = useState('')
  const [calcModel,    setCalcModel]    = useState('')
  const [calcAsp,      setCalcAsp]      = useState('') // override ASP if different from price

  useEffect(() => { load() }, [])

  // Set default model & category when platform changes
  useEffect(() => {
    const defModel = models.find(m => m.platform === activePlt && m.is_default)
    if (defModel) setCalcModel(defModel.model_key)
    const firstCat = categories.find(c => c.platform === activePlt)
    if (firstCat) setCalcCategory(firstCat.category_key)
  }, [activePlt, models, categories])

  async function load() {
    setLoading(true)
    const [{ data: cats }, { data: ship }, { data: other }, { data: mdls }] = await Promise.all([
      supabase.from('platform_fee_categories').select('*').order('sort_order,category_ar'),
      supabase.from('platform_shipping_tiers').select('*').order('sort_order'),
      supabase.from('platform_other_fees').select('*').order('platform,fee_type'),
      supabase.from('platform_fulfillment_models').select('*').order('platform,is_default'),
    ])
    setCategories(cats || [])
    setShipping(ship || [])
    setOtherFees(other || [])
    setModels(mdls || [])
    setLoading(false)
  }

  async function saveCat() {
    if (!editCat) return
    setSaving(true)
    const { error } = await supabase.from('platform_fee_categories')
      .update({ commission_rate: editCat.commission_rate, commission_fbn_fba: editCat.commission_fbn_fba, min_fee_sar: editCat.min_fee_sar, notes: editCat.notes, updated_at: new Date().toISOString() })
      .eq('id', editCat.id)
    if (error) setMsg({ type: 'err', text: error.message })
    else { setMsg({ type: 'ok', text: '✅ تم تحديث نسبة العمولة' }); setEditCat(null); load() }
    setSaving(false)
  }

  // ── Fee Calculator ──────────────────────────────────────────────────────────
  const calcResult = useMemo(() => {
    const price      = parseFloat(calcPrice) || 0
    const weight     = parseFloat(calcWeight) || 0
    const asp        = parseFloat(calcAsp) || price
    if (!price || !calcCategory) return null

    const cat = categories.find(c => c.platform === activePlt && c.category_key === calcCategory)
    if (!cat) return null

    const usesFBx   = calcModel === 'FBA' || calcModel === 'FBN'
    const commRate  = usesFBx && cat.commission_fbn_fba != null ? cat.commission_fbn_fba : cat.commission_rate
    const commAmt   = Math.max(price * commRate / 100, cat.min_fee_sar || 0)
    const vatOnComm = commAmt * VAT / 100

    // Shipping fee
    let shippingFee = 0
    const tiers = shipping.filter(t => t.platform === activePlt && t.model_key === calcModel)
      .sort((a, b) => a.sort_order - b.sort_order)

    if (tiers.length > 0) {
      const tier = tiers.find(t => weight >= t.weight_min_kg && (t.weight_max_kg == null || weight <= t.weight_max_kg))
      if (tier) {
        shippingFee = asp < (tier.asp_threshold || 25) ? tier.fee_below_asp : tier.fee_above_asp
        // extra per kg
        if (tier.extra_per_kg && tier.weight_max_kg && weight > tier.weight_min_kg) {
          const extraKg = Math.max(0, weight - tier.weight_min_kg)
          shippingFee += extraKg * tier.extra_per_kg
        }
      }
    } else if (activePlt === 'trendyol') {
      // Trendyol express flat by weight
      shippingFee = weight <= 1 ? 12 : weight <= 5 ? 18 : weight <= 15 ? 28 : 40
    }

    const storageEst = otherFees.find(f => f.platform === activePlt && f.fee_type === 'storage')
    const storageFeeNote = storageEst ? `${storageEst.amount} ${storageEst.unit}` : '—'

    const totalFees  = commAmt + vatOnComm + shippingFee
    const netProfit  = price - totalFees
    const margin     = price > 0 ? (netProfit / price * 100) : 0

    return {
      price, commRate, commAmt: +commAmt.toFixed(2),
      vatOnComm: +vatOnComm.toFixed(2),
      shippingFee: +shippingFee.toFixed(2),
      totalFees: +totalFees.toFixed(2),
      netProfit: +netProfit.toFixed(2),
      margin: +margin.toFixed(1),
      storageFeeNote,
      usesFBx,
    }
  }, [calcPrice, calcWeight, calcCategory, calcModel, calcAsp, activePlt, categories, shipping, otherFees])

  // Reverse calculator: what price to list for a target net
  const [targetNet, setTargetNet] = useState('')
  const reversePrice = useMemo(() => {
    const net = parseFloat(targetNet) || 0
    const weight = parseFloat(calcWeight) || 0
    if (!net || !calcCategory) return null
    const cat = categories.find(c => c.platform === activePlt && c.category_key === calcCategory)
    if (!cat) return null
    const usesFBx  = calcModel === 'FBA' || calcModel === 'FBN'
    const commRate = usesFBx && cat.commission_fbn_fba != null ? cat.commission_fbn_fba : cat.commission_rate
    const totalFeeRate = (commRate + commRate * VAT / 100) / 100
    const tiers = shipping.filter(t => t.platform === activePlt && t.model_key === calcModel)
      .sort((a, b) => a.sort_order - b.sort_order)
    let shippingFee = 0
    if (tiers.length > 0) {
      const tier = tiers.find(t => weight >= t.weight_min_kg && (t.weight_max_kg == null || weight <= t.weight_max_kg))
      if (tier) shippingFee = tier.fee_above_asp // assume >25 SAR product
    } else if (activePlt === 'trendyol') {
      shippingFee = weight <= 1 ? 12 : weight <= 5 ? 18 : weight <= 15 ? 28 : 40
    }
    const listPrice = Math.ceil((net + shippingFee) / (1 - totalFeeRate))
    return { listPrice, shippingFee }
  }, [targetNet, calcWeight, calcCategory, calcModel, activePlt, categories, shipping])

  const pltCats     = categories.filter(c => c.platform === activePlt)
  const pltModels   = models.filter(m => m.platform === activePlt)
  const pltOther    = otherFees.filter(f => f.platform === activePlt)
  const pltShipping = shipping.filter(s => s.platform === activePlt && s.model_key === calcModel)
    .sort((a, b) => a.sort_order - b.sort_order)
  const meta = PLT_META[activePlt]

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>جاري تحميل بيانات الرسوم...</div>

  return (
    <div>
      {msg && (
        <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)', border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.3)' : 'rgba(255,77,109,0.3)'}` }}>
          {msg.text}
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* Platform selector */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        {(Object.keys(PLT_META) as Platform[]).map(p => (
          <button key={p} onClick={() => setActivePlt(p)} style={{
            flex: 1, padding: '14px 10px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
            border: `2px solid ${activePlt === p ? PLT_META[p].color : 'var(--border)'}`,
            background: activePlt === p ? PLT_META[p].color + '18' : 'var(--surface)',
            color: activePlt === p ? PLT_META[p].color : 'var(--text2)',
            fontWeight: 700, fontSize: 14,
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{PLT_META[p].flag}</div>
            {PLT_META[p].label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>

        {/* LEFT: Categories + Shipping + Other fees */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Commission Rates by Category */}
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>نسب العمولات بالتصنيف</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                  {pltCats.length} تصنيف · الضريبة {VAT}% تُضاف على العمولة
                </div>
              </div>
              <span style={{ fontSize: 11, background: meta.color + '20', color: meta.color, padding: '4px 12px', borderRadius: 20, fontWeight: 700 }}>
                {meta.flag} {meta.label}
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['التصنيف', 'العمولة %', activePlt !== 'trendyol' ? 'مع FBA/FBN %' : null, 'الحد الأدنى', ''].filter(Boolean).map(h => (
                      <th key={h!} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pltCats.map(cat => (
                    <tr key={cat.id} style={S.tr}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>{cat.category_ar}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{cat.category_en}</div>
                      </td>
                      <td style={S.td}>
                        <span style={{ fontWeight: 800, color: cat.commission_rate >= 15 ? 'var(--red)' : cat.commission_rate >= 10 ? '#ffd166' : 'var(--accent2)', fontSize: 15 }}>
                          {cat.commission_rate}%
                        </span>
                      </td>
                      {activePlt !== 'trendyol' && (
                        <td style={S.td}>
                          {cat.commission_fbn_fba != null ? (
                            <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 13 }}>{cat.commission_fbn_fba}%</span>
                          ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                      )}
                      <td style={{ ...S.td, color: 'var(--text3)', fontSize: 12 }}>{cat.min_fee_sar} ر.س</td>
                      <td style={S.td}>
                        <button style={S.editBtn} onClick={() => setEditCat({ ...cat })}>تعديل</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Shipping Tiers */}
          <div style={S.card}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>رسوم الشحن والتوصيل</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {pltModels.map(m => (
                  <button key={m.model_key} onClick={() => setCalcModel(m.model_key)} style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${calcModel === m.model_key ? meta.color : 'var(--border)'}`,
                    background: calcModel === m.model_key ? meta.color + '18' : 'var(--surface2)',
                    color: calcModel === m.model_key ? meta.color : 'var(--text2)',
                  }}>
                    {m.model_label}
                    {m.is_default && <span style={{ fontSize: 10, marginRight: 4, opacity: 0.7 }}>افتراضي</span>}
                  </button>
                ))}
              </div>
            </div>
            {pltShipping.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>لا توجد أسعار شحن لهذا النموذج</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['الحجم', 'الوزن', 'سعر < 25 ر.س', 'سعر ≥ 25 ر.س', 'إضافة/كيلو'].map(h => (
                        <th key={h} style={{ ...S.th, fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pltShipping.map(tier => (
                      <tr key={tier.id} style={S.tr}>
                        <td style={S.td}><span style={{ fontWeight: 600 }}>{tier.size_label_ar}</span></td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>
                          {tier.weight_min_kg}–{tier.weight_max_kg ?? '∞'} كجم
                        </td>
                        <td style={{ ...S.td, fontWeight: 700, color: '#ffd166' }}>{tier.fee_below_asp} ر.س</td>
                        <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent2)' }}>{tier.fee_above_asp} ر.س</td>
                        <td style={{ ...S.td, color: 'var(--text3)' }}>
                          {tier.extra_per_kg > 0 ? `+${tier.extra_per_kg} ر.س` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Other fees */}
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>التخزين والرسوم الأخرى</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {pltOther.map(fee => (
                <div key={fee.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{fee.fee_label_ar}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: fee.amount === 0 ? 'var(--accent2)' : '#ffd166' }}>
                    {fee.amount === 0 ? '✓ مجاني' : fee.amount}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{fee.unit}</div>
                  {fee.notes && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, lineHeight: 1.4 }}>{fee.notes}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Calculator */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div style={{ ...S.card, borderTop: `3px solid ${meta.color}` }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>حاسبة الرسوم</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 16 }}>{meta.label} — {VAT}% ضريبة</div>

            {/* Inputs */}
            <div style={S.calcField}>
              <label style={S.calcLabel}>سعر البيع (ر.س)</label>
              <input type="number" style={S.calcInput} value={calcPrice} onChange={e => setCalcPrice(e.target.value)} />
            </div>
            <div style={S.calcField}>
              <label style={S.calcLabel}>وزن المنتج (كجم)</label>
              <input type="number" step="0.1" style={S.calcInput} value={calcWeight} onChange={e => setCalcWeight(e.target.value)} />
            </div>
            <div style={S.calcField}>
              <label style={S.calcLabel}>التصنيف</label>
              <select style={S.calcInput} value={calcCategory} onChange={e => setCalcCategory(e.target.value)}>
                <option value="">— اختر —</option>
                {pltCats.map(c => <option key={c.category_key} value={c.category_key}>{c.category_ar} ({c.commission_rate}%)</option>)}
              </select>
            </div>
            <div style={S.calcField}>
              <label style={S.calcLabel}>نموذج التوصيل</label>
              <select style={S.calcInput} value={calcModel} onChange={e => setCalcModel(e.target.value)}>
                {pltModels.map(m => <option key={m.model_key} value={m.model_key}>{m.model_label}</option>)}
              </select>
            </div>

            {/* Result */}
            {calcResult ? (
              <div style={{ marginTop: 4 }}>
                <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '14px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {[
                      { label: 'سعر البيع', val: calcResult.price.toLocaleString() + ' ر.س', color: 'var(--text)' },
                      { label: `عمولة المنصة (${calcResult.commRate}%)`, val: '−' + calcResult.commAmt.toLocaleString() + ' ر.س', color: '#ffd166' },
                      { label: `ضريبة العمولة (${VAT}%)`, val: '−' + calcResult.vatOnComm.toLocaleString() + ' ر.س', color: '#ffd166' },
                      { label: 'رسوم الشحن', val: calcResult.shippingFee > 0 ? '−' + calcResult.shippingFee.toLocaleString() + ' ر.س' : '—', color: '#ffd166' },
                    ].map((row, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text3)' }}>{row.label}</span>
                        <span style={{ fontWeight: 600, color: row.color }}>{row.val}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>إجمالي الرسوم</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--red)' }}>{calcResult.totalFees.toLocaleString()} ر.س</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Net result prominent */}
                <div style={{ background: calcResult.netProfit >= 0 ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)', border: `1px solid ${calcResult.netProfit >= 0 ? 'rgba(0,229,176,0.3)' : 'rgba(255,77,109,0.3)'}`, borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>الصافي للبائع</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: calcResult.netProfit >= 0 ? 'var(--accent2)' : 'var(--red)' }}>
                    {calcResult.netProfit.toLocaleString()} ر.س
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                    هامش {calcResult.margin}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
                    التخزين: {calcResult.storageFeeNote}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>اختر تصنيف لرؤية النتيجة</div>
            )}

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />

            {/* Reverse calculator */}
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text2)' }}>↩ حساب سعر البيع من الصافي</div>
            <div style={S.calcField}>
              <label style={S.calcLabel}>الصافي المستهدف (ر.س)</label>
              <input type="number" style={S.calcInput} value={targetNet} onChange={e => setTargetNet(e.target.value)} placeholder="مثال: 200" />
            </div>
            {reversePrice && targetNet && (
              <div style={{ background: 'rgba(124,107,255,0.1)', border: '1px solid rgba(124,107,255,0.3)', borderRadius: 12, padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>يجب أن يُباع بـ</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--accent)' }}>
                  {reversePrice.listPrice.toLocaleString()} ر.س
                </div>
                {reversePrice.shippingFee > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                    يشمل شحن {reversePrice.shippingFee} ر.س
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Source note */}
          <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.6 }}>
              📌 البيانات مصدرها المنصات الرسمية (Seller Central / Noon Partners) — محدّثة حتى 2025-2026. قد تتغير النسب، يُنصح بمراجعتها دورياً.
            </div>
          </div>
        </div>
      </div>

      {/* Edit Category Modal */}
      {editCat && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '24px 28px', width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>تعديل عمولة التصنيف</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>{editCat.category_ar} — {PLT_META[editCat.platform as Platform]?.label}</div>
            {[
              { label: 'نسبة العمولة الأساسية %', key: 'commission_rate' },
              { label: 'نسبة FBA/FBN % (اختياري)', key: 'commission_fbn_fba' },
              { label: 'الحد الأدنى (ر.س)', key: 'min_fee_sar' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input type="number" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 14, width: '100%', outline: 'none', boxSizing: 'border-box' as const }}
                  value={editCat[f.key] ?? ''} onChange={e => setEditCat((c: any) => ({ ...c, [f.key]: e.target.value === '' ? null : parseFloat(e.target.value) }))} />
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 4 }}>ملاحظات</label>
              <input style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' as const }}
                value={editCat.notes || ''} onChange={e => setEditCat((c: any) => ({ ...c, notes: e.target.value }))} />
            </div>

            {/* Live preview */}
            {editCat.commission_rate > 0 && (
              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>
                <div style={{ color: 'var(--text3)', marginBottom: 4 }}>معاينة على 100 ر.س:</div>
                <div style={{ fontWeight: 700, color: 'var(--accent)' }}>
                  عمولة = {(100 * editCat.commission_rate / 100).toFixed(2)} ر.س +
                  ضريبة {(100 * editCat.commission_rate / 100 * VAT / 100).toFixed(2)} ر.س =
                  <span style={{ color: 'var(--red)' }}> {(100 * editCat.commission_rate / 100 * (1 + VAT / 100)).toFixed(2)} ر.س</span>
                </div>
                <div style={{ color: 'var(--accent2)', marginTop: 4, fontWeight: 700 }}>
                  الصافي للبائع = {(100 - 100 * editCat.commission_rate / 100 * (1 + VAT / 100)).toFixed(2)} ر.س
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ background: 'var(--accent2)', color: '#111', border: 'none', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={saveCat} disabled={saving}>{saving ? '⟳' : '✓ حفظ'}</button>
              <button style={{ background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 10, fontSize: 13, cursor: 'pointer' }} onClick={() => setEditCat(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  card:    { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 22px' },
  th:      { padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  tr:      { borderBottom: '1px solid var(--border)' },
  td:      { padding: '10px 14px', fontSize: 13, color: 'var(--text)', verticalAlign: 'middle' },
  editBtn: { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--accent)', padding: '4px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  calcField: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 },
  calcLabel: { fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.4px' },
  calcInput: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
}
