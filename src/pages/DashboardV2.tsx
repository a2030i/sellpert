import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowLeft, Banknote, Boxes, ChevronLeft, CircleDollarSign, Clock3, PackageCheck, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react'
import { supabase, type Merchant, type Order } from '../lib/supabase'
import { fetchAll } from '../lib/db'
import { PLATFORM_MAP } from '../lib/constants'
import { useMobile } from '../lib/hooks'
import './DashboardV2.css'

type RangeKey = '7' | '30' | '90'
type InventoryRow = { quantity: number; low_stock_threshold: number; last_updated: string; is_active: boolean }
type Payout = { platform: string; payout_date: string; amount: number; status: string }

const RANGE_LABELS: Record<RangeKey, string> = { '7': 'آخر 7 أيام', '30': 'آخر 30 يومًا', '90': 'آخر 90 يومًا' }
const STATUS_LABELS: Record<string, string> = {
  pending: 'معلّق', processing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي', returned: 'مرتجع',
}

function go(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function money(value: number, decimals = 0) {
  return value.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' ر.س'
}

function dayStart(daysAgo: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}

function Trend({ current, previous }: { current: number; previous: number }) {
  if (!previous) return <span className="db-muted">لا توجد فترة سابقة للمقارنة</span>
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const positive = pct >= 0
  return <span className={positive ? 'db-trend db-trend--up' : 'db-trend db-trend--down'}>{positive ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% عن الفترة السابقة</span>
}

export default function DashboardV2({ merchant }: { merchant: Merchant | null }) {
  const isMobile = useMobile()
  const [range, setRange] = useState<RangeKey>('30')
  const [orders, setOrders] = useState<Order[]>([])
  const [inventory, setInventory] = useState<InventoryRow[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!merchant?.merchant_code) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchAll<Order>((from, to) => supabase.from('orders')
        .select('id,merchant_code,platform,order_id,status,product_name,sku,quantity,unit_price,total_amount,platform_fee,shipping_cost,discount_amount,currency,customer_city,order_date,created_at')
        .eq('merchant_code', merchant.merchant_code)
        .order('order_date', { ascending: false }).range(from, to), 'طلبات لوحة النظرة العامة'),
      fetchAll<InventoryRow>((from, to) => supabase.from('inventory')
        .select('quantity,low_stock_threshold,last_updated,is_active')
        .eq('merchant_code', merchant.merchant_code).eq('is_active', true).range(from, to), 'مخزون لوحة النظرة العامة'),
      supabase.rpc('merchant_payouts', { p_merchant_code: merchant.merchant_code }),
      supabase.from('platform_file_uploads').select('created_at').eq('merchant_code', merchant.merchant_code).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('platform_credentials').select('last_sync_at').eq('merchant_code', merchant.merchant_code).order('last_sync_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    ]).then(([orderRows, inventoryRows, payoutResult, uploadResult, syncResult]) => {
      if (cancelled) return
      setOrders(orderRows)
      setInventory(inventoryRows)
      const payload = (payoutResult.data || {}) as { scheduled?: Payout[] }
      setPayouts((payload.scheduled || []).filter(p => p.status === 'expected'))
      const dates = [uploadResult.data?.created_at, syncResult.data?.last_sync_at].filter(Boolean) as string[]
      const sortedDates = dates.sort()
      setLastUpdated(sortedDates[sortedDates.length - 1] || orderRows[0]?.created_at || null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [merchant?.merchant_code])

  const model = useMemo(() => {
    const days = Number(range)
    const currentFrom = dayStart(days)
    const previousFrom = dayStart(days * 2)
    const current = orders.filter(o => new Date(o.order_date) >= currentFrom)
    const previous = orders.filter(o => { const d = new Date(o.order_date); return d >= previousFrom && d < currentFrom })
    const valid = (rows: Order[]) => rows.filter(o => o.status !== 'cancelled' && o.status !== 'returned')
    const sales = (rows: Order[]) => valid(rows).reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
    const net = (rows: Order[]) => valid(rows).reduce((sum, o) => sum + Number(o.total_amount || 0) - Number(o.platform_fee || 0) - Number(o.shipping_cost || 0) - Number(o.discount_amount || 0), 0)
    const byDay = new Map<string, { sales: number; net: number }>()
    for (const order of valid(current)) {
      const key = new Date(order.order_date).toISOString().slice(0, 10)
      const item = byDay.get(key) || { sales: 0, net: 0 }
      item.sales += Number(order.total_amount || 0)
      item.net += Number(order.total_amount || 0) - Number(order.platform_fee || 0) - Number(order.shipping_cost || 0) - Number(order.discount_amount || 0)
      byDay.set(key, item)
    }
    const chart = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({
      date: new Date(date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' }), ...values,
    }))
    const platformMap = new Map<string, { platform: string; orders: number; sales: number; fees: number; delivered: number }>()
    for (const order of current) {
      const row = platformMap.get(order.platform) || { platform: order.platform, orders: 0, sales: 0, fees: 0, delivered: 0 }
      row.orders += 1
      if (order.status !== 'cancelled' && order.status !== 'returned') row.sales += Number(order.total_amount || 0)
      row.fees += Number(order.platform_fee || 0) + Number(order.shipping_cost || 0)
      if (order.status === 'delivered') row.delivered += 1
      platformMap.set(order.platform, row)
    }
    return {
      current, previous, chart, platforms: [...platformMap.values()].sort((a, b) => b.sales - a.sales),
      sales: sales(current), previousSales: sales(previous), net: net(current), previousNet: net(previous),
      activeOrders: current.filter(o => ['pending', 'processing'].includes(o.status)).length,
      outOfStock: inventory.filter(i => i.quantity === 0).length,
      lowStock: inventory.filter(i => i.quantity > 0 && i.quantity <= i.low_stock_threshold).length,
      nextPayout: payouts.filter(p => new Date(p.payout_date) >= new Date()).sort((a, b) => a.payout_date.localeCompare(b.payout_date))[0],
    }
  }, [orders, inventory, payouts, range])

  const actions = [
    model.activeOrders > 0 ? { Icon: Clock3, tone: 'amber', title: `${model.activeOrders} طلبًا بانتظار التجهيز`, detail: 'راجع الطلبات المفتوحة لتجنب تأخير الشحن.', cta: 'إدارة الطلبات', path: '/orders' } : null,
    model.outOfStock > 0 ? { Icon: Boxes, tone: 'red', title: `${model.outOfStock} منتجًا نفد مخزونه`, detail: `${model.lowStock} منتجًا إضافيًا وصل إلى حد المخزون المنخفض.`, cta: 'مراجعة المخزون', path: '/inventory' } : null,
    model.nextPayout ? { Icon: Banknote, tone: 'green', title: `تحويل متوقع بقيمة ${money(Number(model.nextPayout.amount), 2)}`, detail: `${PLATFORM_MAP[model.nextPayout.platform] || model.nextPayout.platform} · ${new Date(model.nextPayout.payout_date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' })}`, cta: 'عرض التسويات', path: '/statement' } : null,
  ].filter(Boolean) as { Icon: typeof AlertTriangle; tone: string; title: string; detail: string; cta: string; path: string }[]

  if (loading) return <div className="db-loading"><RefreshCw size={20} className="db-spin" /> جارٍ إعداد نظرة متجرك…</div>

  return (
    <div className="db-page">
      <header className="db-header">
        <div><h1>نظرة عامة</h1><p>أهم ما يحتاج انتباهك اليوم، وملخص أداء متجرك.</p></div>
        <label className="db-range"><span>الفترة</span><select value={range} onChange={e => setRange(e.target.value as RangeKey)}>{Object.entries(RANGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </header>

      {actions.length > 0 ? <section className="db-attention" aria-labelledby="attention-title">
        <div className="db-section-heading"><div><h2 id="attention-title">يتطلب انتباهك</h2><p>مهام تؤثر مباشرة على الطلبات والسيولة والمخزون.</p></div><span className="db-count">{actions.length}</span></div>
        <div className="db-action-list">{actions.map(({ Icon, tone, title, detail, cta, path }) => <button key={title} className="db-action" onClick={() => go(path)}>
          <span className={`db-action-icon db-action-icon--${tone}`}><Icon size={18} /></span><span className="db-action-copy"><strong>{title}</strong><small>{detail}</small></span><span className="db-action-cta">{cta}<ChevronLeft size={16} /></span>
        </button>)}</div>
      </section> : <section className="db-all-good"><PackageCheck size={20} /><div><strong>لا توجد إجراءات عاجلة الآن</strong><span>طلباتك ومخزونك لا يحتويان على تنبيهات تستدعي إجراءً فوريًا.</span></div></section>}

      <section className="db-kpis" aria-label="ملخص الأداء">
        <Kpi Icon={ShoppingBag} label="صافي المبيعات" value={money(model.sales, 2)}><Trend current={model.sales} previous={model.previousSales} /></Kpi>
        <Kpi Icon={CircleDollarSign} label="الصافي بعد الرسوم" value={money(model.net, 2)}><Trend current={model.net} previous={model.previousNet} /></Kpi>
        <Kpi Icon={PackageCheck} label="الطلبات" value={model.current.length.toLocaleString('ar-SA-u-nu-latn')}><Trend current={model.current.length} previous={model.previous.length} /></Kpi>
        <Kpi Icon={Banknote} label="المستحق القادم" value={model.nextPayout ? money(Number(model.nextPayout.amount), 2) : 'غير محدد'}>{model.nextPayout ? <span className="db-muted">{new Date(model.nextPayout.payout_date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' })}</span> : <button className="db-text-button" onClick={() => go('/statement')}>راجع التسويات</button>}</Kpi>
      </section>

      <section className="db-panel db-chart-panel">
        <div className="db-section-heading"><div><h2>اتجاه المبيعات</h2><p>المبيعات والصافي بعد رسوم المنصة والشحن والخصومات.</p></div><div className="db-legend"><span><i className="sales" />المبيعات</span><span><i className="net" />الصافي بعد الرسوم</span></div></div>
        {model.chart.length > 0 ? <div className="db-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={model.chart} margin={{ top: 10, right: isMobile ? 0 : 12, left: isMobile ? -28 : 0, bottom: 0 }}>
          <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f958c" stopOpacity={0.2}/><stop offset="100%" stopColor="#0f958c" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tick={{ fill: 'var(--text3)', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: 'var(--text3)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${Math.round(v / 1000)}k`} /><Tooltip formatter={(v) => money(Number(v || 0), 2)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} /><Area type="monotone" dataKey="sales" name="المبيعات" stroke="#0f958c" strokeWidth={2.5} fill="url(#salesFill)" /><Area type="monotone" dataKey="net" name="الصافي" stroke="#21324f" strokeWidth={2} fill="transparent" strokeDasharray="5 4" />
        </AreaChart></ResponsiveContainer></div> : <EmptyState text="لا توجد مبيعات في الفترة المحددة." />}
      </section>

      <div className="db-bottom-grid">
        <section className="db-panel"><div className="db-section-heading"><div><h2>أداء المنصات</h2><p>مقارنة سريعة خلال الفترة المحددة.</p></div><button className="db-link" onClick={() => go('/orders')}>عرض المقارنة <ArrowLeft size={15}/></button></div>
          {model.platforms.length ? <div className="db-table-wrap"><table className="db-table"><thead><tr><th>المنصة</th><th>المبيعات</th><th>الطلبات</th><th>نسبة التسليم</th><th>الرسوم</th></tr></thead><tbody>{model.platforms.map(p => <tr key={p.platform}><td><strong>{PLATFORM_MAP[p.platform] || p.platform}</strong></td><td>{money(p.sales, 2)}</td><td>{p.orders.toLocaleString('ar-SA-u-nu-latn')}</td><td>{p.orders ? ((p.delivered / p.orders) * 100).toFixed(1) : '0.0'}%</td><td>{money(p.fees, 2)}</td></tr>)}</tbody></table></div> : <EmptyState text="لا توجد بيانات منصات لهذه الفترة." />}
        </section>

        <section className="db-panel"><div className="db-section-heading"><div><h2>آخر الطلبات</h2><p>أحدث نشاط في متجرك.</p></div><button className="db-link" onClick={() => go('/orders')}>كل الطلبات <ArrowLeft size={15}/></button></div>
          <div className="db-recent">{orders.slice(0, 5).map(order => <button key={order.id} className="db-order" onClick={() => go('/orders')}><span><strong>{order.order_id}</strong><small>{PLATFORM_MAP[order.platform] || order.platform} · {order.product_name || 'منتج غير مسمى'}</small></span><span className="db-order-meta"><strong>{money(Number(order.total_amount || 0), 2)}</strong><small className={`db-status db-status--${order.status}`}>{STATUS_LABELS[order.status] || order.status}</small></span></button>)}</div>
        </section>
      </div>

      <footer className="db-freshness"><RefreshCw size={14}/><span>آخر تحديث للبيانات: {lastUpdated ? new Date(lastUpdated).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : 'غير متاح'}</span><button onClick={() => go('/integrations')}>إدارة مصادر البيانات</button></footer>
    </div>
  )
}

function Kpi({ Icon, label, value, children }: { Icon: typeof TrendingUp; label: string; value: string; children: React.ReactNode }) {
  return <article className="db-kpi"><div className="db-kpi-top"><span>{label}</span><Icon size={19}/></div><strong className="db-kpi-value">{value}</strong><div className="db-kpi-foot">{children}</div></article>
}

function EmptyState({ text }: { text: string }) { return <div className="db-empty">{text}</div> }
