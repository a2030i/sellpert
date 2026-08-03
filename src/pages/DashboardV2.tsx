import { useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle, ArrowLeft, Banknote, Boxes, ChevronLeft, CircleDollarSign,
  ClipboardPlus, Database, Megaphone, RefreshCw, ShieldCheck, Target, WalletCards,
} from 'lucide-react'
import { supabase, type Merchant, type Order } from '../lib/supabase'
import { fetchAll } from '../lib/db'
import { PLATFORM_MAP } from '../lib/constants'
import { useMobile } from '../lib/hooks'
import { createMerchantAction, dueDateFromNow, type ActionPriority } from '../lib/merchantActions'
import { toastErr, toastInfo, toastOk } from '../components/Toast'
import './DashboardV2.css'

type RangeKey = '30' | '90' | '180'
type InventoryHealthRow = {
  sku: string | null; product_name: string | null; quantity: number; cost_price: number
  stock_value_cost: number; daily_velocity: number; sold_30d: number; days_of_stock: number | null; health_status: string
  data_as_of: string | null; data_age_days: number | null
}
type ProfitabilityRow = {
  product_id: string; sku: string | null; product_name: string | null; cost_price: number
  units_sold: number; revenue: number; platform_fees: number; ad_spend: number
  returns_amount: number; net_profit: number; profit_margin_pct: number
}
type CashflowRow = { platform: string; month: string; cash_in: number; cash_out: number; net: number; tx_count: number }
type AdSummaryRow = {
  platform: string; total_spend: number; total_gross: number; total_net: number
  gross_roas: number | null; net_roas: number | null; fee_rate: number | null; return_rate: number | null
}
type AbcRow = { abc_class: string; product_id: string; revenue: number; net_profit: number }

const RANGE_LABELS: Record<RangeKey, string> = { '30': '30 يومًا', '90': '90 يومًا', '180': '180 يومًا' }

function initialRange(): RangeKey {
  const value = new URLSearchParams(window.location.search).get('range')
  return value === '30' || value === '180' ? value : '90'
}

