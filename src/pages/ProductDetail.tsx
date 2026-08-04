import { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import { fmtCurrency, fmtNumber, fmtPercent, fmtDate } from '../lib/formatters'
import {
  deliveryStatusLabel,
  friendlyDeliveryError,
  friendlyProductPublicationError,
  getProductContentChanges,
  normalizeProductImages,
  productActionLabel,
  productActionMatches,
  productPublicationStatusLabel,
  shortDeliveryReference,
} from '../lib/productDelivery'
import { userErrorMessage } from '../lib/userError'
import { ChevronLeft } from 'lucide-react'

const TrendyolPublishWizard = lazy(() => import('../components/TrendyolPublishWizard'))

const DATA_COLORS = {
  accent: 'var(--accent)',
  info: '#116783',
  success: 'var(--success-text)',
  warning: '#8a5100',
  danger: 'var(--danger-text)',
  trendyol: '#9a3f00',
} as const

function platformDisplayColor(platform?: string) {
  return platform === 'trendyol' ? DATA_COLORS.trendyol : PLATFORM_COLORS[platform || ''] || DATA_COLORS.accent
}

export default function ProductDetail({ merchant }: { merchant: Merchant | null }) {
  const productId = new URLSearchParams(window.location.search).get('id')
  const [product, setProduct] = useState<any>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [returns, setReturns] = useState<any[]>([])
  const [adMetrics, setAdMetrics] = useState<any[]>([])
  const [profitability, setProfitability] = useState<any>(null)
  const [inventory, setInventory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const merchantCode = merchant?.merchant_code

  useEffect(() => {
    if (!productId || !merchantCode) return
    setLoading(true)
    setLoadError('')
    Promise.all([
      supabase.from('products').select('*').eq('merchant_code', merchantCode).eq('id', productId).maybeSingle(),
      supabase.from('product_profitability').select('*').eq('merchant_code', merchantCode).eq('product_id', productId).maybeSingle(),
    ]).then(async ([p, prof]) => {
      const prod = p.data
      setProduct(prod)
      setProfitability(prof.data)
      if (prod) {
        const [ord, ret, ads, inv] = await Promise.all([
          supabase.from('orders').select('*').eq('merchant_code', merchantCode).eq('sku', prod.sku).order('order_date', { ascending: false }).limit(50),
          supabase.from('returns').select('*').eq('merchant_code', merchantCode).eq('sku', prod.sku).order('return_date', { ascending: false }).limit(20),
          supabase.from('ad_metrics').select('*').eq('merchant_code', merchantCode).eq('sku', prod.sku).order('spend', { ascending: false }).limit(50),
          supabase.from('inventory').select('*').eq('merchant_code', merchantCode).eq('sku', prod.sku),
        ])
        setOrders(ord.data || [])
        setReturns(ret.data || [])
        setAdMetrics(ads.data || [])
        setInventory(inv.data || [])
      }
      setLoading(false)
    }).catch(error => {
      console.error('load product details', error)
      setLoadError(userErrorMessage(error, 'تعذّر تحميل تفاصيل المنتج.'))
      setLoading(false)
    })
  }, [productId, merchantCode])

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

  if (loadError) return (
    <div style={{ padding:60, textAlign:'center', maxWidth:560, margin:'0 auto' }}>
      <h2 style={{ fontSize:18, marginBottom:8 }}>تعذر تحميل تفاصيل المنتج</h2>
      <p style={{ color:'var(--text2)', fontSize:13, lineHeight:1.8, marginBottom:18 }}>{loadError}</p>
      <button onClick={() => window.location.reload()} style={btnPrimary}>إعادة المحاولة</button>
    </div>
  )

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
        <Kpi label="سعر التكلفة" value={fmtCurrency(product.cost_price)} color={DATA_COLORS.accent} />
        <Kpi label="سعر البيع المستهدف" value={fmtCurrency(product.target_net_price)} color={DATA_COLORS.info} />
        <Kpi label="إجمالي الوحدات المباعة" value={fmtNumber(profitability?.units_sold || 0)} color={DATA_COLORS.success} />
        <Kpi label="الإيرادات" value={fmtCurrency(profitability?.revenue || 0)} color={DATA_COLORS.success} />
        <Kpi
          label={Number(product.cost_price || 0) > 0 ? 'صافي الربح التقديري' : 'الربحية'}
          value={Number(product.cost_price || 0) > 0 ? fmtCurrency(profitability?.net_profit || 0) : 'غير مكتملة'}
          sub={Number(product.cost_price || 0) > 0 && profitability?.profit_margin_pct !== null ? fmtPercent(profitability?.profit_margin_pct) + ' هامش' : 'أدخل سعر التكلفة أولًا'}
          color={Number(product.cost_price || 0) <= 0 ? 'var(--warning-text)' : (profitability?.net_profit || 0) >= 0 ? DATA_COLORS.success : DATA_COLORS.danger}
        />
        <Kpi label="ROAS" value={profitability?.roas ? Number(profitability.roas).toFixed(2) + 'x' : '—'} color={DATA_COLORS.warning} />
      </div>

      {/* Profitability Simulator */}
      {profitability && Number(profitability.units_sold) > 0 && (
        <ProfitSimulator product={product} profitability={profitability} />
      )}

      {/* Per-platform listings */}
      <PerPlatformListings product={product} merchantCode={merchant?.merchant_code} defaultTitle={product.name} defaultDescription={product.description} defaultImages={(product.images || []).map((image: any) => typeof image === 'string' ? image : image?.url).filter(Boolean)} onProductRefresh={setProduct} />

      {/* Inventory by platform */}
      {inventory.length > 0 && (
        <Section title="المخزون حسب المنصة">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {inventory.map((i, idx) => {
              const c = platformDisplayColor(i.platform)
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
            <Kpi label="إيرادات إعلانية" value={fmtCurrency(adTotals.revenue)} color={DATA_COLORS.success} />
            <Kpi label="نقرات" value={fmtNumber(adTotals.clicks)} color={DATA_COLORS.accent} />
            <Kpi label="ROAS الإعلاني" value={adTotals.spend > 0 ? (adTotals.revenue / adTotals.spend).toFixed(2) + 'x' : '—'} color={DATA_COLORS.warning} />
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
                      <td style={{ ...td, color: DATA_COLORS.success }}>{Number(a.revenue).toFixed(2)}</td>
                      <td style={{ ...td, fontWeight: 700, color: r >= 3 ? DATA_COLORS.success : r >= 1 ? DATA_COLORS.warning : DATA_COLORS.danger }}>{r.toFixed(2)}x</td>
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
                    <td style={{ ...td, color: platformDisplayColor(r.platform), fontWeight: 700 }}>{PLATFORM_MAP[r.platform] || r.platform}</td>
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
                    <td style={{ ...td, color: platformDisplayColor(o.platform), fontWeight: 700 }}>{PLATFORM_MAP[o.platform] || o.platform}</td>
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
        <SliderInput label="تغيير السعر" value={pricePct} onChange={setPricePct} min={-30} max={50} suffix="%" color={DATA_COLORS.accent} />
        <SliderInput label="تغيير الإعلانات" value={adPct} onChange={setAdPct} min={-100} max={100} suffix="%" color={DATA_COLORS.warning} />
        <SliderInput label="تغيير التكلفة" value={costPct} onChange={setCostPct} min={-30} max={30} suffix="%" color={DATA_COLORS.info} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <SimBox label="الإيراد الجديد" value={fmtCurrency(newRevenue)} sub={`${newUnits.toFixed(0)} وحدة`} color={DATA_COLORS.accent} />
        <SimBox label="الربح الحالي" value={fmtCurrency(baseProfit)} color="var(--text2)" />
        <SimBox label="الربح الجديد" value={fmtCurrency(newProfit)} color={newProfit >= baseProfit ? DATA_COLORS.success : DATA_COLORS.danger} />
        <SimBox label="الفرق" value={(profitDelta >= 0 ? '+' : '') + fmtCurrency(Math.abs(profitDelta))} sub={(profitDelta >= 0 ? '▲' : '▼') + ' ' + Math.abs(profitPct).toFixed(0) + '%'} color={profitDelta >= 0 ? DATA_COLORS.success : DATA_COLORS.danger} />
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
      <input aria-label={label} type="range" min={min} max={max} value={value} step={1} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: color }} />
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
function PerPlatformListings({ product, merchantCode, defaultTitle, defaultDescription, defaultImages, onProductRefresh }: { product: any; merchantCode?: string; defaultTitle?: string; defaultDescription?: string; defaultImages?: string[]; onProductRefresh?: (product:any) => void }) {
  const productId = product.id
  const PLATFORMS = ['trendyol']
  const [listings, setListings] = useState<Record<string, any>>({})
  const [listingsLoaded, setListingsLoaded] = useState(false)
  const [activePlatform, setActivePlatform] = useState<string>('trendyol')
  const [saving, setSaving] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [editing, setEditing] = useState<any>({})
  const [saveMessage, setSaveMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const initialCommercial = {
    quantity: String(product.raw?.quantity ?? product.raw?.stock ?? ''),
    salePrice: String(product.sale_price ?? product.target_net_price ?? ''),
    listPrice: String(product.msrp ?? product.sale_price ?? product.target_net_price ?? ''),
  }
  const [commercial, setCommercial] = useState(initialCommercial)
  const [commercialBaseline, setCommercialBaseline] = useState(initialCommercial)
  const [commercialSaving, setCommercialSaving] = useState(false)
  const initialDelivery = {
    duration: String(product.raw?.selectedVariant?.deliveryOptions?.deliveryDuration ?? product.raw?.deliveryOptions?.deliveryDuration ?? 0),
    speed: String(product.raw?.selectedVariant?.deliveryOptions?.fastDeliveryType ?? product.raw?.deliveryOptions?.fastDeliveryType ?? 'STANDARD'),
  }
  const [delivery, setDelivery] = useState(initialDelivery)
  const [deliveryBaseline, setDeliveryBaseline] = useState(initialDelivery)
  const [deliverySaving, setDeliverySaving] = useState(false)
  const [reviewMode, setReviewMode] = useState<'content' | 'commercial' | 'delivery' | null>(null)
  const [actionHistory, setActionHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const contentSendLock = useRef(false)
  const commercialSendLock = useRef(false)

  useEffect(() => {
    if (!productId || !merchantCode) return
    supabase.from('product_platform_listings').select('*').eq('merchant_code', merchantCode).eq('product_id', productId).then(({ data }) => {
      const map: any = {}
      for (const l of data || []) map[l.platform] = l
      setListings(map)
      setListingsLoaded(true)
    })
  }, [productId, merchantCode])

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

  const loadActionHistory = useCallback(async () => {
    if (!merchantCode) return
    setHistoryLoading(true)
    setHistoryError('')
    const { data, error } = await supabase.from('marketplace_action_logs')
      .select('id,action,status,error_message,external_batch_id,started_at,finished_at,request')
      .eq('merchant_code', merchantCode)
      .eq('platform', 'trendyol')
      .in('action', ['products.v2_create', 'products.v2_update_unapproved', 'products.v2_update_content', 'products.price_inventory', 'products.v2_update_delivery'])
      .order('started_at', { ascending: false })
      .limit(100)
    if (error) setHistoryError('تعذر تحميل سجل تحديثات المنتج الآن.')
    else setActionHistory((data || []).filter(action => productActionMatches(action, product)).slice(0, 8))
    setHistoryLoading(false)
  }, [merchantCode, product])

  useEffect(() => {
    void loadActionHistory()
  }, [loadActionHistory])

  const currentListing = listings[activePlatform] || {}
  const pendingDelivery = activePlatform === 'trendyol' && ['accepted', 'processing'].includes(currentListing.delivery_status)
  const editedImages = useMemo(
    () => normalizeProductImages(String(editing.images || '').split('\n')),
    [editing.images],
  )
  const contentChanges = useMemo(() => getProductContentChanges({
    title: currentListing.title ?? defaultTitle ?? '',
    description: currentListing.description ?? defaultDescription ?? '',
    images: normalizeProductImages(currentListing.images || defaultImages || []),
  }, {
    title: editing.title,
    description: editing.description,
    images: editedImages,
  }), [currentListing.title, currentListing.description, currentListing.images, defaultTitle, defaultDescription, defaultImages, editing.title, editing.description, editedImages])

  const commercialChanges = useMemo(() => {
    const changes: Array<{ label: string; before: string; after: string }> = []
    const values = [
      { label: 'المخزون المتاح', before: commercialBaseline.quantity, after: commercial.quantity, money: false },
      { label: 'سعر البيع', before: commercialBaseline.salePrice, after: commercial.salePrice, money: true },
      { label: 'السعر قبل الخصم', before: commercialBaseline.listPrice, after: commercial.listPrice, money: true },
    ]
    for (const value of values) {
      const before = value.before === '' ? '' : String(Number(value.before))
      const after = value.after === '' ? '' : String(Number(value.after))
      if (before === after) continue
      changes.push({
        label: value.label,
        before: before === '' ? 'غير متوفر' : value.money ? fmtCurrency(Number(before)) : Number(before).toLocaleString('ar-SA-u-nu-latn'),
        after: after === '' ? 'غير محدد' : value.money ? fmtCurrency(Number(after)) : Number(after).toLocaleString('ar-SA-u-nu-latn'),
      })
    }
    return changes
  }, [commercial, commercialBaseline])

  const deliveryChanges = useMemo(() => {
    const speedLabel = (value: string) => value === 'FAST_DELIVERY' ? 'توصيل سريع' : value === 'SAME_DAY_SHIPPING' ? 'شحن في اليوم نفسه' : 'توصيل قياسي'
    const changes: Array<{ label: string; before: string; after: string }> = []
    if (String(Number(delivery.duration)) !== String(Number(deliveryBaseline.duration))) changes.push({
      label:'مدة التجهيز', before:`${Number(deliveryBaseline.duration)} يوم`, after:`${Number(delivery.duration)} يوم`,
    })
    if (delivery.speed !== deliveryBaseline.speed) changes.push({
      label:'سرعة التوصيل', before:speedLabel(deliveryBaseline.speed), after:speedLabel(delivery.speed),
    })
    return changes
  }, [delivery, deliveryBaseline])

  function updateEditing(field: string, value: string) {
    setEditing((current: any) => ({ ...current, [field]: value }))
    setReviewMode(null)
    setSaveMessage(null)
  }

  function updateCommercial(field: 'quantity' | 'salePrice' | 'listPrice', value: string) {
    setCommercial(current => ({ ...current, [field]: value }))
    setReviewMode(null)
    setSaveMessage(null)
  }

  function updateDelivery(field: 'duration' | 'speed', value: string) {
    setDelivery(current => ({ ...current, [field]:value }))
    setReviewMode(null)
    setSaveMessage(null)
  }

  function commercialValidationError() {
    if (commercial.quantity.trim() === '' || commercial.salePrice.trim() === '' || commercial.listPrice.trim() === '') return 'أكمل المخزون وسعر البيع والسعر قبل الخصم.'
    const quantity = Number(commercial.quantity)
    const salePrice = Number(commercial.salePrice)
    const listPrice = Number(commercial.listPrice)
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20000) return 'المخزون المتاح يجب أن يكون عددًا صحيحًا بين 0 و20,000.'
    if (!Number.isFinite(salePrice) || salePrice < 0 || !Number.isFinite(listPrice) || listPrice < salePrice) return 'تحقق من الأسعار: السعر قبل الخصم لا يمكن أن يكون أقل من سعر البيع.'
    return ''
  }

  function contentValidationError() {
    const changedFields = new Set(contentChanges.map(change => change.field))
    if (changedFields.has('title') && !String(editing.title || '').trim()) return 'عنوان المنتج لا يمكن أن يكون فارغًا.'
    if (changedFields.has('description') && !String(editing.description || '').trim()) return 'وصف المنتج لا يمكن أن يكون فارغًا.'
    if (changedFields.has('images') && !editedImages.length) return 'أضف صورة واحدة على الأقل للمنتج.'
    return ''
  }

  function reviewContentUpdate() {
    setSaveMessage(null)
    if (pendingDelivery) {
      setSaveMessage({ type: 'err', text: 'يوجد تعديل قيد مراجعة Trendyol. انتظر نتيجته قبل إرسال تعديل جديد.' })
      return
    }
    if (!contentChanges.length) {
      setSaveMessage({ type: 'err', text: 'لم تغيّر بيانات المنتج. عدّل العنوان أو الوصف أو الصور أولًا.' })
      return
    }
    const validationError = contentValidationError()
    if (validationError) {
      setSaveMessage({ type: 'err', text: validationError })
      return
    }
    setReviewMode('content')
  }

  function reviewCommercialUpdate() {
    setSaveMessage(null)
    if (pendingDelivery) {
      setSaveMessage({ type: 'err', text: 'يوجد تحديث قيد مراجعة Trendyol. انتظر نتيجته قبل إرسال تحديث جديد.' })
      return
    }
    const validationError = commercialValidationError()
    if (validationError) {
      setSaveMessage({ type: 'err', text: validationError })
      return
    }
    if (!commercialChanges.length) {
      setSaveMessage({ type: 'err', text: 'لم تغيّر السعر أو المخزون.' })
      return
    }
    setReviewMode('commercial')
  }

  function reviewDeliveryUpdate() {
    setSaveMessage(null)
    if (pendingDelivery) {
      setSaveMessage({ type:'err', text:'يوجد تحديث قيد مراجعة Trendyol. انتظر نتيجته قبل إرسال تحديث جديد.' })
      return
    }
    if (!product.barcode) {
      setSaveMessage({ type:'err', text:'لا يمكن تحديث التوصيل قبل توفر باركود Trendyol للمنتج.' })
      return
    }
    const duration = Number(delivery.duration)
    if (!Number.isInteger(duration) || duration < 0 || duration > 30) {
      setSaveMessage({ type:'err', text:'مدة التجهيز يجب أن تكون عددًا صحيحًا بين 0 و30 يومًا.' })
      return
    }
    if (delivery.speed !== 'STANDARD' && duration !== 1) {
      setSaveMessage({ type:'err', text:'يتطلب التوصيل السريع أو الشحن في اليوم نفسه مدة تجهيز يوم واحد.' })
      return
    }
    if (!deliveryChanges.length) {
      setSaveMessage({ type:'err', text:'لم تغيّر مدة التجهيز أو سرعة التوصيل.' })
      return
    }
    setReviewMode('delivery')
  }

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
      if (['success','failed','partial'].includes(String(result.status || ''))) {
        const { data: refreshedProduct } = await supabase.from('products').select('*').eq('merchant_code',merchantCode).eq('id',productId).maybeSingle()
        if (refreshedProduct) onProductRefresh?.(refreshedProduct)
      }
      await loadActionHistory()
    } catch (error: any) {
      if (!quiet) setSaveMessage({ type: 'err', text: userErrorMessage(error, 'تعذّر تحديث حالة التعديل.') })
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
    if (contentSendLock.current) return
    if (pendingDelivery) {
      setSaveMessage({ type: 'err', text: 'يوجد تعديل قيد مراجعة Trendyol. انتظر نتيجته قبل إرسال تعديل جديد.' })
      return
    }
    contentSendLock.current = true
    setSaving(true)
    setSaveMessage(null)
    let deliveryResult: any = null
    const images = editedImages
    if (activePlatform === 'trendyol') {
      try {
        const contentId = product.external_id || product.raw?.contentId || product.raw?.id
        if (!contentId) throw new Error('لا يوجد معرّف Trendyol لهذا المنتج. شغّل المزامنة أولًا ثم حاول مجددًا.')
        if (!Number.isFinite(Number(contentId))) throw new Error('معرّف المنتج في Trendyol غير صالح. شغّل المزامنة ثم حاول مجددًا.')
        if (!contentChanges.length) throw new Error('لم تغيّر بيانات المنتج. عدّل العنوان أو الوصف أو الصور أولًا.')
        const validationError = contentValidationError()
        if (validationError) throw new Error(validationError)
        const changedFields = new Set(contentChanges.map(change => change.field))
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
              title: changedFields.has('title') ? editing.title.trim() : undefined,
              description: changedFields.has('description') ? editing.description.trim() : undefined,
              images: changedFields.has('images') ? images.map((url: string) => ({ url })) : undefined,
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
        setSaveMessage({ type: 'err', text: friendlyDeliveryError(error.message) || 'تعذر إرسال التعديل إلى Trendyol' })
        contentSendLock.current = false
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
    contentSendLock.current = false
    setSaving(false)
    if (error) {
      console.error('save product edit', error)
      setSaveMessage({ type: 'err', text: deliveryResult ? 'تم إرسال الطلب إلى Trendyol، لكن تعذر حفظ حالة المتابعة محليًا. حدّث الصفحة للتحقق من النتيجة.' : userErrorMessage(error, 'تعذّر حفظ تعديل المنتج.') })
    }
    if (!error) {
      const { data } = await supabase.from('product_platform_listings').select('*').eq('merchant_code', merchantCode).eq('product_id', productId)
      const map: any = {}; for (const l of data || []) map[l.platform] = l
      setListings(map)
      setReviewMode(null)
      await loadActionHistory()
      if (activePlatform !== 'trendyol') setSaveMessage({ type: 'ok', text: 'تم حفظ التعديل.' })
    }
  }

  async function savePriceInventory() {
    if (!merchantCode || !product.barcode) {
      setSaveMessage({ type:'err', text:'لا يمكن تحديث السعر والمخزون قبل توفر باركود Trendyol للمنتج.' }); return
    }
    if (pendingDelivery) {
      setSaveMessage({ type:'err', text:'يوجد تحديث قيد مراجعة Trendyol. انتظر نتيجته قبل إرسال تحديث جديد.' }); return
    }
    if (commercialSendLock.current) return
    const validationError = commercialValidationError()
    if (validationError) {
      setSaveMessage({ type:'err', text:validationError }); return
    }
    const quantity = Number(commercial.quantity)
    const salePrice = Number(commercial.salePrice)
    const listPrice = Number(commercial.listPrice)
    commercialSendLock.current = true
    setCommercialSaving(true); setSaveMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
        method:'POST',
        headers:{ Authorization:`Bearer ${session.access_token}`, apikey:import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type':'application/json', 'idempotency-key':crypto.randomUUID() },
        body:JSON.stringify({ merchant_code:merchantCode, action:'products.price_inventory', confirm:true, storefront:'SA', payload:{ items:[{ barcode:product.barcode, quantity, salePrice, listPrice }] } }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || 'رفض Trendyol تحديث السعر والمخزون')
      const now = new Date().toISOString()
      const { error } = await supabase.from('product_platform_listings').upsert({
        product_id:productId, merchant_code:merchantCode, platform:'trendyol',
        delivery_status:result.status || 'accepted', external_batch_id:result.batchRequestId || null,
        last_submitted_at:now, last_verified_at:result.pendingApproval ? null : now, delivery_error:null, updated_at:now,
      }, { onConflict:'product_id,platform' })
      if (error) throw error
      await supabase.from('products').update({ sale_price:salePrice, msrp:listPrice, updated_at:now }).eq('id',productId).eq('merchant_code',merchantCode)
      setListings(previous => ({ ...previous, trendyol:{ ...previous.trendyol, delivery_status:result.status || 'accepted', external_batch_id:result.batchRequestId || null, last_submitted_at:now } }))
      setCommercialBaseline({ quantity:String(quantity), salePrice:String(salePrice), listPrice:String(listPrice) })
      setReviewMode(null)
      await loadActionHistory()
      setSaveMessage({ type:'ok', text:'تم إرسال السعر والمخزون إلى Trendyol، وتتم متابعة اعتماد التحديث تلقائيًا.' })
    } catch (error:any) {
      setSaveMessage({ type:'err', text:friendlyDeliveryError(error.message) || 'تعذر تحديث السعر والمخزون في Trendyol' })
    } finally { commercialSendLock.current = false; setCommercialSaving(false) }
  }

  async function saveDeliveryOptions() {
    if (!merchantCode || !product.barcode || deliverySaving) return
    const duration = Number(delivery.duration)
    setDeliverySaving(true); setSaveMessage(null)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
        method:'POST',
        headers:{ Authorization:`Bearer ${session.access_token}`, apikey:import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type':'application/json', 'idempotency-key':crypto.randomUUID() },
        body:JSON.stringify({ merchant_code:merchantCode, action:'products.v2_update_delivery', confirm:true, storefront:'SA', payload:{ items:[{
          barcode:product.barcode,
          deliveryOptions:{ deliveryDuration:duration, fastDeliveryType:delivery.speed === 'STANDARD' ? null : delivery.speed },
        }] } }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || 'رفض Trendyol تحديث خيارات التوصيل')
      const now = new Date().toISOString()
      const { error } = await supabase.from('product_platform_listings').upsert({
        product_id:productId, merchant_code:merchantCode, platform:'trendyol',
        delivery_status:result.status || 'accepted', external_batch_id:result.batchRequestId || null,
        last_submitted_at:now, last_verified_at:result.pendingApproval ? null : now, delivery_error:null, updated_at:now,
      }, { onConflict:'product_id,platform' })
      if (error) throw error
      setListings(previous => ({ ...previous, trendyol:{ ...previous.trendyol, delivery_status:result.status || 'accepted', external_batch_id:result.batchRequestId || null, last_submitted_at:now } }))
      setDeliveryBaseline({ duration:String(duration), speed:delivery.speed })
      setReviewMode(null)
      await loadActionHistory()
      setSaveMessage({ type:'ok', text:'تم إرسال مدة التجهيز وخيار التوصيل إلى Trendyol، وستتحدث الحالة هنا تلقائيًا.' })
    } catch (error:any) {
      setSaveMessage({ type:'err', text:friendlyDeliveryError(error.message) || 'تعذر تحديث خيارات التوصيل في Trendyol' })
    } finally { setDeliverySaving(false) }
  }

  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 5 }
  const inp: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 8, fontSize: 12, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }

  const existsInTrendyol = Boolean(
    ['accepted','processing','success','partial'].includes(String(listings.trendyol?.delivery_status || '')) ||
    String(product.platform_source || '').startsWith('trendyol') ||
    product.raw?.contentId ||
    product.raw?.selectedVariant?.variantId,
  )
  const isPublicationFlow = listings.trendyol?.notes === 'trendyol_product_create'
  const isRejectedPublication = isPublicationFlow && listings.trendyol?.delivery_status === 'failed'

  if (listingsLoaded && isRejectedPublication) return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:18, marginBottom:16 }}>
      <div style={{ fontSize:16, fontWeight:700, marginBottom:5 }}>إدارة المنتج في Trendyol</div>
      <div role="status" style={{ marginTop:12, padding:14, borderRadius:9, background:'var(--danger-bg)', color:'var(--danger-text)' }}>
        <div style={{ fontSize:13, fontWeight:750 }}>{productPublicationStatusLabel('failed')}</div>
        <div style={{ marginTop:6, fontSize:12, lineHeight:1.7 }}>{friendlyProductPublicationError(listings.trendyol.delivery_error) || 'راجع بيانات المنتج ثم أعد إرساله للمراجعة.'}</div>
        <ProductDeliveryProgress status="failed" publication />
      </div>
      <div style={{ marginTop:14 }}>
        <Suspense fallback={<div role="status" style={{ padding:18, color:'var(--text3)', fontSize:12 }}>جارٍ تجهيز نموذج التصحيح…</div>}>
          <TrendyolPublishWizard
            mode="repair"
            product={product}
            merchantCode={merchantCode || ''}
            onSubmitted={listing => {
              setListings(current => ({ ...current, trendyol:listing }))
              void loadActionHistory()
            }}
          />
        </Suspense>
      </div>
    </div>
  )

  if (listingsLoaded && !existsInTrendyol) return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:18, marginBottom:16 }}>
      <div style={{ fontSize:16, fontWeight:700, marginBottom:5 }}>إدارة المنتج في Trendyol</div>
      <div style={{ fontSize:12, color:'var(--text3)', marginBottom:14 }}>انشر المنتج من بيانات Sellpert الحالية ثم تابع مراجعة Trendyol من الصفحة نفسها.</div>
      <Suspense fallback={<div role="status" style={{ padding:18, color:'var(--text3)', fontSize:12 }}>جارٍ تجهيز نموذج النشر…</div>}>
        <TrendyolPublishWizard
          product={product}
          merchantCode={merchantCode || ''}
          onSubmitted={listing => {
            setListings(current => ({ ...current, trendyol:listing }))
            void loadActionHistory()
          }}
        />
      </Suspense>
    </div>
  )

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 5 }}>إدارة المنتج في Trendyol</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>راجع التغييرات قبل إرسالها، ثم تابع اعتمادها من Trendyol من المكان نفسه.</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {PLATFORMS.map(p => {
          const has = !!listings[p]
          return (
            <button key={p} onClick={() => setActivePlatform(p)} style={{
              padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: activePlatform === p ? platformDisplayColor(p) : 'var(--surface2)',
              color: activePlatform === p ? '#fff' : 'var(--text2)',
            }}>{PLATFORM_MAP[p] || p} {has && '— مفعّل'}</button>
          )
        })}
      </div>
      {activePlatform === 'trendyol' && listings.trendyol?.delivery_status && listings.trendyol.delivery_status !== 'draft' ? (
        <div style={{ marginBottom:14, padding:'13px 14px', borderRadius:9, border:'1px solid var(--border)', background:'var(--surface2)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div>
            <div role="status" aria-live="polite" style={{ fontSize:13, fontWeight:700, color: deliveryStatusColor(listings.trendyol.delivery_status) }}>
              {isPublicationFlow ? productPublicationStatusLabel(listings.trendyol.delivery_status) : deliveryStatusLabel(listings.trendyol.delivery_status)}
            </div>
            {listings.trendyol.delivery_error ? <div style={{ fontSize:12, color:'var(--danger-text)', marginTop:5 }}>{isPublicationFlow ? friendlyProductPublicationError(listings.trendyol.delivery_error) : friendlyDeliveryError(listings.trendyol.delivery_error)}</div> : <div style={{ fontSize:12, color:'var(--text3)', marginTop:5 }}>تتحدث الحالة تلقائيًا؛ لا تعِد الإرسال أثناء المعالجة.</div>}
            <ProductDeliveryProgress status={listings.trendyol.delivery_status} publication={isPublicationFlow} />
            <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginTop:6, fontSize:11, color:'var(--text3)' }}>
              {listings.trendyol.last_submitted_at ? <span>آخر إرسال: {formatDeliveryDate(listings.trendyol.last_submitted_at)}</span> : null}
              {listings.trendyol.external_batch_id ? <span>مرجع المتابعة: {shortDeliveryReference(listings.trendyol.external_batch_id)}</span> : null}
            </div>
          </div>
          {listings.trendyol.external_batch_id && ['accepted','processing'].includes(listings.trendyol.delivery_status) ? <button onClick={() => void checkDeliveryStatus(listings.trendyol.external_batch_id)} disabled={checkingStatus} style={{ border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', padding:'7px 11px', borderRadius:8, fontFamily:'inherit', fontSize:11, fontWeight:700, cursor:'pointer' }}>{checkingStatus ? 'جارٍ التحقق...' : 'تحديث الحالة'}</button> : null}
        </div>
      ) : null}
      {activePlatform === 'trendyol' ? <div style={{ marginBottom:16, padding:14, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
        <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>السعر والمخزون</div>
        <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6, marginBottom:10 }}>أدخل الكمية المتاحة للبيع والأسعار بالريال السعودي، ثم راجع الفرق قبل الإرسال.</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:8 }}>
          <div><label style={fieldLabel}>المخزون المتاح</label><input aria-label="المخزون المتاح" disabled={pendingDelivery} type="number" min="0" max="20000" step="1" value={commercial.quantity} onChange={e => updateCommercial('quantity', e.target.value)} style={{ ...inp, opacity:pendingDelivery ? .65 : 1 }}/></div>
          <div><label style={fieldLabel}>سعر البيع (ر.س)</label><input aria-label="سعر البيع بالريال" disabled={pendingDelivery} type="number" min="0" step="0.01" value={commercial.salePrice} onChange={e => updateCommercial('salePrice', e.target.value)} style={{ ...inp, opacity:pendingDelivery ? .65 : 1 }}/></div>
          <div><label style={fieldLabel}>السعر قبل الخصم (ر.س)</label><input aria-label="السعر قبل الخصم بالريال" disabled={pendingDelivery} type="number" min="0" step="0.01" value={commercial.listPrice} onChange={e => updateCommercial('listPrice', e.target.value)} style={{ ...inp, opacity:pendingDelivery ? .65 : 1 }}/></div>
        </div>
        {reviewMode === 'commercial' ? <ProductChangeReview title="راجع تحديث السعر والمخزون" changes={commercialChanges} busy={commercialSaving} confirmLabel="تأكيد وإرسال إلى Trendyol" onBack={() => setReviewMode(null)} onConfirm={() => void savePriceInventory()} /> : null}
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}><button onClick={reviewCommercialUpdate} disabled={commercialSaving || pendingDelivery} style={{ background:'var(--surface)', border:`1px solid ${DATA_COLORS.trendyol}`, color:DATA_COLORS.trendyol, padding:'8px 13px', borderRadius:8, fontFamily:'inherit', fontSize:12, fontWeight:700, cursor:commercialSaving || pendingDelivery ? 'not-allowed' : 'pointer', opacity:commercialSaving || pendingDelivery ? .6 : 1 }}>{pendingDelivery ? 'تحديث قيد المعالجة' : 'مراجعة السعر والمخزون'}</button></div>
      </div> : null}
      {activePlatform === 'trendyol' ? <div style={{ marginBottom:16, padding:14, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
        <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>التجهيز والتوصيل</div>
        <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6, marginBottom:10 }}>حدد المدة التي تحتاجها لتجهيز المنتج، ثم اختر سرعة التوصيل المتاحة. يُرسل التحديث مباشرة إلى Trendyol بعد المراجعة.</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:8 }}>
          <div><label style={fieldLabel}>مدة التجهيز بالأيام</label><input aria-label="مدة تجهيز المنتج" disabled={pendingDelivery} type="number" min="0" max="30" step="1" value={delivery.duration} onChange={event => updateDelivery('duration', event.target.value)} style={{ ...inp, opacity:pendingDelivery ? .65 : 1 }}/></div>
          <div><label style={fieldLabel}>سرعة التوصيل</label><select aria-label="سرعة توصيل المنتج" disabled={pendingDelivery} value={delivery.speed} onChange={event => updateDelivery('speed', event.target.value)} style={{ ...inp, opacity:pendingDelivery ? .65 : 1 }}><option value="STANDARD">توصيل قياسي</option><option value="FAST_DELIVERY">توصيل سريع</option><option value="SAME_DAY_SHIPPING">شحن في اليوم نفسه</option></select></div>
        </div>
        {delivery.speed !== 'STANDARD' && Number(delivery.duration) !== 1 ? <div role="alert" style={{ marginTop:8, fontSize:11, color:'var(--warning-text)' }}>اختر يومًا واحدًا كمدة تجهيز لتفعيل هذا الخيار.</div> : null}
        {reviewMode === 'delivery' ? <ProductChangeReview title="راجع تحديث التجهيز والتوصيل" changes={deliveryChanges} busy={deliverySaving} confirmLabel="تأكيد وإرسال إلى Trendyol" onBack={() => setReviewMode(null)} onConfirm={() => void saveDeliveryOptions()} /> : null}
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}><button onClick={reviewDeliveryUpdate} disabled={deliverySaving || pendingDelivery} style={{ background:'var(--surface)', border:`1px solid ${DATA_COLORS.trendyol}`, color:DATA_COLORS.trendyol, padding:'8px 13px', borderRadius:8, fontFamily:'inherit', fontSize:12, fontWeight:700, cursor:deliverySaving || pendingDelivery ? 'not-allowed' : 'pointer', opacity:deliverySaving || pendingDelivery ? .6 : 1 }}>{pendingDelivery ? 'تحديث قيد المعالجة' : 'مراجعة إعدادات التوصيل'}</button></div>
      </div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <div>
          <label style={fieldLabel}>العنوان</label>
          <input aria-label="عنوان المنتج في Trendyol" disabled={pendingDelivery} value={editing.title || ''} onChange={e => updateEditing('title', e.target.value)} style={{ ...inp, opacity:pendingDelivery ? .65 : 1 }} />
        </div>
        {activePlatform !== 'trendyol' ? <div>
          <label style={fieldLabel}>الكلمات المفتاحية</label>
          <input value={editing.keywords || ''} onChange={e => updateEditing('keywords', e.target.value)} style={inp} placeholder="مفصولة بفواصل" />
        </div> : null}
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={fieldLabel}>الوصف</label>
        <textarea aria-label="وصف المنتج في Trendyol" disabled={pendingDelivery} value={editing.description || ''} onChange={e => updateEditing('description', e.target.value)} rows={3} style={{ ...inp, minHeight: 80, opacity:pendingDelivery ? .65 : 1 }} />
      </div>
      {activePlatform !== 'trendyol' ? <div style={{ marginTop: 10 }}>
        <label style={fieldLabel}>النقاط (سطر لكل واحدة)</label>
        <textarea value={editing.bullet_points || ''} onChange={e => updateEditing('bullet_points', e.target.value)} rows={4} style={{ ...inp, minHeight: 90 }} />
      </div> : null}
      <div style={{ marginTop: 10 }}>
        <label style={fieldLabel}>روابط الصور (سطر لكل واحدة)</label>
        <textarea aria-label="روابط صور المنتج في Trendyol" disabled={pendingDelivery} value={editing.images || ''} onChange={e => updateEditing('images', e.target.value)} rows={3} style={{ ...inp, minHeight: 70, opacity:pendingDelivery ? .65 : 1 }} placeholder="https://..." />
      </div>
      {reviewMode === 'content' ? <ProductChangeReview title="راجع تعديل بيانات المنتج" changes={contentChanges} busy={saving} confirmLabel="تأكيد وإرسال إلى Trendyol" onBack={() => setReviewMode(null)} onConfirm={() => void save()} /> : null}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={reviewContentUpdate} disabled={saving || pendingDelivery} style={{ background: platformDisplayColor(activePlatform), border: 'none', color: '#fff', padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving || pendingDelivery ? 'not-allowed' : 'pointer', opacity:saving || pendingDelivery ? .65 : 1, fontFamily: 'inherit' }}>
          {pendingDelivery ? 'تعديل قيد المعالجة' : activePlatform === 'trendyol' ? 'مراجعة تعديل المنتج' : 'حفظ ' + (PLATFORM_MAP[activePlatform] || activePlatform)}
        </button>
      </div>
      {saveMessage ? <div role={saveMessage.type === 'ok' ? 'status' : 'alert'} aria-live="polite" style={{ marginTop:10, padding:'10px 12px', borderRadius:8, fontSize:12, lineHeight:1.6, background:saveMessage.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color:saveMessage.type === 'ok' ? 'var(--success-text)' : 'var(--danger-text)' }}>{saveMessage.text}</div> : null}
      <div style={{ marginTop:18, paddingTop:16, borderTop:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:10 }}>
          <div><div style={{ fontSize:13, fontWeight:700 }}>سجل تحديثات Trendyol</div><div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>آخر التحديثات الخاصة بهذا المنتج فقط.</div></div>
          <button onClick={() => void loadActionHistory()} disabled={historyLoading} style={{ border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text2)', padding:'6px 10px', borderRadius:7, fontSize:11, fontFamily:'inherit', cursor:historyLoading ? 'wait' : 'pointer' }}>{historyLoading ? 'جارٍ التحديث...' : 'تحديث السجل'}</button>
        </div>
        {historyError ? <div style={{ padding:'9px 11px', borderRadius:8, background:'var(--danger-bg)', color:'var(--danger-text)', fontSize:12 }}>{historyError}</div> : null}
        {!historyLoading && !historyError && actionHistory.length === 0 ? <div style={{ padding:'13px', borderRadius:8, background:'var(--surface2)', color:'var(--text3)', fontSize:12 }}>لم تُرسل تحديثات لهذا المنتج من Sellpert بعد.</div> : null}
        {actionHistory.length > 0 ? <div style={{ border:'1px solid var(--border)', borderRadius:9, overflow:'hidden' }}>
          {actionHistory.map((action, index) => <div key={action.id} style={{ padding:'11px 12px', borderBottom:index === actionHistory.length - 1 ? 'none' : '1px solid var(--border)', display:'flex', flexWrap:'wrap', gap:'10px 18px', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ flex:'1 1 170px', minWidth:0 }}><div style={{ fontSize:12, fontWeight:700 }}>{productActionLabel(action.action)}</div><div style={{ fontSize:11, color:'var(--text3)', marginTop:3 }}>{formatDeliveryDate(action.started_at)}</div></div>
            <div style={{ flex:'1 1 150px', minWidth:0 }}><div style={{ fontSize:12, fontWeight:600, color:deliveryStatusColor(action.status) }}>{deliveryStatusLabel(action.status)}</div>{friendlyDeliveryError(action.error_message) ? <div style={{ fontSize:11, color:'var(--danger-text)', marginTop:3 }}>{friendlyDeliveryError(action.error_message)}</div> : null}</div>
            <div style={{ flex:'0 0 auto', fontSize:11, color:'var(--text3)', direction:'ltr' }}>{shortDeliveryReference(action.external_batch_id)}</div>
          </div>)}
        </div> : null}
      </div>
    </div>
  )
}

