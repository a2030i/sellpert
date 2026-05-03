import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import type { Merchant, Product, ProductPlatformPrice, CommissionRate, MerchantRequest } from '../lib/supabase'
import { PLATFORM_MAP as PLATFORM_NAMES, PLATFORM_COLORS } from '../lib/constants'

const PLATFORMS = ['trendyol', 'noon', 'amazon'] as const

function calcSellingPrice(netTarget: number, rate: CommissionRate): number {
  if (!netTarget || netTarget <= 0) return 0
  const totalFeeRate = (rate.rate + rate.vat_rate) / 100
  return Math.ceil((netTarget + rate.shipping_fee + rate.other_fees) / (1 - totalFeeRate))
}

export default function Products({ merchant }: { merchant: Merchant | null }) {
  const [products, setProducts]         = useState<Product[]>([])
  const [prices, setPrices]             = useState<ProductPlatformPrice[]>([])
  const [rates, setRates]               = useState<CommissionRate[]>([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [showAdd, setShowAdd]           = useState(false)
  const [showRequest, setShowRequest]   = useState<Product | null>(null)
  const [editProduct, setEditProduct]   = useState<Product | null>(null)
  const [editForm, setEditForm]         = useState({ cost_price: '', target_net_price: '' })
  const [editSaving, setEditSaving]     = useState(false)
  const [msg, setMsg]                   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const isMobile = useMobile()

  // Add form state
  const [form, setForm] = useState({ name: '', sku: '', category: '', cost_price: '', target_net_price: '' })
  const [saving, setSaving] = useState(false)

  // Request form state
  const [reqType, setReqType]   = useState<MerchantRequest['type']>('price_change')
  const [reqNote, setReqNote]   = useState('')
  const [reqNewPrice, setReqNewPrice] = useState('')
  const [reqSending, setReqSending]   = useState(false)

  useEffect(() => { if (merchant) loadData() }, [merchant])

  async function loadData() {
    setLoading(true)
    const [{ data: prods }, { data: prics }, { data: rts }] = await Promise.all([
      supabase.from('products').select('*').eq('merchant_code', merchant!.merchant_code).order('created_at', { ascending: false }),
      supabase.from('product_platform_prices').select('*').eq('merchant_code', merchant!.merchant_code),
      supabase.from('platform_commission_rates').select('*'),
    ])
    setProducts(prods || [])
    setPrices(prics || [])
    setRates(rts || [])
    setLoading(false)
  }

  function getRate(platform: string, category?: string): CommissionRate | undefined {
    if (category) {
      const specific = rates.find(r => r.platform === platform && r.category.toLowerCase() === category.toLowerCase())
      if (specific) return specific
    }
    return rates.find(r => r.platform === platform && r.category === 'default')
  }

  function getPrices(productId: string): Record<string, number> {
    const result: Record<string, number> = {}
    const prod = products.find(pr => pr.id === productId)
    for (const p of PLATFORMS) {
      const existing = prices.find(pr => pr.product_id === productId && pr.platform === p)
      if (existing) {
        result[p] = existing.override_price ?? existing.selling_price
      } else {
        const rate = getRate(p, prod?.category)
        if (prod && rate) result[p] = calcSellingPrice(prod.target_net_price, rate)
      }
    }
    return result
  }

  async function addProduct() {
    if (!form.name.trim() || !form.target_net_price) { setMsg({ type: 'err', text: 'الاسم والسعر المستهدف مطلوبان' }); return }
    setSaving(true); setMsg(null)
    const { data: prod, error } = await supabase.from('products').insert({
      merchant_code: merchant!.merchant_code,
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category: form.category.trim() || null,
      cost_price: parseFloat(form.cost_price) || 0,
      target_net_price: parseFloat(form.target_net_price),
    }).select().maybeSingle()
    if (error) { setMsg({ type: 'err', text: error.message }); setSaving(false); return }

    // Auto-calculate and insert prices for each platform
    const priceInserts = PLATFORMS.map(p => {
      const rate = getRate(p)
      if (!rate) return null
      return {
        product_id: prod.id,
        merchant_code: merchant!.merchant_code,
        platform: p,
        selling_price: calcSellingPrice(parseFloat(form.target_net_price), rate),
        commission_rate: rate.rate,
      }
    }).filter(Boolean)
    if (priceInserts.length) await supabase.from('product_platform_prices').insert(priceInserts)

    setMsg({ type: 'ok', text: '✅ تم إضافة المنتج وحساب الأسعار' })
    setForm({ name: '', sku: '', category: '', cost_price: '', target_net_price: '' })
    setShowAdd(false)
    loadData()
    setSaving(false)
  }

  function openEdit(prod: Product) {
    setEditProduct(prod)
    setEditForm({ cost_price: prod.cost_price > 0 ? String(prod.cost_price) : '', target_net_price: prod.target_net_price > 0 ? String(prod.target_net_price) : '' })
  }

  async function saveEditProduct() {
    if (!editProduct) return
    if (!editForm.target_net_price) { setMsg({ type: 'err', text: 'السعر الصافي المستهدف مطلوب' }); return }
    setEditSaving(true)
    const netPrice = parseFloat(editForm.target_net_price)
    const costPrice = parseFloat(editForm.cost_price) || 0
    const { error } = await supabase.from('products').update({ cost_price: costPrice, target_net_price: netPrice }).eq('id', editProduct.id)
    if (error) { setMsg({ type: 'err', text: error.message }); setEditSaving(false); return }

    // Recalculate platform prices
    const priceUpserts = PLATFORMS.map(p => {
      const rate = getRate(p, editProduct.category || undefined)
      if (!rate) return null
      return { product_id: editProduct.id, merchant_code: merchant!.merchant_code, platform: p, selling_price: calcSellingPrice(netPrice, rate), commission_rate: rate.rate }
    }).filter(Boolean)
    if (priceUpserts.length) {
      await supabase.from('product_platform_prices').upsert(priceUpserts, { onConflict: 'product_id,platform' })
    }

    setMsg({ type: 'ok', text: '✅ تم تحديث الأسعار وإعادة الحساب' })
    setEditProduct(null)
    setEditSaving(false)
    loadData()
  }

  async function sendRequest() {
    if (!showRequest) return
    if (!reqNote.trim()) { setMsg({ type: 'err', text: 'يرجى كتابة تفاصيل الطلب' }); return }
    setReqSending(true)
    const details: Record<string, any> = { product_name: showRequest.name }
    if (reqType === 'price_change' && reqNewPrice) details.new_target_price = parseFloat(reqNewPrice)
    const { error } = await supabase.from('merchant_requests').insert({
      merchant_code: merchant!.merchant_code,
      type: reqType,
      product_id: showRequest.id,
      details,
      note: reqNote.trim(),
    })
    if (error) setMsg({ type: 'err', text: 'فشل إرسال الطلب' })
    else setMsg({ type: 'ok', text: '✅ تم إرسال طلبك للفريق' })
    setShowRequest(null); setReqNote(''); setReqNewPrice('')
    setReqSending(false)
  }

  const filtered = useMemo(() =>
    products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase()))
  , [products, search])

  const preview = useMemo(() => {
    const net = parseFloat(form.target_net_price) || 0
    if (!net || !form.category.trim()) return null
    return PLATFORMS.map(p => {
      const rate = getRate(p, form.category)
      return { p, price: rate ? calcSellingPrice(net, rate) : 0, ratePct: rate?.rate }
    })
  }, [form.target_net_price, form.category, rates])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  function goInventory() {
    window.history.pushState(null, '', '/inventory')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <div style={S.wrap}>
      {/* Page Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        <button style={{ background: 'none', border: 'none', borderBottom: '2px solid var(--accent)', marginBottom: -2, padding: '8px 20px', fontSize: 14, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
          🏷️ كتالوج المنتجات
        </button>
        <button onClick={goInventory} style={{ background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -2, padding: '8px 20px', fontSize: 14, fontWeight: 500, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit' }}>
          🗃️ المخزون
        </button>
      </div>

      {/* Header */}
      <div style={S.topbar}>
        <div>
          <h2 style={S.title}>المنتجات</h2>
          <p style={S.sub}>{products.length} منتج مسجّل — الأسعار محسوبة تلقائياً لكل منصة</p>
        </div>
        <button style={S.addBtn} onClick={() => setShowAdd(v => !v)}>
          {showAdd ? '✕ إلغاء' : '+ إضافة منتج'}
        </button>
      </div>

      {/* Notification */}
      {msg && (
        <div style={{ ...S.alert, background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)', border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.3)' : 'rgba(255,77,109,0.3)'}` }}>
          {msg.text}
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* Profitability panel */}
      <ProfitabilityPanel merchant={merchant} />
      <InventoryTurnoverCard merchant={merchant} />
      <PricingSuggestionsPanel merchant={merchant} />
      <VariantPerformancePanel merchant={merchant} />
      <BrandPerformancePanel merchant={merchant} />
      <SkuLifecyclePanel merchant={merchant} />

      {/* Add Product Form */}
      {showAdd && (
        <div style={S.formCard}>
          <div style={S.formTitle}>إضافة منتج جديد</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div style={S.field}>
              <label style={S.label}>اسم المنتج *</label>
              <input style={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: حذاء رياضي نايك" />
            </div>
            <div style={S.field}>
              <label style={S.label}>SKU</label>
              <input style={S.input} value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="NK-001" dir="ltr" />
            </div>
            <div style={S.field}>
              <label style={S.label}>التصنيف</label>
              <input style={S.input} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="أحذية، ملابس، إلكترونيات..." />
            </div>
            <div style={S.field}>
              <label style={S.label}>تكلفة المنتج (ر.س)</label>
              <input style={S.input} type="number" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))} placeholder="0" />
            </div>
            <div style={{ ...S.field, gridColumn: isMobile ? '1' : '1 / -1' }}>
              <label style={S.label}>السعر الصافي المستهدف (ما تريد تستلمه) *</label>
              <input style={{ ...S.input, fontSize: 16, fontWeight: 700 }} type="number" value={form.target_net_price} onChange={e => setForm(f => ({ ...f, target_net_price: e.target.value }))} placeholder="مثال: 200" />
            </div>
          </div>

          {/* Guide: fill category first */}
          {form.target_net_price && !form.category.trim() && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(255,209,102,0.1)', border: '1px solid rgba(255,209,102,0.3)', borderRadius: 10, fontSize: 12, color: '#ffd166', fontWeight: 600 }}>
              ⚠️ اختر تصنيف المنتج لمعاينة الأسعار — نسبة العمولة تختلف حسب القسم
            </div>
          )}

          {/* Live price preview — only after category is chosen */}
          {preview && (
            <div style={S.preview}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={S.previewTitle}>معاينة الأسعار على المنصات</div>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>قسم: {form.category}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
                {preview.map(({ p, price, ratePct }) => (
                  <div key={p} style={{ ...S.previewCard, borderColor: PLATFORM_COLORS[p] + '55' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>{PLATFORM_NAMES[p]}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: PLATFORM_COLORS[p] }}>{price.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>ر.س</div>
                    {ratePct !== undefined && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>عمولة {ratePct}%</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
            <button style={S.saveBtn} onClick={addProduct} disabled={saving}>{saving ? '⟳ جاري الحفظ...' : '✓ حفظ المنتج'}</button>
            <button style={S.cancelBtn} onClick={() => setShowAdd(false)}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Search */}
      <input style={S.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 ابحث باسم المنتج أو SKU..." />

      {/* Products table */}
      {filtered.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>لا توجد منتجات بعد</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>أضف منتجك الأول وسيحسب النظام أسعاره تلقائياً</div>
        </div>
      ) : (
        <div style={S.tableCard}>
          {isMobile ? (
            // Mobile: card list
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
              {filtered.map(prod => {
                const ps = getPrices(prod.id)
                const profit = prod.target_net_price - prod.cost_price
                return (
                  <div key={prod.id} style={{ ...S.mobileCard, cursor: 'pointer' }} onClick={() => {
                    window.history.pushState(null, '', `/product-detail?id=${prod.id}`)
                    window.dispatchEvent(new PopStateEvent('popstate'))
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{prod.name}</div>
                        {prod.sku && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>{prod.sku}</div>}
                      </div>
                      <span style={{ ...S.statusBadge, ...(prod.status === 'active' ? S.badgeActive : S.badgeOff) }}>
                        {prod.status === 'active' ? 'نشط' : prod.status === 'out_of_stock' ? 'نفد' : 'موقوف'}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                      {PLATFORMS.map(p => (
                        <div key={p} style={{ textAlign: 'center', background: 'var(--bg)', borderRadius: 8, padding: '6px 4px', border: `1px solid ${PLATFORM_COLORS[p]}33` }}>
                          <div style={{ fontSize: 10, color: PLATFORM_COLORS[p], fontWeight: 700 }}>{PLATFORM_NAMES[p]}</div>
                          <div style={{ fontSize: 14, fontWeight: 800 }}>{ps[p]?.toLocaleString() || '—'}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: profit > 0 ? 'var(--accent2)' : 'var(--text3)' }}>
                        هامش: {profit > 0 ? '+' : ''}{profit.toLocaleString()} ر.س
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...S.reqBtn, background: 'rgba(124,107,255,0.1)', color: 'var(--accent)', borderColor: 'rgba(124,107,255,0.25)' }} onClick={() => openEdit(prod)}>✏️</button>
                        <button style={S.reqBtn} onClick={() => setShowRequest(prod)}>طلب تعديل</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    {['المنتج', 'SKU', 'التكلفة', 'الصافي المستهدف', ...PLATFORMS.map(p => PLATFORM_NAMES[p]), 'الهامش', 'الحالة', ''].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(prod => {
                    const ps = getPrices(prod.id)
                    const profit = prod.target_net_price - prod.cost_price
                    return (
                      <tr key={prod.id} style={{ ...S.tr, cursor: 'pointer' }} onClick={() => {
                        window.history.pushState(null, '', `/product-detail?id=${prod.id}`)
                        window.dispatchEvent(new PopStateEvent('popstate'))
                      }}>
                        <td style={S.td}>
                          <div style={{ fontWeight: 600 }}>{prod.name}</div>
                          {prod.category && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{prod.category}</div>}
                        </td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>{prod.sku || '—'}</td>
                        <td style={S.td}>{prod.cost_price > 0 ? prod.cost_price.toLocaleString() + ' ر.س' : '—'}</td>
                        <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent)' }}>{prod.target_net_price.toLocaleString()} ر.س</td>
                        {PLATFORMS.map(p => (
                          <td key={p} style={{ ...S.td, fontWeight: 700, color: PLATFORM_COLORS[p] }}>
                            {ps[p] ? ps[p].toLocaleString() + ' ر.س' : '—'}
                          </td>
                        ))}
                        <td style={{ ...S.td, color: profit > 0 ? 'var(--accent2)' : 'var(--red)', fontWeight: 700 }}>
                          {profit > 0 ? '+' : ''}{profit.toLocaleString()} ر.س
                        </td>
                        <td style={S.td}>
                          <span style={{ ...S.statusBadge, ...(prod.status === 'active' ? S.badgeActive : S.badgeOff) }}>
                            {prod.status === 'active' ? 'نشط' : prod.status === 'out_of_stock' ? 'نفد' : 'موقوف'}
                          </span>
                        </td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={{ ...S.reqBtn, background: 'rgba(124,107,255,0.1)', color: 'var(--accent)', borderColor: 'rgba(124,107,255,0.25)' }} onClick={() => openEdit(prod)}>✏️ سعر</button>
                            <button style={S.reqBtn} onClick={() => setShowRequest(prod)}>طلب تعديل</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Commission rates info — filtered by category if form is open */}
      {rates.length > 0 && (() => {
        const activeCategory = showAdd && form.category.trim() ? form.category.trim().toLowerCase() : null
        const categoryRates = activeCategory
          ? rates.filter(r => r.category.toLowerCase() === activeCategory)
          : []
        const defaultRates = rates.filter(r => r.category === 'default')
        const displayRates = categoryRates.length > 0 ? categoryRates : defaultRates
        const label = categoryRates.length > 0
          ? `نسب عمولات قسم "${form.category}"`
          : 'نسب العمولات الافتراضية (محدّثة من الفريق)'

        return (
          <div style={S.ratesCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={S.ratesTitle}>{label}</div>
              {categoryRates.length === 0 && showAdd && form.category.trim() && (
                <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '3px 9px', borderRadius: 20 }}>
                  لا يوجد نسب خاصة بهذا القسم — يُستخدم الافتراضي
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
              {displayRates.map(r => (
                <div key={`${r.platform}-${r.category}`} style={{ ...S.rateChip, borderColor: (PLATFORM_COLORS[r.platform] || '#5a5a7a') + '44' }}>
                  <span style={{ fontWeight: 700, color: PLATFORM_COLORS[r.platform] || 'var(--text)' }}>{PLATFORM_NAMES[r.platform] || r.platform}</span>
                  <span style={{ color: 'var(--text2)' }}>{r.rate}% + ضريبة {r.vat_rate}%</span>
                  {r.shipping_fee > 0 && <span style={{ color: 'var(--text3)', fontSize: 11 }}>شحن: {r.shipping_fee} ر.س</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Edit Price Modal */}
      {editProduct && (
        <div style={S.overlay} onClick={() => setEditProduct(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>✏️ تعديل أسعار — {editProduct.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: -8 }}>
              {editProduct.category && <span>القسم: {editProduct.category} · </span>}
              SKU: {editProduct.sku || '—'}
            </div>
            <div style={S.field}>
              <label style={S.label}>تكلفة المنتج (ر.س)</label>
              <input style={S.input} type="number" value={editForm.cost_price} onChange={e => setEditForm(f => ({ ...f, cost_price: e.target.value }))} placeholder="سعر الشراء / التصنيع" />
            </div>
            <div style={S.field}>
              <label style={S.label}>السعر الصافي المستهدف * (ما تريد تستلمه بعد رسوم المنصة)</label>
              <input style={{ ...S.input, fontSize: 16, fontWeight: 700 }} type="number" value={editForm.target_net_price} onChange={e => setEditForm(f => ({ ...f, target_net_price: e.target.value }))} placeholder="مثال: 200" />
            </div>
            {editForm.target_net_price && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>معاينة الأسعار بعد الحفظ</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {PLATFORMS.map(p => {
                    const rate = getRate(p, editProduct.category || undefined)
                    const price = rate ? calcSellingPrice(parseFloat(editForm.target_net_price) || 0, rate) : 0
                    return (
                      <div key={p} style={{ flex: 1, textAlign: 'center', background: 'var(--surface)', borderRadius: 8, padding: '8px 4px', border: `1px solid ${PLATFORM_COLORS[p]}33` }}>
                        <div style={{ fontSize: 10, color: PLATFORM_COLORS[p], fontWeight: 700 }}>{PLATFORM_NAMES[p]}</div>
                        <div style={{ fontSize: 16, fontWeight: 800 }}>{price.toLocaleString()}</div>
                        <div style={{ fontSize: 9, color: 'var(--text3)' }}>ر.س</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button style={S.saveBtn} onClick={saveEditProduct} disabled={editSaving}>{editSaving ? '⟳ جاري الحفظ...' : '✓ حفظ وإعادة الحساب'}</button>
              <button style={S.cancelBtn} onClick={() => setEditProduct(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Request Modal */}
      {showRequest && (
        <div style={S.overlay} onClick={() => setShowRequest(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>طلب تعديل — {showRequest.name}</div>
            <div style={S.field}>
              <label style={S.label}>نوع الطلب</label>
              <select style={S.input} value={reqType} onChange={e => setReqType(e.target.value as any)}>
                <option value="price_change">تغيير السعر</option>
                <option value="update_info">تعديل معلومات المنتج</option>
                <option value="remove_product">إيقاف المنتج</option>
                <option value="other">أخرى</option>
              </select>
            </div>
            {reqType === 'price_change' && (
              <div style={S.field}>
                <label style={S.label}>السعر الصافي الجديد (ر.س)</label>
                <input style={S.input} type="number" value={reqNewPrice} onChange={e => setReqNewPrice(e.target.value)} placeholder="مثال: 250" />
              </div>
            )}
            <div style={S.field}>
              <label style={S.label}>تفاصيل الطلب *</label>
              <textarea style={{ ...S.input, height: 80, resize: 'vertical' }} value={reqNote} onChange={e => setReqNote(e.target.value)} placeholder="اكتب تفاصيل طلبك هنا..." />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button style={S.saveBtn} onClick={sendRequest} disabled={reqSending}>{reqSending ? '⟳ جاري الإرسال...' : '✓ إرسال للفريق'}</button>
              <button style={S.cancelBtn} onClick={() => setShowRequest(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:       { padding: '28px 32px', minHeight: '100vh', maxWidth: 1100, margin: '0 auto' },
  topbar:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  title:      { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  sub:        { fontSize: 13, color: 'var(--text2)', marginTop: 3 },
  addBtn:     { background: 'var(--accent)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  alert:      { padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  formCard:   { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 20 },
  formTitle:  { fontSize: 15, fontWeight: 700, marginBottom: 16 },
  field:      { display: 'flex', flexDirection: 'column', gap: 6 },
  label:      { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px' },
  input:      { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', width: '100%', fontFamily: 'inherit' },
  preview:    { marginTop: 16, background: 'var(--bg)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--border)' },
  previewTitle: { fontSize: 12, fontWeight: 700, color: 'var(--text3)' },
  previewCard:  { flex: 1, minWidth: 80, background: 'var(--surface)', border: '1px solid', borderRadius: 10, padding: '10px 14px', textAlign: 'center' },
  saveBtn:    { background: 'var(--accent2)', color: '#111', border: 'none', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  cancelBtn:  { background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 10, fontSize: 13, cursor: 'pointer' },
  search:     { width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', color: 'var(--text)', fontSize: 13, outline: 'none', marginBottom: 16, boxSizing: 'border-box' },
  empty:      { textAlign: 'center', padding: '80px 20px', color: 'var(--text3)' },
  tableCard:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', marginBottom: 20 },
  table:      { width: '100%', borderCollapse: 'collapse' },
  th:         { padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  tr:         { borderBottom: '1px solid var(--border)' },
  td:         { padding: '12px 16px', fontSize: 13, color: 'var(--text)' },
  statusBadge: { padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
  badgeActive: { background: 'rgba(0,229,176,0.12)', color: 'var(--accent2)' },
  badgeOff:    { background: 'var(--surface2)', color: 'var(--text3)' },
  reqBtn:     { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  mobileCard: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  ratesCard:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px' },
  ratesTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text2)' },
  rateChip:   { background: 'var(--bg)', border: '1px solid', borderRadius: 10, padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 },
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal:      { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '24px 28px', width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 },
  modalTitle: { fontSize: 16, fontWeight: 800 },
}


// ─── Profitability Panel ──────────────────────────────────────────────────────
function ProfitabilityPanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])
  async function load() {
    if (!merchant) return
    setLoading(true)
    const { data: rows } = await supabase.from('product_profitability').select('*').eq('merchant_code', merchant.merchant_code)
    setData(rows || [])
    setLoading(false)
  }

  const stats = useMemo(() => {
    const sold = data.filter(r => r.units_sold > 0)
    const totalProfit = sold.reduce((a, r) => a + (Number(r.net_profit) || 0), 0)
    const totalRevenue = sold.reduce((a, r) => a + (Number(r.revenue) || 0), 0)
    const losing = sold.filter(r => Number(r.net_profit) < 0)
    const star = [...sold].filter(r => Number(r.profit_margin_pct) > 30).sort((a, b) => Number(b.net_profit) - Number(a.net_profit)).slice(0, 5)
    const worst = [...sold].sort((a, b) => Number(a.net_profit) - Number(b.net_profit)).slice(0, 5)
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    return { sold, totalProfit, totalRevenue, losing, star, worst, margin }
  }, [data])

  if (loading || stats.sold.length === 0) return null
  const fmt = (v: number) => Math.round(v).toLocaleString('ar-SA') + ' ر.س'

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>💎 ربحية المنتجات</div>
        <button onClick={() => setShow(v => !v)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {show ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
        <PKpi label="منتجات مبيعة" value={stats.sold.length.toString()} sub={`من ${data.length}`} color="#7c6bff" />
        <PKpi label="إجمالي الإيرادات" value={fmt(stats.totalRevenue)} color="#00b894" />
        <PKpi label="صافي الربح" value={fmt(stats.totalProfit)} sub={stats.margin.toFixed(1) + '% هامش'} color={stats.totalProfit >= 0 ? '#00b894' : '#e84040'} />
        <PKpi label="منتجات خاسرة" value={stats.losing.length.toString()} sub={stats.losing.length > 0 ? '⚠ يحتاج مراجعة' : 'كل المنتجات رابحة'} color={stats.losing.length > 0 ? '#e84040' : '#00b894'} />
      </div>

      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {/* Star products */}
          {stats.star.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#00b894', marginBottom: 8 }}>🌟 منتجات نجمة (هامش &gt; 30%)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.star.map((p, i) => (
                  <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={p.product_name}>{p.product_name}</span>
                    <span style={{ fontWeight: 700, color: '#00b894' }}>{fmt(Number(p.net_profit))} · {Number(p.profit_margin_pct).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Worst products */}
          {stats.worst.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e84040', marginBottom: 8 }}>📉 أقل المنتجات ربحاً</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.worst.map((p, i) => (
                  <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={p.product_name}>{p.product_name}</span>
                    <span style={{ fontWeight: 700, color: Number(p.net_profit) < 0 ? '#e84040' : '#ff9900' }}>
                      {fmt(Number(p.net_profit))}{p.profit_margin_pct !== null && ' · ' + Number(p.profit_margin_pct).toFixed(0) + '%'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PKpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ─── Inventory Turnover Card ─────────────────────────────────────────────────
function InventoryTurnoverCard({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    if (!merchant) return
    supabase.rpc('inventory_turnover', { p_merchant_code: merchant.merchant_code, p_days: 90 })
      .then(({ data }) => setData(data))
  }, [merchant?.merchant_code])
  if (!data || !data.turnover_ratio) return null
  const fmt = (v: number) => Math.round(v).toLocaleString('ar-SA') + ' ر.س'
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>🔁 معدّل دوران المخزون</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div style={kpiBox('#7c6bff')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>دوران سنوي</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#7c6bff' }}>{Number(data.turnover_ratio).toFixed(1)}×</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{Number(data.turnover_ratio) >= 4 ? 'سرعة جيدة' : Number(data.turnover_ratio) >= 2 ? 'متوسط' : 'بطيء'}</div>
        </div>
        <div style={kpiBox('#00b894')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>الإيرادات (90 يوم)</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#00b894' }}>{fmt(Number(data.revenue))}</div>
        </div>
        <div style={kpiBox('#ff9900')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>تكلفة المباع (COGS)</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#ff9900' }}>{fmt(Number(data.cogs))}</div>
        </div>
        <div style={kpiBox('#4cc9f0')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>قيمة المخزون</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#4cc9f0' }}>{fmt(Number(data.avg_inv_value))}</div>
        </div>
        <div style={kpiBox('#a598ff')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>أيام لبيع المخزون</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#a598ff' }}>{data.days_to_sell_all || '—'} يوم</div>
        </div>
      </div>
    </div>
  )
}

// ─── Pricing Suggestions ─────────────────────────────────────────────────────
function PricingSuggestionsPanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('pricing_suggestions').select('*').eq('merchant_code', merchant.merchant_code).then(({ data }) => setData(data || []))
  }, [merchant?.merchant_code])
  const issues = data.filter(d => d.pricing_status !== 'ok')
  if (issues.length === 0) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>💲 اقتراحات تسعير</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>منتجات سعرها يحتاج مراجعة مقارنة بسعر التاجر</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {issues.slice(0, 8).map((p, i) => {
          const high = p.pricing_status === 'too_high'
          const c = high ? '#ff9900' : '#4cc9f0'
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 9 }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 12, background: c + '20', color: c, minWidth: 60, textAlign: 'center' }}>
                {high ? 'مرتفع' : 'منخفض'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{PLATFORM_NAMES[p.platform]} · سعر المنصة {Number(p.platform_price).toFixed(0)} · سعرك {Number(p.my_price).toFixed(0)}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: c }}>
                {p.deviation_pct > 0 ? '+' : ''}{Number(p.deviation_pct).toFixed(0)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function kpiBox(color: string): React.CSSProperties {
  return { background: 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${color}` }
}

// ─── Brand Performance ────────────────────────────────────────────────────────
function BrandPerformancePanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('brand_performance').select('*').eq('merchant_code', merchant.merchant_code).order('revenue', { ascending: false }).limit(15).then(({ data }) => setData(data || []))
  }, [merchant?.merchant_code])
  if (data.length === 0) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🏷️ أداء الماركات</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>أداء كل ماركة عبر المنصات</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['الماركة','المنصة','الوحدات المباعة','الإيراد','صافي الإيراد','نسبة الإرجاع'].map(h => (
            <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {data.map((b, i) => {
              const ret = Number(b.return_rate_pct) || 0
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>{b.brand}</td>
                  <td style={{ padding: '8px 12px', color: PLATFORM_COLORS[b.platform] || 'var(--text3)', fontWeight: 600 }}>{PLATFORM_NAMES[b.platform] || b.platform}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: '#00b894' }}>{b.units_sold}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{Math.round(Number(b.revenue)).toLocaleString('ar-SA')}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text2)' }}>{Math.round(Number(b.net_revenue)).toLocaleString('ar-SA')}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: ret > 15 ? '#e84040' : ret > 5 ? '#ff9900' : 'var(--text3)' }}>{ret > 0 ? ret + '%' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── SKU Lifecycle ────────────────────────────────────────────────────────────
function SkuLifecyclePanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('sku_lifecycle').select('*').eq('merchant_code', merchant.merchant_code).then(({ data }) => setData(data || []))
  }, [merchant?.merchant_code])
  if (data.length === 0) return null
  const counts: any = { launching: 0, new_no_sales: 0, growing: 0, mature: 0, dormant: 0, unknown: 0 }
  for (const d of data) counts[d.lifecycle_stage]++
  const labels: any = { launching: 'إطلاق ناجح', new_no_sales: 'جديد بدون بيع', growing: 'نامي', mature: 'مُنضج', dormant: 'خامل', unknown: 'غير محدّد' }
  const colors: any = { launching: '#00b894', new_no_sales: '#ff9900', growing: '#7c6bff', mature: '#4cc9f0', dormant: '#e84040', unknown: '#a598ff' }
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🔄 دورة حياة المنتجات</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>تصنيف منتجاتك حسب العمر والأداء</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {Object.keys(labels).filter(k => counts[k] > 0).map(k => (
          <div key={k} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderTop: `3px solid ${colors[k]}` }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>{labels[k]}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: colors[k] }}>{counts[k]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Variant Performance ──────────────────────────────────────────────────────
function VariantPerformancePanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('variant_performance').select('*').eq('merchant_code', merchant.merchant_code).order('units_sold', { ascending: false }).limit(20).then(({ data }) => setData(data || []))
  }, [merchant?.merchant_code])
  if (data.length === 0) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🎨 أداء التشكيلات (لون × مقاس)</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>أيّ تشكيلات تبيع أحسن وأيّها أعلى مرتجعات</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['الماركة','اللون','المقاس','مباع','مرتجع','نسبة الإرجاع','الإيراد'].map(h => (
            <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {data.map((v, i) => {
              const ret = Number(v.return_rate_pct) || 0
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{v.brand}</td>
                  <td style={{ padding: '8px 12px' }}>{v.color}</td>
                  <td style={{ padding: '8px 12px' }}>{v.size}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: '#00b894' }}>{v.units_sold}</td>
                  <td style={{ padding: '8px 12px', color: v.units_returned > 0 ? '#e84040' : 'var(--text3)' }}>{v.units_returned}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: ret > 15 ? '#e84040' : ret > 5 ? '#ff9900' : 'var(--text3)' }}>{ret > 0 ? ret + '%' : '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{Math.round(Number(v.revenue)).toLocaleString('ar-SA')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