function go(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function money(value: number, decimals = 0) {
  return Number(value || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' ر.س'
}

function percent(value: number, decimals = 0) {
  return Number(value || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%'
}

function rangeStart(reference: Date, daysAgo: number) {
  const date = new Date(reference)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null
}

export default function DashboardV2({ merchant }: { merchant: Merchant | null }) {
  const isMobile = useMobile()
  const [range, setRange] = useState<RangeKey>(initialRange)
  const [orders, setOrders] = useState<Order[]>([])
  const [inventory, setInventory] = useState<InventoryHealthRow[]>([])
  const [profitability, setProfitability] = useState<ProfitabilityRow[]>([])
  const [cashflow, setCashflow] = useState<CashflowRow[]>([])
  const [ads, setAds] = useState<AdSummaryRow[]>([])
  const [abc, setAbc] = useState<AbcRow[]>([])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [partialData, setPartialData] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tracking, setTracking] = useState<string | null>(null)

  useEffect(() => {
    if (!merchant?.merchant_code) return
    let cancelled = false
    setLoading(true)
    const merchantCode = merchant.merchant_code
    Promise.allSettled([
      fetchAll<Order>((from, to) => supabase.from('orders')
        .select('id,merchant_code,platform,order_id,status,product_name,sku,quantity,unit_price,total_amount,platform_fee,shipping_cost,discount_amount,currency,customer_city,order_date,created_at')
        .eq('merchant_code', merchantCode).order('order_date', { ascending: false }).range(from, to), 'طلبات مركز القرارات'),
      fetchAll<InventoryHealthRow>((from, to) => supabase.from('inventory_health')
        .select('sku,product_name,quantity,cost_price,stock_value_cost,daily_velocity,sold_30d,days_of_stock,health_status,data_as_of,data_age_days')
        .eq('merchant_code', merchantCode).range(from, to), 'صحة المخزون'),
      supabase.from('platform_file_uploads').select('created_at').eq('merchant_code', merchantCode).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('platform_credentials').select('last_sync_at').eq('merchant_code', merchantCode).order('last_sync_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      supabase.from('product_profitability').select('product_id,sku,product_name,cost_price,units_sold,revenue,platform_fees,ad_spend,returns_amount,net_profit,profit_margin_pct').eq('merchant_code', merchantCode),
      supabase.from('monthly_cashflow').select('platform,month,cash_in,cash_out,net,tx_count').eq('merchant_code', merchantCode).order('month', { ascending: false }).limit(36),
      supabase.from('ad_net_summary').select('platform,total_spend,total_gross,total_net,gross_roas,net_roas,fee_rate,return_rate').eq('merchant_code', merchantCode),
      supabase.from('product_abc_analysis').select('abc_class,product_id,revenue,net_profit').eq('merchant_code', merchantCode).order('rank').limit(250),
    ]).then(results => {
      if (cancelled) return
      const orderRows = settledValue(results[0]) as Order[] | null
      const inventoryRows = settledValue(results[1]) as InventoryHealthRow[] | null
      const uploadResult = settledValue(results[2]) as { data?: { created_at?: string }; error?: unknown } | null
      const syncResult = settledValue(results[3]) as { data?: { last_sync_at?: string }; error?: unknown } | null
      const profitResult = settledValue(results[4]) as { data?: ProfitabilityRow[]; error?: unknown } | null
      const cashResult = settledValue(results[5]) as { data?: CashflowRow[]; error?: unknown } | null
      const adResult = settledValue(results[6]) as { data?: AdSummaryRow[]; error?: unknown } | null
      const abcResult = settledValue(results[7]) as { data?: AbcRow[]; error?: unknown } | null

      setOrders(orderRows || [])
      setInventory(inventoryRows || [])
      setProfitability(profitResult?.data || [])
      setCashflow(cashResult?.data || [])
      setAds(adResult?.data || [])
      setAbc(abcResult?.data || [])
      const dates = [uploadResult?.data?.created_at, syncResult?.data?.last_sync_at, orderRows?.[0]?.created_at].filter(Boolean) as string[]
      dates.sort()
      setLastUpdated(dates[dates.length - 1] || null)
      const criticalIndexes = [0, 1, 4, 5, 6, 7]
      const criticalRequestFailed = criticalIndexes.some(index => results[index].status === 'rejected')
      setPartialData(criticalRequestFailed || [profitResult, cashResult, adResult, abcResult].some(result => Boolean(result?.error)))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [merchant?.merchant_code])

  const model = useMemo(() => {
    const referenceDate = orders.reduce((latest, order) => {
      const date = new Date(order.order_date)
      return date > latest ? date : latest
    }, new Date(0))
    const validReference = referenceDate.getTime() > 0 ? referenceDate : new Date()
    const days = Number(range)
    const currentFrom = rangeStart(validReference, days - 1)
    const previousFrom = rangeStart(validReference, days * 2 - 1)
    const current = orders.filter(order => new Date(order.order_date) >= currentFrom && new Date(order.order_date) <= validReference)
    const previous = orders.filter(order => { const date = new Date(order.order_date); return date >= previousFrom && date < currentFrom })
    const valid = (rows: Order[]) => rows.filter(order => !['cancelled', 'returned'].includes(order.status))
    const sales = (rows: Order[]) => valid(rows).reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
    const contribution = (rows: Order[]) => valid(rows).reduce((sum, order) => sum + Number(order.total_amount || 0) - Number(order.platform_fee || 0) - Number(order.shipping_cost || 0) - Number(order.discount_amount || 0), 0)

    const costedProducts = profitability.filter(row => Number(row.cost_price || 0) > 0).length
    const soldProducts = profitability.filter(row => Number(row.units_sold || 0) > 0)
    const confirmedLosses = soldProducts.filter(row => Number(row.net_profit || 0) < 0).sort((a, b) => Number(a.net_profit) - Number(b.net_profit))
    const returnLeakage = profitability.reduce((sum, row) => sum + Number(row.returns_amount || 0), 0)
    const velocityCovered = inventory.filter(row => Number(row.daily_velocity || 0) > 0 || Number(row.sold_30d || 0) > 0).length
    const outOfStock = inventory.filter(row => row.health_status === 'out_of_stock').length
    const inventoryDataAgeDays = inventory.reduce((oldest, row) => row.data_age_days == null ? oldest : Math.max(oldest, Number(row.data_age_days)), 0)

    const adSpend = ads.reduce((sum, row) => sum + Number(row.total_spend || 0), 0)
    const adNet = ads.reduce((sum, row) => sum + Number(row.total_net || 0), 0)
    const adRoas = adSpend > 0 ? adNet / adSpend : 0
    const bestChannel = [...ads].filter(row => Number(row.total_spend || 0) > 0).sort((a, b) => Number(b.net_roas || 0) - Number(a.net_roas || 0))[0]

    const cashByMonth = new Map<string, { month: string; cashIn: number; cashOut: number; net: number }>()
    for (const row of cashflow) {
      const currentMonth = cashByMonth.get(row.month) || { month: row.month, cashIn: 0, cashOut: 0, net: 0 }
      currentMonth.cashIn += Number(row.cash_in || 0)
      currentMonth.cashOut += Number(row.cash_out || 0)
      currentMonth.net += Number(row.net || 0)
      cashByMonth.set(row.month, currentMonth)
    }
    const cashChart = [...cashByMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-8).map(row => ({
      ...row,
      label: new Date(`${row.month}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'short', year: '2-digit' }),
    }))
    const latestCash = cashChart[cashChart.length - 1]

    const abcRevenue = abc.reduce((sum, row) => sum + Number(row.revenue || 0), 0)
    const classA = abc.filter(row => row.abc_class === 'A')
    const classARevenue = classA.reduce((sum, row) => sum + Number(row.revenue || 0), 0)
    const concentration = abcRevenue > 0 ? (classARevenue / abcRevenue) * 100 : 0
    return {
      current, previous, referenceDate: validReference, sales: sales(current), previousSales: sales(previous),
      contribution: contribution(current), previousContribution: contribution(previous),
      costedProducts, costCoverage: profitability.length ? costedProducts / profitability.length * 100 : 0,
      totalProducts: profitability.length, soldProducts: soldProducts.length, confirmedLosses,
      returnLeakage, velocityCoverage: inventory.length ? velocityCovered / inventory.length * 100 : 0,
      inventoryItems: inventory.length, outOfStock, inventoryDataAgeDays, adSpend, adNet, adRoas, bestChannel,
      cashChart, latestCash, classAProducts: classA.length, concentration,
    }
  }, [orders, inventory, profitability, cashflow, ads, abc, range])

  const decisions = useMemo(() => [
    model.costCoverage < 100 ? {
      Icon: Database, tone: 'red', priority: 'أولوية قصوى',
      title: `أدخل تكلفة الشراء لـ ${(model.totalProducts - model.costedProducts).toLocaleString('ar-SA-u-nu-latn')} منتج`,
      detail: 'بدون التكلفة لا يمكن اعتماد صافي الربح أو هامش المنتج أو قرار زيادة الإعلان.',
      impact: 'يفتح الربحية الحقيقية', cta: 'استكمال التكاليف', path: '/products?costs=import',
      sourceKey: 'cost_coverage', category: 'profitability', actionPriority: 'urgent' as ActionPriority,
    } : null,
    model.velocityCoverage === 0 && model.inventoryItems > 0 ? {
      Icon: Boxes, tone: 'amber', priority: 'جودة بيانات',
      title: 'اربط حركة البيع بالمخزون قبل قرارات إعادة الطلب',
      detail: `${model.outOfStock.toLocaleString('ar-SA-u-nu-latn')} صنفًا يظهر نافدًا، لكن سرعة البيع غير محسوبة؛ إعادة الشراء الآن قد تكون قرارًا مضللًا.`,
      impact: 'يمنع شراء مخزون راكد', cta: 'مراجعة المخزون', path: '/inventory',
      sourceKey: 'inventory_velocity_missing', category: 'inventory', actionPriority: 'high' as ActionPriority,
    } : model.inventoryDataAgeDays > 2 ? {
      Icon: RefreshCw, tone: 'amber', priority: 'تحديث مطلوب',
      title: `بيانات حركة المخزون متأخرة ${model.inventoryDataAgeDays.toLocaleString('ar-SA-u-nu-latn')} يومًا`,
      detail: 'تم احتساب السرعة من آخر نافذة مبيعات متاحة، لكن قرارات إعادة الطلب تحتاج مزامنة حديثة.',
      impact: 'قرارات شراء أحدث', cta: 'تحديث البيانات', path: '/integrations',
      sourceKey: 'inventory_data_stale', category: 'data_quality', actionPriority: 'high' as ActionPriority,
    } : null,
    model.confirmedLosses.length > 0 ? {
      Icon: AlertTriangle, tone: 'red', priority: 'خسارة مؤكدة',
      title: `${model.confirmedLosses.length.toLocaleString('ar-SA-u-nu-latn')} منتجات خاسرة حتى قبل احتساب تكلفة الشراء`,
      detail: `المرتجعات سحبت ${money(model.returnLeakage, 2)} من قيمة المنتجات المسجلة.`,
      impact: 'إيقاف تسرب نقدي', cta: 'فحص المنتجات', path: '/products',
      sourceKey: 'confirmed_product_losses', category: 'profitability', actionPriority: 'urgent' as ActionPriority,
    } : null,
    model.bestChannel ? {
      Icon: Megaphone, tone: 'green', priority: 'فرصة نمو',
      title: `${PLATFORM_MAP[model.bestChannel.platform] || model.bestChannel.platform} يحقق أعلى عائد إعلاني صافي`,
      detail: `${Number(model.bestChannel.net_roas || 0).toFixed(2)}× بعد الرسوم والمرتجعات المتاحة، وقبل تكلفة المنتج.`,
      impact: 'توجيه أفضل للميزانية', cta: 'تحليل الإعلانات', path: '/marketing',
      sourceKey: `best_ad_channel:${model.bestChannel.platform}`, category: 'marketing', actionPriority: 'medium' as ActionPriority,
    } : null,
  ].filter(Boolean) as { Icon: typeof AlertTriangle; tone: string; priority: string; title: string; detail: string; impact: string; cta: string; path: string; sourceKey: string; category: string; actionPriority: ActionPriority }[], [model])

  async function trackDecision(decision: typeof decisions[number]) {
    if (!merchant?.merchant_code) return
    setTracking(decision.sourceKey)
    try {
      const result = await createMerchantAction({
        sourceKey: decision.sourceKey,
        title: decision.title,
        category: decision.category,
        priority: decision.actionPriority,
        note: decision.detail,
        expectedImpact: decision.impact,
        details: { source: 'decision_center', destination: decision.path },
        dueDate: dueDateFromNow(decision.actionPriority === 'urgent' ? 3 : 7),
      })
      if (result.created) toastOk('أُضيف القرار إلى خطة العمل')
      else toastInfo('هذا القرار موجود بالفعل في خطة العمل')
    } catch {
      toastErr('تعذر إضافة القرار إلى خطة العمل')
    } finally {
      setTracking(null)
    }
  }

  function changeRange(value: RangeKey) {
    setRange(value)
    const url = new URL(window.location.href)
    url.searchParams.set('range', value)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  if (loading) return <div className="db-loading"><RefreshCw size={20} className="db-spin" /> جارٍ بناء مركز قرارات متجرك…</div>

  return (
    <div className="db-page">
      <header className="db-header">
        <div><h1>مركز قرارات المتجر</h1><p>ما يحتاج قرارًا الآن، وما يمكن الوثوق به قبل زيادة المخزون أو الإعلان.</p></div>
        <label className="db-range"><span>فترة الطلبات</span><select value={range} onChange={event => changeRange(event.target.value as RangeKey)}>{Object.entries(RANGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </header>

      {partialData ? <div className="db-data-state db-data-state--partial"><AlertTriangle size={16} /><span>بعض المصادر لم تستجب. تظهر آخر بيانات متاحة، وقد تكون بعض المؤشرات ناقصة.</span></div> : null}

      <section className="db-trust" aria-labelledby="trust-title">
        <div className="db-trust-copy"><span className="db-eyebrow"><ShieldCheck size={14} /> موثوقية القرار</span><h2 id="trust-title">لا تعتمد صافي الربح حتى تكتمل تكاليف المنتجات</h2><p>المبيعات والرسوم والتدفقات النقدية متاحة، لكن تكلفة الشراء مكتملة في {percent(model.costCoverage)} فقط من المنتجات.</p></div>
        <div className="db-coverage-grid">
          <Coverage label="تكلفة المنتجات" value={model.costCoverage} detail={`${model.costedProducts} من ${model.totalProducts}`} tone={model.costCoverage === 100 ? 'good' : 'critical'} />
          <Coverage label="ربط حركة المخزون" value={model.velocityCoverage} detail={`${model.inventoryItems} صنفًا${model.inventoryDataAgeDays ? ` · متأخرة ${model.inventoryDataAgeDays} يومًا` : ''}`} tone={model.velocityCoverage > 70 && model.inventoryDataAgeDays <= 2 ? 'good' : 'warning'} />
        </div>
      </section>

      <section className="db-kpis" aria-label="ملخص القيمة التجارية">
        <Kpi Icon={CircleDollarSign} label="المساهمة بعد رسوم البيع" value={money(model.contribution, 2)} note="قبل تكلفة المنتج والإعلان"><Trend current={model.contribution} previous={model.previousContribution} /></Kpi>
        <Kpi Icon={WalletCards} label="صافي التدفق النقدي الأخير" value={model.latestCash ? money(model.latestCash.net, 2) : 'غير متاح'} note={model.latestCash ? new Date(`${model.latestCash.month}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' }) : 'لا توجد معاملات'}><span className="db-muted">دخل {money(model.latestCash?.cashIn || 0)} · خرج {money(model.latestCash?.cashOut || 0)}</span></Kpi>
        <Kpi Icon={Megaphone} label="عائد الإعلان الصافي" value={model.adSpend ? `${model.adRoas.toFixed(2)}×` : 'غير متاح'} note="بعد الخصومات المتاحة وقبل تكلفة المنتج"><span className="db-muted">إنفاق {money(model.adSpend, 2)}</span></Kpi>
        <Kpi Icon={Target} label="تركيز الإيراد" value={model.classAProducts ? percent(model.concentration, 1) : 'غير متاح'} note={`من ${model.classAProducts} منتجًا من الفئة A`}><span className="db-muted">حماية توفرها أولوية تشغيلية</span></Kpi>
      </section>

      <section className="db-attention" aria-labelledby="decisions-title">
        <div className="db-section-heading"><div><h2 id="decisions-title">قرارات مرتبة حسب الأثر</h2><p>كل بند يوضح لماذا يهم وما النتيجة المتوقعة من معالجته.</p></div><span className="db-count">{decisions.length}</span></div>
        <div className="db-action-list">{decisions.map(decision => <div key={decision.sourceKey} className="db-action">
          <span className={`db-action-icon db-action-icon--${decision.tone}`}><decision.Icon size={18} /></span>
          <span className="db-action-copy"><small className="db-priority">{decision.priority}</small><strong>{decision.title}</strong><span>{decision.detail}</span></span>
          <span className="db-impact"><small>الأثر</small><strong>{decision.impact}</strong></span>
          <span className="db-action-buttons"><button className="db-track" disabled={tracking === decision.sourceKey} onClick={() => void trackDecision(decision)}><ClipboardPlus size={14} />{tracking === decision.sourceKey ? 'جارٍ الإضافة' : 'إضافة للمتابعة'}</button><button className="db-action-cta" onClick={() => go(decision.path)}>{decision.cta}<ChevronLeft size={16} /></button></span>
        </div>)}</div>
        <button className="db-plan-link" onClick={() => go('/actions')}>عرض خطة العمل كاملة <ChevronLeft size={15} /></button>
      </section>

      <div className="db-analysis-grid">
        <section className="db-panel db-cash-panel">
          <div className="db-section-heading"><div><h2>حركة النقد الفعلية</h2><p>المبالغ الداخلة والخارجة من معاملات المنصات، وليست مبيعات دفترية.</p></div><button className="db-link" onClick={() => go('/statement')}>التفاصيل المالية <ArrowLeft size={15} /></button></div>
          {model.cashChart.length ? <>
            <div className="db-chart" role="img" aria-label="رسم التدفق النقدي الشهري"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={model.cashChart} margin={{ top: 12, right: isMobile ? 0 : 12, left: isMobile ? -26 : 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fill: 'var(--text3)', fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: 'var(--text3)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={value => Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value).toString()} />
              <Tooltip formatter={(value, name) => [money(Number(value || 0), 2), name === 'cashIn' ? 'التدفق الداخل' : name === 'cashOut' ? 'التدفق الخارج' : 'الصافي']} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Bar dataKey="cashIn" name="cashIn" fill="#0f958c" radius={[3, 3, 0, 0]} /><Bar dataKey="cashOut" name="cashOut" fill="#d7a14a" radius={[3, 3, 0, 0]} /><Line type="monotone" dataKey="net" name="net" stroke="#20334f" strokeWidth={2.5} dot={{ r: 3, fill: '#20334f' }} />
            </ComposedChart></ResponsiveContainer></div>
            <div className="db-legend"><span><i className="cash-in" />داخل</span><span><i className="cash-out" />خارج</span><span><i className="cash-net" />الصافي</span></div>
          </> : <EmptyState text="لا توجد معاملات مالية كافية لبناء اتجاه نقدي." />}
        </section>

        <section className="db-panel">
          <div className="db-section-heading"><div><h2>اقتصاديات قنوات البيع</h2><p>العائد الصافي من الإعلان بعد الرسوم والمرتجعات المتاحة، وقبل تكلفة المنتج.</p></div><button className="db-link" onClick={() => go('/marketing')}>تحليل أعمق <ArrowLeft size={15} /></button></div>
          {ads.length ? <div className="db-channel-list">{[...ads].sort((a, b) => Number(b.net_roas || 0) - Number(a.net_roas || 0)).map((row, index) => <div className="db-channel" key={row.platform}>
            <div><strong>{PLATFORM_MAP[row.platform] || row.platform}</strong>{index === 0 ? <small className="db-best">الأعلى حاليًا</small> : null}</div>
            <Metric label="الإنفاق" value={money(row.total_spend, 2)} /><Metric label="صافي الإيراد" value={money(row.total_net, 2)} /><Metric label="العائد الصافي" value={`${Number(row.net_roas || 0).toFixed(2)}×`} /><Metric label="المرتجعات" value={row.return_rate == null ? 'غير متاح' : percent(Number(row.return_rate) * 100, 1)} />
          </div>)}</div> : <EmptyState text="ارفع تقرير الإعلانات لقياس العائد الصافي لكل قناة." />}
        </section>
      </div>

      <section className="db-panel db-loss-panel">
        <div className="db-section-heading"><div><h2>تسرب الربحية المؤكد</h2><p>منتجات أصبحت سالبة حتى قبل احتساب تكلفة الشراء؛ لذا تحتاج مراجعة فورية.</p></div><button className="db-link" onClick={() => go('/products')}>كل المنتجات <ArrowLeft size={15} /></button></div>
        {model.confirmedLosses.length ? <div className="db-loss-list">{model.confirmedLosses.slice(0, 6).map(row => <button key={row.product_id} onClick={() => go(`/product-detail?id=${row.product_id}`)} className="db-loss-row">
          <span><strong>{row.product_name || row.sku || 'منتج غير مسمى'}</strong><small>SKU: {row.sku || 'غير متاح'}</small></span>
          <Metric label="المبيعات" value={money(row.revenue, 2)} /><Metric label="المرتجعات" value={money(row.returns_amount, 2)} /><Metric label="النتيجة قبل التكلفة" value={money(row.net_profit, 2)} danger />
          <ChevronLeft size={16} />
        </button>)}</div> : <EmptyState text="لا توجد منتجات سالبة مؤكدة ضمن البيانات الحالية." />}
      </section>

      <footer className="db-freshness"><RefreshCw size={14} /><span>آخر تحديث للمصادر: {lastUpdated ? new Date(lastUpdated).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : 'غير متاح'}</span><span>· فترة الطلبات تنتهي في {model.referenceDate.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' })}</span><button onClick={() => go('/integrations')}>إدارة مصادر البيانات</button></footer>
    </div>
  )
}

function Trend({ current, previous }: { current: number; previous: number }) {
  if (!previous) return <span className="db-muted">لا توجد فترة سابقة قابلة للمقارنة</span>
  if (Math.abs(previous) < 100 && Math.abs(current) > Math.abs(previous) * 5) {
    return <span className="db-muted">المقارنة غير مستقرة لأن الفترة السابقة منخفضة جدًا</span>
  }
  const change = ((current - previous) / Math.abs(previous)) * 100
  return <span className={change >= 0 ? 'db-trend db-trend--up' : 'db-trend db-trend--down'}>{change >= 0 ? 'ارتفاع' : 'انخفاض'} {Math.abs(change).toFixed(1)}% عن الفترة السابقة</span>
}

function Kpi({ Icon, label, value, note, children }: { Icon: typeof Banknote; label: string; value: string; note: string; children: React.ReactNode }) {
  return <article className="db-kpi"><div className="db-kpi-top"><span>{label}</span><Icon size={19} /></div><strong className="db-kpi-value">{value}</strong><span className="db-kpi-note">{note}</span><div className="db-kpi-foot">{children}</div></article>
}

function Coverage({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: 'good' | 'warning' | 'critical' }) {
  return <div className="db-coverage"><div><strong>{label}</strong><span>{detail}</span></div><b>{percent(value)}</b><div className="db-progress" aria-label={`${label}: ${percent(value)}`}><i className={`db-progress--${tone}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div></div>
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <span className="db-metric"><small>{label}</small><strong className={danger ? 'db-negative' : ''}>{value}</strong></span>
}

function EmptyState({ text }: { text: string }) { return <div className="db-empty">{text}</div> }