function ProductDeliveryProgress({ status, publication = false }: { status: unknown; publication?: boolean }) {
  const normalized = String(status || '').toLowerCase()
  const terminal = ['success', 'partial', 'failed'].includes(normalized)
  const progress = terminal ? 100 : normalized === 'processing' ? 66 : normalized === 'accepted' ? 33 : 0
  const lastLabel = normalized === 'failed' ? 'يحتاج تصحيحًا' : normalized === 'partial' ? 'اعتماد جزئي' : publication ? 'اعتماد المنتج' : 'اعتماد التعديل'
  const steps = [
    { label:publication ? 'أُرسل المنتج' : 'أُرسل إلى Trendyol', reached:progress >= 33 },
    { label:publication ? 'مراجعة المنتج' : 'مراجعة المنصة', reached:progress >= 66 },
    { label:lastLabel, reached:terminal },
  ]

  return <div
    role="progressbar"
    aria-label="تقدم تعديل المنتج في Trendyol"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={progress}
    aria-valuetext={publication ? productPublicationStatusLabel(status) : deliveryStatusLabel(status)}
    style={{ marginTop:11 }}
  >
    <div aria-hidden="true" style={{ height:4, borderRadius:999, background:'var(--border)', overflow:'hidden' }}>
      <div style={{ width:`${progress}%`, height:'100%', borderRadius:999, background:normalized === 'failed' ? 'var(--danger-text)' : normalized === 'partial' ? 'var(--warning-text)' : 'var(--accent)', transition:'width 220ms ease' }} />
    </div>
    <ol style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:8, listStyle:'none', padding:0, margin:'8px 0 0' }}>
      {steps.map((step, index) => {
        const current = (normalized === 'accepted' && index === 0) || (normalized === 'processing' && index === 1) || (terminal && index === 2)
        const tone = index === 2 && normalized === 'failed' ? 'var(--danger-text)' : index === 2 && normalized === 'partial' ? 'var(--warning-text)' : 'var(--accent)'
        return <li key={step.label} aria-current={current ? 'step' : undefined} style={{ display:'flex', alignItems:'center', gap:6, minWidth:0, fontSize:10, fontWeight:step.reached ? 700 : 500, color:step.reached ? 'var(--text2)' : 'var(--text3)' }}>
          <span aria-hidden="true" style={{ width:17, height:17, flex:'0 0 17px', display:'grid', placeItems:'center', borderRadius:'50%', border:`1px solid ${step.reached ? tone : 'var(--border2)'}`, background:step.reached ? tone : 'var(--surface)', color:step.reached ? '#fff' : 'var(--text3)', fontSize:9 }}>{index + 1}</span>
          <span style={{ overflowWrap:'anywhere' }}>{step.label}</span>
        </li>
      })}
    </ol>
  </div>
}

