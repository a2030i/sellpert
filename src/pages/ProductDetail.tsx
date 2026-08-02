import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import { fmtCurrency, fmtNumber, fmtPercent, fmtDate } from '../lib/formatters'
import { ChevronLeft } from 'lucide-react'

export default function ProductDetail({ merchant }: { merchant: Merchant | null }) {
  const productId = new URLSearchParams(window.location.search).get('id')
  const [product, setProduct] = useState<any>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [returns, setReturns] = useState<any[]>([])
  const [adMetrics, setAdMetrics] = useState<any[]>([])
  const [profitability, setProfitability] = useState<any>(null)
  const [inventory, setInventory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!productId || !merchant) return
    Promise.all([
      supabase.from('products').select('*').eq('id', productId).maybeSingle(),
      supabase.from('product_profitability').select('*').eq('product_id', productId).maybeSingle(),
    ]).then(async ([p, prof]) => {
      const prod = p.data
      setProduct(prod)
      setProfitability(prof.data)
      if (prod) {
        const [ord, ret, ads, inv] = await Promise.all([
          supabase.from('orders').select('*').eq('merchant_code', merchant.merchant_code).eq('sku', prod.sku).order('order_date', { ascending: false }).limit(50),
          supabase.from('returns').select('*').eq('merchant_code', merchant.merchant_code).eq('sku', prod.sku).order('return_date', { ascending: false }).limit(20),
          supabase.from('ad_metrics').select('*').eq('merchant_code', merchant.merchant_code).eq('sku', prod.sku).order('spend', { ascending: false }).limit(50),
          supabase.from('inventory').select('*').eq('merchant_code', merchant.merchant_code).eq('sku', prod.sku),
        ])
        setOrders(ord.data || [])
        setReturns(ret.data || [])
        setAdMetrics(ads.data || [])
        setInventory(inv.data || [])
      }
      setLoading(false)
    })
  }, [productId, merchant])

  const adTotals = useMemo(() => ({
    spend:   adMetrics.reduce((a, r) => a + Number(r.spend), 0),
    revenue: adMetrics.reduce((a, r) => a + Number(r.revenue), 0),
    clicks:  adMetrics.reduce((a, r) => a + r.clicks, 0),
    orders:  adMetrics.reduce((a, r) => a + r.orders, 0),
  }), [adMetrics])

  function back() {
    window.history.pushState(null, '', '/products')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>

  if (!product) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>المنتج غير موجود</div>
      <button onClick={back} style={btnPrimary}>العودة للمنتجات</button>
    </div>
  )

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <button onClick={back} style={{ background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
        <ChevronLeft size={16} /> العودة للمنتجات
      </button>

      {/* Header */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 24, flexWrap: 'wrap' }}>
        {product.image_url && <img src={product.image_url} alt={product.name} style={{ width: 120, height: 120, borderRadius: 12, objectFit: 'cover' }} />}
        <div style={{ flex: 1, minWidth: 280 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{product.name}</h2>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text3)', flexWrap: 'wrap' }}>
            {product.sku && <span>SKU: <b style={{ color: 'var(--text2)', fontFamily: 'monospace' }}>{product.sku}</b></span>}
            {product.barcode && <span>باركود: <b style={{ color: 'var(--text2)', fontFamily: 'monospace' }}>{product.barcode}</b></span>}
            {product.brand && <span>الماركة: <b style={{ color: 'var(--text2)' }}>{product.brand}</b></span>}
            {product.category && <span>الفئة: <b style={{ color: 'var(--text2)' }}>{product.category}</b></span>}
          </div>
          {product.description && <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 12, lineHeight: 1.7 }}>{String(product.description).slice(0, 280)}{String(product.description).length > 280 ? '…' : ''}</p>}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
        <Kpi label="سعر التكلفة" value={fmtCurrency(product.cost_price)} color="#0f958c" />
        <Kpi label="سعر البيع المستهدف" value={fmtCurrency(product.target_net_price)} color="#4cc9f0" />
        <Kpi label="إجمالي الوحدات المباعة" value={fmtNumber(profitability?.units_sold || 0)} color="#00b894" />
        <Kpi label="الإيرادات" value={fmtCurrency(profitability?.revenue || 0)} color="#00b894" />
        <Kpi
          label={Number(product.cost_price || 0) > 0 ? 'صافي الربح التقديري' : 'الربحية'}
          value={Number(product.cost_price || 0) > 0 ? fmtCurrency(profitability?.net_profit || 0) : 'غير مكتملة'}
          sub={Number(product.cost_price || 0) > 0 && profitability?.profit_margin_pct !== null ? fmtPercent(profitability?.profit_margin_pct) + ' هامش' : 'أدخل سعر التكلفة أولًا'}
          color={Number(product.cost_price || 0) <= 0 ? 'var(--warning-text)' : (profitability?.net_profit || 0) >= 0 ? '#00b894' : '#e84040'}
        />
        <Kpi label="ROAS" value={profitability?.roas ? Number(profitability.roas).toFixed(2) + 'x' : '—'} color="#ff9900" />
      </div>

      {/* Profitability Simulator */}
      {profitability && Number(profitability.units_sold) > 0 && (
        <ProfitSimulator product={product} profitability={profitability} />
      )}

      {/* Per-platform listings */}
      <PerPlatformListings product={product} merchantCode={merchant?.merchant_code} defaultTitle={product.name} defaultDescription={product.description} defaultImages={(product.images || []).map((image: any) => typeof image === 'string' ? image : image?.url).filter(Boolean)} />

      {/* Inventory by platform */}
      {inventory.length > 0 && (
        <Section title="المخزون حسب المنصة">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {inventory.map((i, idx) => {
              const c = PLATFORM_COLORS[i.platform] || '#0f958c'
              return (
                <div key={idx} style={{ padding: '10px 14px', background: 'var(--surface2)', borderRadius: 10, borderLeft: `3px solid ${c}` }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{PLATFORM_MAP[i.platform] || i.platform}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{i.quantity}</div>
                  {i.fulfillment_channel && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{i.fulfillment_channel}</div>}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Ad metrics */}
      {adMetrics.length > 0 && (
        <Section title={`الإعلانات (${adMetrics.length})`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <Kpi label="إنفاق إعلاني" value={fmtCurrency(adTotals.spend)} color="#e84040" />
            <Kpi label="إيرادات إعلانية" value={fmtCurrency(adTotals.revenue)} color="#00b894" />
            <Kpi label="نقرات" value={fmtNumber(adTotals.clicks)} color="#0f958c" />
            <Kpi label="ROAS الإعلاني" value={adTotals.spend > 0 ? (adTotals.revenue / adTotals.spend).toFixed(2) + 'x' : '—'} color="#ff9900" />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{['المنصة','الحملة','كلمة البحث','إنفاق','إيراد','ROAS'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {adMetrics.slice(0, 15).map((a, i) => {
                  const r = a.spend > 0 ? a.revenue / a.spend : 0
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={td}>{PLATFORM_MAP[a.platform] || a.platform}</td>
                      <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.campaign_name}>{a.campaign_name || '—'}</td>
                      <td style={td}>{a.search_query || '—'}</td>
                      <td style={{ ...td, color: '#e84040' }}>{Number(a.spend).toFixed(2)}</td>
                      <td style={{ ...td, color: '#00b894' }}>{Number(a.revenue).toFixed(2)}</td>
                      <td style={{ ...td, fontWeight: 700, color: r >= 3 ? '#00b894' : r >= 1 ? '#ff9900' : '#e84040' }}>{r.toFixed(2)}x</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Returns */}
      {returns.length > 0 && (
        <Section title={`المرتجعات (${returns.length})`}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{['التاريخ','المنصة','السبب','المبلغ'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {returns.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={td}>{fmtDate(r.return_date)}</td>
                    <td style={{ ...td, color: PLATFORM_COLORS[r.platform], fontWeight: 700 }}>{PLATFORM_MAP[r.platform] || r.platform}</td>
                    <td style={td}>{r.reason || '—'}</td>
                    <td style={{ ...td, color: '#e84040', fontWeight: 700 }}>{fmtCurrency(r.return_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Recent orders */}
      {orders.length > 0 && (
        <Section title={`آخر ${Math.min(orders.length, 50)} طلب`}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{['التاريخ','المنصة','الكمية','المبلغ','الحالة'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {orders.slice(0, 30).map((o, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={td}>{fmtDate(o.order_date)}</td>
                    <td style={{ ...td, color: PLATFORM_COLORS[o.platform], fontWeight: 700 }}>{PLATFORM_MAP[o.platform] || o.platform}</td>
                    <td style={td}>{o.quantity}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmtCurrency(o.total_amount)}</td>
                    <td style={td}><span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: 'var(--surface2)', color: 'var(--text3)' }}>{o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {orders.length === 0 && returns.length === 0 && adMetrics.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', background: 'var(--surface)', borderRadius: 12, border: '1px dashed var(--border)' }}>
          لا توجد بيانات مرتبطة بهذا المنتج بعد
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>{title}</div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12 }
const btnPrimary: React.CSSProperties = { background: 'var(--accent)', border: 'none', color: '#fff', padding: '10px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }

// ─── Profitability Simulator ──────────────────────────────────────────────────
function ProfitSimulator({ product: _product, profitability }: { product: any; profitability: any }) {
  const [pricePct, setPricePct] = useState(0)
  const [adPct, setAdPct] = useState(0)
  const [costPct, setCostPct] = useState(0)
  const [demandElasticity] = useState(-1.5)

  const baseRevenue = Number(profitability.revenue) || 0
  const baseCogs    = Number(profitability.total_cost) || 0
  const baseAd      = Number(profitability.ad_spend) || 0
  const baseFees    = Number(profitability.platform_fees) || 0
  const baseUnits   = Number(profitability.units_sold) || 1

  // Demand response: لو السعر زاد X% الطلب يقل elasticity*X
  const newUnits = Math.max(0, baseUnits * (1 + (pricePct / 100) * demandElasticity))
  const unitPrice = (baseRevenue / baseUnits) * (1 + pricePct / 100)
  const newRevenue = newUnits * unitPrice
  const newCogs = newUnits * (baseCogs / baseUnits) * (1 + costPct / 100)
  const newAd = baseAd * (1 + adPct / 100)
  const newFees = newRevenue * (baseFees / Math.max(baseRevenue, 1))
  const newProfit = newRevenue - newCogs - newAd - newFees
  const baseProfit = baseRevenue - baseCogs - baseAd - baseFees
  const profitDelta = newProfit - baseProfit
  const profitPct = baseProfit !== 0 ? (profitDelta / Math.abs(baseProfit)) * 100 : 0

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>محاكي الربحية</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>جرّب تغيير الأسعار والإعلانات وشوف تأثيرها على الربح (مرونة الطلب: {Math.abs(demandElasticity)}x)</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        <SliderInput label="تغيير السعر" value={pricePct} onChange={setPricePct} min={-30} max={50} suffix="%" color="#0f958c" />
        <SliderInput label="تغيير الإعلانات" value={adPct} onChange={setAdPct} min={-100} max={100} suffix="%" color="#ff9900" />
        <SliderInput label="تغيير التكلفة" value={costPct} onChange={setCostPct} min={-30} max={30} suffix="%" color="#4cc9f0" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <SimBox label="الإيراد الجديد" value={fmtCurrency(newRevenue)} sub={`${newUnits.toFixed(0)} وحدة`} color="#0f958c" />
        <SimBox label="الربح الحالي" value={fmtCurrency(baseProfit)} color="var(--text2)" />
        <SimBox label="الربح الجديد" value={fmtCurrency(newProfit)} color={newProfit >= baseProfit ? '#00b894' : '#e84040'} />
        <SimBox label="الفرق" value={(profitDelta >= 0 ? '+' : '') + fmtCurrency(Math.abs(profitDelta))} sub={(profitDelta >= 0 ? '▲' : '▼') + ' ' + Math.abs(profitPct).toFixed(0) + '%'} color={profitDelta >= 0 ? '#00b894' : '#e84040'} />
      </div>

      {(pricePct !== 0 || adPct !== 0 || costPct !== 0) && (
        <div style={{ marginTop: 14, padding: '10px 14px', background: profitDelta >= 0 ? 'rgba(0,184,148,0.06)' : 'rgba(232,64,64,0.06)', borderRadius: 9, fontSize: 12, color: 'var(--text2)' }}>
          {profitDelta >= 0
            ? `بهذا التغيير، ربحك يزيد ${fmtCurrency(profitDelta)} (${profitPct.toFixed(0)}%). جرّب تطبيقه على المنتج.`
            : `هذا التغيير يخفّض ربحك ${fmtCurrency(Math.abs(profitDelta))}. أعد المحاولة.`}
        </div>
      )}
    </div>
  )
}

function SliderInput({ label, value, onChange, min, max, suffix, color }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix?: string; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color }}>{value > 0 ? '+' : ''}{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={value} step={1} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: color }} />
    </div>
  )
}

function SimBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 9, padding: 10, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─── Per-Platform Listings ────────────────────────────────────────────────────
function PerPlatformListings({ product, merchantCode, defaultTitle, defaultDescription, defaultImages }: { product: any; merchantCode?: string; defaultTitle?: string; defaultDescription?: string; defaultImages?: string[] }) {
  const productId = product.id
  const PLATFORMS = ['trendyol']
  const [listings, setListings] = useState<Record<string, any>>({})
  const [activePlatform, setActivePlatform] = useState<string>('trendyol')
  const [saving, setSaving] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [editing, setEditing] = useState<any>({})
  const [saveMessage, setSaveMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!productId) return
    supabase.from('product_platform_listings').select('*').eq('product_id', productId).then(({ data }) => {
      const map: any = {}
      for (const l of data || []) map[l.platform] = l
      setListings(map)
    })
  }, [productId])

  useEffect(() => {
    const cur = listings[activePlatform] || {}
    setEditing({
      title: cur.title ?? defaultTitle ?? '',
      description: cur.description ?? defaultDescription ?? '',
      bullet_points: (cur.bullet_points || []).join('\n'),
      keywords: (cur.keywords || []).join(', '),
      images: (cur.images || defaultImages || []).join('\n'),
    })
  }, [activePlatform, listings, defaultTitle, defaultDescription, defaultImages])

  async function checkDeliveryStatus(batchId: string, quiet = false) {
    if (!merchantCode || !batchId || checkingStatus) return
    if (!quiet) setCheckingStatus(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_code: merchantCode, action: 'products.batch_result', path: { batchRequestId: batchId } }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'تعذر تحديث حالة التعديل')
      setListings(previous => ({ ...previous, trendyol: { ...previous.trendyol, delivery_status: result.status, delivery_error: result.error || null, last_verified_at: new Date().toISOString() } }))
    } catch (error: any) {
      if (!quiet) setSaveMessage({ type: 'err', text: error.message || 'تعذر تحديث حالة التعديل' })
    } finally {
      if (!quiet) setCheckingStatus(false)
    }
  }

  useEffect(() => {
    const listing = listings.trendyol
    if (!listing?.external_batch_id || !['accepted', 'processing'].includes(listing.delivery_status)) return
    const timer = window.setInterval(() => void checkDeliveryStatus(listing.external_batch_id, true), 20000)
    return () => window.clearInterval(timer)
    // حالة الطلب ورقم الدفعة فقط هما ما يبدآن أو يوقفان المتابعة.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantCode, listings.trendyol?.external_batch_id, listings.trendyol?.delivery_status])

  async function save() {
    if (!productId || !merchantCode) return
    setSaving(true)
    setSaveMessage(null)
    let deliveryResult: any = null
    const images = editing.images ? editing.images.split('\n').map((s: string) => s.trim()).filter(Boolean) : []
    if (activePlatform === 'trendyol') {
      try {
        const contentId = product.external_id || product.raw?.contentId || product.raw?.id
        if (!contentId) throw new Error('لا يوجد معرّف Trendyol لهذا المنتج. شغّل المزامنة أولًا ثم حاول مجددًا.')
        if (!Number.isFinite(Number(contentId))) throw new Error('معرّف المنتج في Trendyol غير صالح. شغّل المزامنة ثم حاول مجددًا.')
        if (!editing.title?.trim() && !editing.description?.trim() && !images.length) throw new Error('أدخل تعديلًا واحدًا على الأقل قبل الإرسال.')
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            merchant_code: merchantCode,
            action: 'products.v2_update_content',
            confirm: true,
            storefront: 'SA',
            language: 'ar',
            payload: { items: [{
              contentId: Number(contentId),
              title: editing.title?.trim() || undefined,
              description: editing.description?.trim() || undefined,
              images: images.length ? images.map((url: string) => ({ url })) : undefined,
            }] },
          }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || result.error) throw new Error(result.error || 'رفض Trendyol طلب التعديل')
        deliveryResult = result
        setSaveMessage({
          type: 'ok',
          text: result.pendingApproval || result.batchRequestId
            ? 'تم إرسال التعديل إلى Trendyol، وهو الآن قيد المعالجة. سنحدّث الحالة بعد اعتماد المنصة.'
            : 'تم تطبيق التعديل في Trendyol بنجاح.',
        })
      } catch (error: any) {
        setSaveMessage({ type: 'err', text: error.message || 'تعذر إرسال التعديل إلى Trendyol' })
        setSaving(false)
        return
      }
    }
    const { error } = await supabase.from('product_platform_listings').upsert({
      product_id: productId,
      merchant_code: merchantCode,
      platform: activePlatform,
      title: editing.title || null,
      description: editing.description || null,
      bullet_points: editing.bullet_points ? editing.bullet_points.split('\n').map((s: string) => s.trim()).filter(Boolean) : [],
      keywords: editing.keywords ? editing.keywords.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      images,
      delivery_status: activePlatform === 'trendyol' ? (deliveryResult?.status || 'success') : 'draft',
      external_batch_id: activePlatform === 'trendyol' ? (deliveryResult?.batchRequestId || null) : null,
      last_submitted_at: activePlatform === 'trendyol' ? new Date().toISOString() : null,
      last_verified_at: activePlatform === 'trendyol' && !deliveryResult?.pendingApproval ? new Date().toISOString() : null,
      delivery_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id,platform' })
    setSaving(false)
    if (error) setSaveMessage({ type: 'err', text: `تعذر حفظ التعديل: ${error.message}` })
    if (!error) {
      const { data } = await supabase.from('product_platform_listings').select('*').eq('product_id', productId)
      const map: any = {}; for (const l of data || []) map[l.platform] = l
      setListings(map)
      if (activePlatform !== 'trendyol') setSaveMessage({ type: 'ok', text: 'تم حفظ التعديل.' })
    }
  }

  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 5 }
  const inp: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 8, fontSize: 12, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>بيانات المنتج في Trendyol</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>عدّل العنوان أو الوصف أو الصور، ثم أرسل التغيير مباشرة إلى Trendyol للمراجعة.</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {PLATFORMS.map(p => {
          const has = !!listings[p]
          return (
            <button key={p} onClick={() => setActivePlatform(p)} style={{
              padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: activePlatform === p ? (PLATFORM_COLORS[p] || 'var(--accent)') : 'var(--surface2)',
              color: activePlatform === p ? '#fff' : 'var(--text2)',
            }}>{PLATFORM_MAP[p] || p} {has && '✓'}</button>
          )
        })}
      </div>
      {activePlatform === 'trendyol' && listings.trendyol?.delivery_status && listings.trendyol.delivery_status !== 'draft' ? (
        <div style={{ marginBottom:14, padding:'11px 13px', borderRadius:9, border:'1px solid var(--border)', background:'var(--surface2)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:12, fontWeight:800, color: listings.trendyol.delivery_status === 'success' ? 'var(--success-text)' : listings.trendyol.delivery_status === 'failed' ? 'var(--danger-text)' : 'var(--warning-text)' }}>
              {{ accepted:'أُرسل إلى Trendyol', processing:'قيد مراجعة Trendyol', success:'اعتمد Trendyol التعديل', partial:'اعتمد Trendyol جزءًا من التعديل', failed:'يحتاج التعديل إلى تصحيح' }[listings.trendyol.delivery_status as string] || 'حالة التعديل غير معروفة'}
            </div>
            {listings.trendyol.delivery_error ? <div style={{ fontSize:11, color:'var(--danger-text)', marginTop:4 }}>{listings.trendyol.delivery_error}</div> : <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>يتم تحديث الحالة تلقائيًا دون الحاجة لإعادة الإرسال.</div>}
          </div>
          {listings.trendyol.external_batch_id && ['accepted','processing'].includes(listings.trendyol.delivery_status) ? <button onClick={() => void checkDeliveryStatus(listings.trendyol.external_batch_id)} disabled={checkingStatus} style={{ border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', padding:'7px 11px', borderRadius:8, fontFamily:'inherit', fontSize:11, fontWeight:700, cursor:'pointer' }}>{checkingStatus ? 'جارٍ التحقق...' : 'تحديث الحالة'}</button> : null}
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <div>
          <label style={fieldLabel}>العنوان</label>
          <input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} style={inp} />
        </div>
        {activePlatform !== 'trendyol' ? <div>
          <label style={fieldLabel}>الكلمات المفتاحية</label>
          <input value={editing.keywords || ''} onChange={e => setEditing({ ...editing, keywords: e.target.value })} style={inp} placeholder="مفصولة بفواصل" />
        </div> : null}
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={fieldLabel}>الوصف</label>
        <textarea value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={3} style={{ ...inp, minHeight: 80 }} />
      </div>
      {activePlatform !== 'trendyol' ? <div style={{ marginTop: 10 }}>
        <label style={fieldLabel}>النقاط (سطر لكل واحدة)</label>
        <textarea value={editing.bullet_points || ''} onChange={e => setEditing({ ...editing, bullet_points: e.target.value })} rows={4} style={{ ...inp, minHeight: 90 }} />
      </div> : null}
      <div style={{ marginTop: 10 }}>
        <label style={fieldLabel}>روابط الصور (سطر لكل واحدة)</label>
        <textarea value={editing.images || ''} onChange={e => setEditing({ ...editing, images: e.target.value })} rows={3} style={{ ...inp, minHeight: 70 }} placeholder="https://..." />
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving} style={{ background: PLATFORM_COLORS[activePlatform] || 'var(--accent)', border: 'none', color: '#fff', padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {saving ? 'جارٍ الإرسال...' : activePlatform === 'trendyol' ? 'إرسال التعديل إلى Trendyol' : 'حفظ ' + (PLATFORM_MAP[activePlatform] || activePlatform)}
        </button>
      </div>
      {saveMessage ? <div style={{ marginTop:10, padding:'10px 12px', borderRadius:8, fontSize:12, lineHeight:1.6, background:saveMessage.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color:saveMessage.type === 'ok' ? 'var(--success-text)' : 'var(--danger-text)' }}>{saveMessage.text}</div> : null}
    </div>
  )
}