function ProductChangeReview({ title, changes, busy, confirmLabel, onBack, onConfirm }: {
  title: string
  changes: Array<{ label: string; before: string; after: string }>
  busy: boolean
  confirmLabel: string
  onBack: () => void
  onConfirm: () => void
}) {
  return <div style={{ marginTop:12, padding:14, border:'1px solid var(--border2)', borderRadius:9, background:'var(--surface)' }}>
    <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>{title}</div>
    <div style={{ display:'grid', gap:8 }}>
      {changes.map(change => <div key={change.label} style={{ display:'grid', gap:7, padding:'9px 10px', borderRadius:8, background:'var(--surface2)' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text2)' }}>{change.label}</div>
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 20px minmax(0,1fr)', gap:8, alignItems:'start' }}>
          <div style={{ fontSize:12, color:'var(--text3)', overflowWrap:'anywhere' }}>{change.before}</div>
          <div aria-hidden="true" style={{ color:'var(--text3)', textAlign:'center' }}>←</div>
          <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', overflowWrap:'anywhere' }}>{change.after}</div>
        </div>
      </div>)}
    </div>
    <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12, flexWrap:'wrap' }}>
      <button onClick={onBack} disabled={busy} style={{ border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text2)', padding:'8px 12px', borderRadius:8, fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer' }}>العودة للتعديل</button>
      <button onClick={onConfirm} disabled={busy} style={{ border:'none', background:'var(--accent-strong)', color:'#fff', padding:'8px 14px', borderRadius:8, fontFamily:'inherit', fontSize:12, fontWeight:700, cursor:busy ? 'wait' : 'pointer' }}>{busy ? 'جارٍ الإرسال...' : confirmLabel}</button>
    </div>
  </div>
}

function deliveryStatusColor(status: unknown) {
  if (status === 'success') return 'var(--success-text)'
  if (status === 'failed' || status === 'partial') return 'var(--danger-text)'
  return 'var(--warning-text)'
}

function formatDeliveryDate(value: unknown) {
  if (!value) return 'الوقت غير متوفر'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return 'الوقت غير متوفر'
  return date.toLocaleString('ar-SA-u-nu-latn', { dateStyle:'medium', timeStyle:'short' })
}
