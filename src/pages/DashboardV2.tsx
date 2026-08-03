import { useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity, AlertTriangle, ArrowLeft, Banknote, Boxes, ChevronLeft, CircleDollarSign,
  ClipboardPlus, Database, Megaphone, RefreshCw, Target, TrendingUp, WalletCards,
} from 'lucide-react'
import { supabase, type Merchant, type Order, type PlatformCredential } from '../lib/supabase'
import { listPlatformCredentials } from '../lib/platformCredentialManager'
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
type HealthConfidence = 'low' | 'medium' | 'high'
type HealthDimension = { available: boolean; score: number | null; weight: number; [key: string]: unknown }
type MerchantHealth = {
  score: number | null
  rating: 'excellent' | 'good' | 'watch' | 'critical' | 'insufficient'
  confidence: HealthConfidence
  coverage_pct: number
  data_as_of: string | null
  data_age_days: number | null
  breakdown: Record<'readiness' | 'profitability' | 'inventory' | 'demand' | 'marketing', HealthDimension>
}
type SalesForecast = {
  last_30_sales: number
  forecast_30: number
  lower_30: number
  upper_30: number
  growth_rate_pct: number | null
  confidence: HealthConfidence
  is_actionable: boolean
  observed_days: number
  active_days: number
  data_as_of: string | null
  data_age_days: number | null
  caveat: string
}
type ExecutiveBrief = {
  available: boolean
  confidence: HealthConfidence
  evidence_coverage_pct: number
  data_as_of: string | null
  data_age_days: number | null
  period: { start: string | null; end: string | null; previous_start: string | null; previous_end: string | null }
  week: {
    sales: number; previous_sales: number; sales_change_pct: number | null
    orders: number; previous_orders: number; units: number; average_order_value: number
    contribution_before_product_cost: number; previous_contribution_before_product_cost: number
    contribution_change_pct: number | null; cancelled_or_returned_orders: number
    exception_rate_pct: number | null; previous_exception_rate_pct: number | null
  }
  confirmed_deductions: {
    platform_fees: number; shipping: number; discounts: number
    return_claims_count: number; return_claims_amount: number; total_excluding_returns: number
  }
  inventory_risk: {
    available: boolean; items: number; fresh_items: number; cost_coverage_pct: number
    stockout_skus: number; stockout_historical_30d_demand_value: number
    slow_stock_value: number; unanalysed_stock_value: number
  }
  profitability: {
    available: boolean; sold_products: number; costed_products: number
    cost_coverage_pct: number; net_profit: number | null; net_margin_pct: number | null
    minimum_coverage_pct: number
  }
  cash: { available: boolean; month: string | null; cash_in: number; cash_out: number; net: number }
  top_priority: {
    source_key: string; title: string; detail: string; path: string
    priority: ActionPriority; category: string; actionable: boolean
  }
}
type GoalStatus = 'not_set' | 'ahead' | 'on_track' | 'behind'
type MonthlyGoal = {
  year: number; month: number; month_start: string; month_end: string
  target_amount: number | null; actual_sales: number; attainment_pct: number | null
  calendar_pace_pct: number; projected_sales: number; gap_amount: number | null
  days_remaining: number; required_daily_sales: number | null; active_order_days: number
  status: GoalStatus; is_reliable: boolean
}
type WeeklyBriefRow = {
  id: string; week_start: string; week_end: string; source_data_as_of: string
  actual_sales: number; monthly_target: number | null; target_attainment_pct: number | null
  target_pace_pct: number | null; target_status: GoalStatus; created_at: string; updated_at: string
}

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
  const [health, setHealth] = useState<MerchantHealth | null>(null)
  const [forecast, setForecast] = useState<SalesForecast | null>(null)
  const [executiveBrief, setExecutiveBrief] = useState<ExecutiveBrief | null>(null)
  const [monthlyGoal, setMonthlyGoal] = useState<MonthlyGoal | null>(null)
  const [weeklyHistory, setWeeklyHistory] = useState<WeeklyBriefRow[]>([])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [partialData, setPartialData] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tracking, setTracking] = useState<string | null>(null)
  const [savingTarget, setSavingTarget] = useState(false)

  useEffect(() => {
    if (!merchant?.merchant_code) return
    let cancelled = false
    setLoading(true)
    const merchantCode = merchant.merchant_code
    const weeklyHistoryPromise = supabase.rpc('capture_my_weekly_brief').then(() =>
      supabase.from('merchant_weekly_briefs')
        .select('id,week_start,week_end,source_data_as_of,actual_sales,monthly_target,target_attainment_pct,target_pace_pct,target_status,created_at,updated_at')
        .eq('merchant_code', merchantCode).order('week_start', { ascending: false }).limit(8)
    )
    Promise.allSettled([
      fetchAll<Order>((from, to) => supabase.from('orders')
        .select('id,merchant_code,platform,order_id,status,product_name,sku,quantity,unit_price,total_amount,platform_fee,shipping_cost,discount_amount,currency,customer_city,order_date,created_at')
        .eq('merchant_code', merchantCode).order('order_date', { ascending: false }).range(from, to), 'طلبات مركز القرارات'),
      fetchAll<InventoryHealthRow>((from, to) => supabase.from('inventory_health')
        .select('sku,product_name,quantity,cost_price,stock_value_cost,daily_velocity,sold_30d,days_of_stock,health_status,data_as_of,data_age_days')
        .eq('merchant_code', merchantCode).range(from, to), 'صحة المخزون'),
      supabase.from('platform_file_uploads').select('uploaded_at').eq('merchant_code', merchantCode).order('uploaded_at', { ascending: false }).limit(1).maybeSingle(),
      listPlatformCredentials(merchantCode),
      supabase.from('product_profitability').select('product_id,sku,product_name,cost_price,units_sold,revenue,platform_fees,ad_spend,returns_amount,net_profit,profit_margin_pct').eq('merchant_code', merchantCode),
      supabase.from('monthly_cashflow').select('platform,month,cash_in,cash_out,net,tx_count').eq('merchant_code', merchantCode).order('month', { ascending: false }).limit(36),
      supabase.from('ad_net_summary').select('platform,total_spend,total_gross,total_net,gross_roas,net_roas,fee_rate,return_rate').eq('merchant_code', merchantCode),
      supabase.from('product_abc_analysis').select('abc_class,product_id,revenue,net_profit').eq('merchant_code', merchantCode).order('rank').limit(250),
      supabase.rpc('merchant_health_score', { p_merchant_code: merchantCode }),
      supabase.rpc('revenue_forecast', { p_merchant_code: merchantCode }),
      supabase.rpc('merchant_executive_brief', { p_merchant_code: merchantCode }),
      supabase.rpc('my_monthly_goal_progress'),
      weeklyHistoryPromise,
    ]).then(results => {
      if (cancelled) return
      const orderRows = settledValue(results[0]) as Order[] | null
      const inventoryRows = settledValue(results[1]) as InventoryHealthRow[] | null
      const uploadResult = settledValue(results[2]) as { data?: { uploaded_at?: string }; error?: unknown } | null
      const syncCredentials = settledValue(results[3]) as PlatformCredential[] | null
      const sortedSyncTimes = (syncCredentials || []).map(item => item.last_sync_at).filter((value): value is string => Boolean(value)).sort()
      const latestSyncAt = sortedSyncTimes[sortedSyncTimes.length - 1]
      const syncResult = { data: latestSyncAt ? { last_sync_at: latestSyncAt } : null }
      const profitResult = settledValue(results[4]) as { data?: ProfitabilityRow[]; error?: unknown } | null
      const cashResult = settledValue(results[5]) as { data?: CashflowRow[]; error?: unknown } | null
      const adResult = settledValue(results[6]) as { data?: AdSummaryRow[]; error?: unknown } | null
      const abcResult = settledValue(results[7]) as { data?: AbcRow[]; error?: unknown } | null
      const healthResult = settledValue(results[8]) as { data?: MerchantHealth; error?: unknown } | null
      const forecastResult = settledValue(results[9]) as { data?: SalesForecast; error?: unknown } | null
      const executiveResult = settledValue(results[10]) as { data?: ExecutiveBrief; error?: unknown } | null
      const goalResult = settledValue(results[11]) as { data?: MonthlyGoal; error?: unknown } | null
      const historyResult = settledValue(results[12]) as { data?: WeeklyBriefRow[]; error?: unknown } | null

      setOrders(orderRows || [])
      setInventory(inventoryRows || [])
      setProfitability(profitResult?.data || [])
      setCashflow(cashResult?.data || [])
      setAds(adResult?.data || [])
      setAbc(abcResult?.data || [])
      setHealth(healthResult?.data || null)
      setForecast(forecastResult?.data || null)
      setExecutiveBrief(executiveResult?.data || null)
      setMonthlyGoal(goalResult?.data || null)
      setWeeklyHistory(historyResult?.data || [])
      const dates = [uploadResult?.data?.uploaded_at, syncResult?.data?.last_sync_at, orderRows?.[0]?.created_at].filter(Boolean) as string[]
      dates.sort()
      setLastUpdated(dates[dates.length - 1] || null)
      const criticalIndexes = [0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      const criticalRequestFailed = criticalIndexes.some(index => results[index].status === 'rejected')
      setPartialData(criticalRequestFailed || [profitResult, cashResult, adResult, abcResult, healthResult, forecastResult, executiveResult, goalResult, historyResult].some(result => Boolean(result?.error)))
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
    model.totalProducts > 0 && model.costCoverage < 100 ? {
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

  async function trackExecutivePriority() {
    const brief = executiveBrief
    const priority = brief?.top_priority
    if (!merchant?.merchant_code || !brief || !priority?.actionable) return
    setTracking(priority.source_key)
    try {
      const result = await createMerchantAction({
        sourceKey: priority.source_key,
        title: priority.title,
        category: priority.category,
        priority: priority.priority,
        note: priority.detail,
        expectedImpact: 'تحسين المؤشر التشغيلي الأعلى أولوية',
        details: { source: 'weekly_executive_brief', destination: priority.path, data_as_of: brief.data_as_of },
        dueDate: dueDateFromNow(priority.priority === 'urgent' ? 3 : 7),
      })
      if (result.created) toastOk('أُضيفت الأولوية الأسبوعية إلى خطة العمل')
      else toastInfo('هذه الأولوية موجودة بالفعل في خطة العمل')
    } catch {
      toastErr('تعذر إضافة الأولوية الأسبوعية إلى خطة العمل')
    } finally {
      setTracking(null)
    }
  }

  async function saveMonthlyTarget(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
      toastErr('أدخل هدفًا صحيحًا أكبر من صفر')
      return
    }
    const now = new Date()
    setSavingTarget(true)
    try {
      const { error } = await supabase.rpc('set_my_monthly_sales_target', {
        p_year: now.getFullYear(), p_month: now.getMonth() + 1, p_target_amount: amount,
      })
      if (error) throw error
      const [{ data: goal, error: goalError }, captureResult] = await Promise.all([
        supabase.rpc('my_monthly_goal_progress'),
        supabase.rpc('capture_my_weekly_brief'),
      ])
      if (goalError || captureResult.error) throw goalError || captureResult.error
      const { data: history, error: historyError } = await supabase.from('merchant_weekly_briefs')
        .select('id,week_start,week_end,source_data_as_of,actual_sales,monthly_target,target_attainment_pct,target_pace_pct,target_status,created_at,updated_at')
        .eq('merchant_code', merchant!.merchant_code).order('week_start', { ascending: false }).limit(8)
      if (historyError) throw historyError
      setMonthlyGoal(goal as MonthlyGoal)
      setWeeklyHistory((history || []) as WeeklyBriefRow[])
      toastOk('تم حفظ هدف المبيعات وتحديث متابعة الأسبوع')
    } catch {
      toastErr('تعذر حفظ هدف المبيعات')
    } finally {
      setSavingTarget(false)
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

      <section className="db-intelligence-grid" aria-label="صحة المتجر والتوقع">
        <HealthPanel health={health} />
        <ForecastPanel forecast={forecast} />
      </section>

      <ExecutiveBriefPanel
        brief={executiveBrief}
        goal={monthlyGoal}
        history={weeklyHistory}
        savingTarget={savingTarget}
        onSaveTarget={amount => void saveMonthlyTarget(amount)}
        tracking={tracking === executiveBrief?.top_priority.source_key}
        onTrack={() => void trackExecutivePriority()}
      />

      <section className="db-kpis" aria-label="ملخص القيمة التجارية">
        <Kpi Icon={CircleDollarSign} label="المساهمة بعد رسوم البيع" value={money(model.contribution, 2)} note="قبل تكلفة المنتج والإعلان"><Trend current={model.contribution} previous={model.previousContribution} /></Kpi>
        <Kpi Icon={WalletCards} label="صافي التدفق النقدي الأخير" value={model.latestCash ? money(model.latestCash.net, 2) : 'غير متاح'} note={model.latestCash ? new Date(`${model.latestCash.month}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' }) : 'لا توجد معاملات'}><span className="db-muted">دخل {money(model.latestCash?.cashIn || 0)} · خرج {money(model.latestCash?.cashOut || 0)}</span></Kpi>
        <Kpi Icon={Megaphone} label="عائد الإعلان الصافي" value={model.adSpend ? `${model.adRoas.toFixed(2)}×` : 'غير متاح'} note="بعد الخصومات المتاحة وقبل تكلفة المنتج"><span className="db-muted">إنفاق {money(model.adSpend, 2)}</span></Kpi>
        <Kpi Icon={Target} label="تركيز الإيراد" value={model.classAProducts ? percent(model.concentration, 1) : 'غير متاح'} note={`من ${model.classAProducts} منتجًا من الفئة A`}><span className="db-muted">حماية توفرها أولوية تشغيلية</span></Kpi>
      </section>

      <section className="db-attention" aria-labelledby="decisions-title">
        <div className="db-section-heading"><div><h2 id="decisions-title">قرارات مرتبة حسب الأثر</h2><p>كل بند يوضح لماذا يهم وما النتيجة المتوقعة من معالجته.</p></div><span className="db-count">{decisions.length}</span></div>
        <div className="db-action-list">{decisions.length === 0 ? <div className="db-no-decisions"><strong>لا توجد قرارات عاجلة الآن</strong><span>سيضيف النظام البنود هنا عند ظهور نقص بيانات أو خطر تشغيلي أو فرصة قابلة للقياس.</span></div> : decisions.map(decision => <div key={decision.sourceKey} className="db-action">
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

function ExecutiveBriefPanel({ brief, goal, history, savingTarget, onSaveTarget, tracking, onTrack }: {
  brief: ExecutiveBrief | null; goal: MonthlyGoal | null; history: WeeklyBriefRow[]
  savingTarget: boolean; onSaveTarget: (amount: number) => void
  tracking: boolean; onTrack: () => void
}) {
  const periodLabel = brief?.period.start && brief.period.end
    ? `${new Date(`${brief.period.start}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' })} – ${new Date(`${brief.period.end}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : 'آخر أسبوع مكتمل في البيانات'
  const priority = brief?.top_priority

  return <section className="db-panel db-executive" aria-labelledby="executive-title">
    <div className="db-executive-head">
      <div><span className="db-eyebrow"><Banknote size={14} /> ملخص أسبوعي موحد</span><h2 id="executive-title">الملخص التنفيذي</h2><p>{periodLabel} · يقارن بالأيام السبعة السابقة مباشرة.</p></div>
      {brief ? <div className="db-executive-trust"><span className={`db-confidence db-confidence--${brief.confidence}`}>{CONFIDENCE_LABELS[brief.confidence]}</span><small>تغطية الأدلة {percent(brief.evidence_coverage_pct)}</small></div> : null}
    </div>

    {!brief || !brief.available ? <div className="db-executive-empty"><strong>لا يوجد أسبوع قابل للتحليل بعد</strong><p>اربط قناة البيع أو ارفع ملف الطلبات، ثم سيظهر الأداء والاستقطاعات والأولوية التشغيلية هنا.</p><button onClick={() => go('/integrations')}>إدارة مصادر البيانات <ChevronLeft size={15} /></button></div> : <>
      {priority ? <div className={`db-executive-priority db-executive-priority--${priority.actionable ? priority.priority : 'stable'}`}>
        <div><small>{priority.actionable ? 'الأولوية الأولى لهذا الأسبوع' : 'الوضع التشغيلي'}</small><strong>{priority.title}</strong><p>{priority.detail}</p></div>
        <div className="db-executive-priority-actions">
          {priority.actionable ? <button className="db-track" disabled={tracking} onClick={onTrack}><ClipboardPlus size={14} />{tracking ? 'جارٍ الإضافة' : 'إضافة للمتابعة'}</button> : null}
          <button className="db-action-cta" onClick={() => go(priority.path)}>{priority.actionable ? 'تنفيذ الإجراء' : 'عرض خطة العمل'}<ChevronLeft size={15} /></button>
        </div>
      </div> : null}

      <div className="db-executive-metrics">
        <ExecutiveMetric label="مبيعات الأسبوع" value={money(brief.week.sales, 2)} delta={brief.week.sales_change_pct} note={`${brief.week.orders.toLocaleString('ar-SA-u-nu-latn')} طلبًا مكتملًا`} />
        <ExecutiveMetric label="بعد استقطاعات البيع" value={money(brief.week.contribution_before_product_cost, 2)} delta={brief.week.contribution_change_pct} note="قبل تكلفة المنتج والإعلان" />
        <ExecutiveMetric label="متوسط الطلب" value={money(brief.week.average_order_value, 2)} note={`${Number(brief.week.units || 0).toLocaleString('ar-SA-u-nu-latn')} وحدة مباعة`} />
        <ExecutiveMetric label="إلغاءات ومرتجعات الطلبات" value={brief.week.exception_rate_pct == null ? 'غير متاح' : percent(brief.week.exception_rate_pct, 1)} delta={brief.week.previous_exception_rate_pct == null || brief.week.exception_rate_pct == null ? null : brief.week.exception_rate_pct - brief.week.previous_exception_rate_pct} inverse note={`${brief.week.cancelled_or_returned_orders.toLocaleString('ar-SA-u-nu-latn')} طلبًا في الفترة`} />
      </div>

      <div className="db-executive-details">
        <article className="db-executive-block">
          <header><div><h3>الاستقطاعات المؤكدة</h3><p>لا تشمل تكلفة المنتج أو الإعلان أو مرتجعات غير مسجلة.</p></div><strong>{money(brief.confirmed_deductions.total_excluding_returns, 2)}</strong></header>
          <div className="db-deduction-list">
            <ExecutiveLine label="عمولات ورسوم المنصة" value={money(brief.confirmed_deductions.platform_fees, 2)} total={brief.week.sales} amount={brief.confirmed_deductions.platform_fees} />
            <ExecutiveLine label="تكلفة الشحن المسجلة" value={money(brief.confirmed_deductions.shipping, 2)} total={brief.week.sales} amount={brief.confirmed_deductions.shipping} />
            <ExecutiveLine label="الخصومات" value={money(brief.confirmed_deductions.discounts, 2)} total={brief.week.sales} amount={brief.confirmed_deductions.discounts} />
            <div className="db-executive-line db-executive-line--plain"><span>مطالبات مرتجعات منفصلة</span><strong>{brief.confirmed_deductions.return_claims_count ? `${money(brief.confirmed_deductions.return_claims_amount, 2)} · ${brief.confirmed_deductions.return_claims_count.toLocaleString('ar-SA-u-nu-latn')} مطالبة` : 'لا توجد مطالبات مسجلة'}</strong></div>
          </div>
        </article>

        <article className="db-executive-block">
          <header><div><h3>قابلية اعتماد الربح والمخزون</h3><p>الأرقام غير المكتملة تبقى معلّمة بوضوح ولا تدخل في صافي الربح.</p></div></header>
          <div className="db-reliability-list">
            <div><span><strong>صافي الربح</strong><small>تغطية تكلفة المنتجات {percent(brief.profitability.cost_coverage_pct, 1)}</small></span><b>{brief.profitability.available && brief.profitability.net_profit != null ? money(brief.profitability.net_profit, 2) : 'محجوب حتى اكتمال 80%'}</b></div>
            <div><span><strong>أصناف نافدة ذات طلب سابق</strong><small>{brief.inventory_risk.available ? 'مخزون محدث خلال يومين' : 'بيانات المخزون غير كافية أو قديمة'}</small></span><b>{brief.inventory_risk.available ? brief.inventory_risk.stockout_skus.toLocaleString('ar-SA-u-nu-latn') : 'غير متاح'}</b></div>
            <div><span><strong>قيمة طلب 30 يومًا مرتبطة بالنفاد</strong><small>قيمة تاريخية وليست خسارة مضمونة</small></span><b>{brief.inventory_risk.available ? money(brief.inventory_risk.stockout_historical_30d_demand_value, 2) : 'غير متاح'}</b></div>
            <div><span><strong>آخر صافي حركة نقدية</strong><small>{brief.cash.month ? new Date(`${brief.cash.month}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' }) : 'لا توجد معاملات مالية'}</small></span><b>{brief.cash.available ? money(brief.cash.net, 2) : 'غير متاح'}</b></div>
          </div>
        </article>
      </div>
      <OperatingCycle goal={goal} history={history} savingTarget={savingTarget} onSaveTarget={onSaveTarget} />
      <p className="db-executive-note">آخر يوم بيانات: {brief.data_as_of ? new Date(`${brief.data_as_of}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' }) : 'غير متاح'}. الاستقطاعات المعروضة مؤكدة من حقول الطلب؛ صافي الربح لا يظهر قبل اكتمال تكاليف 80% من المنتجات المباعة.</p>
    </>}
  </section>
}

const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  not_set: 'لم يحدد هدف', ahead: 'متقدم على المسار', on_track: 'على المسار', behind: 'متأخر عن المسار',
}

function OperatingCycle({ goal, history, savingTarget, onSaveTarget }: {
  goal: MonthlyGoal | null; history: WeeklyBriefRow[]; savingTarget: boolean; onSaveTarget: (amount: number) => void
}) {
  const [draft, setDraft] = useState('')
  const status = goal?.status || 'not_set'
  const target = Number(goal?.target_amount || 0)
  const attainment = Math.max(0, Math.min(100, Number(goal?.attainment_pct || 0)))
  const monthLabel = goal ? new Date(goal.year, goal.month - 1, 1).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' }) : 'الشهر الحالي'

  return <div className="db-cycle">
    <article className="db-cycle-goal">
      <header><div><h3>هدف المبيعات · {monthLabel}</h3><p>يقارن الإنجاز الفعلي بنسبة الوقت المنقضي من الشهر.</p></div><span className={`db-goal-status db-goal-status--${status}`}>{GOAL_STATUS_LABEL[status]}</span></header>
      {target > 0 && goal ? <>
        <div className="db-goal-numbers"><div><small>المبيعات حتى اليوم</small><strong>{money(goal.actual_sales, 2)}</strong></div><div><small>الهدف</small><strong>{money(target, 2)}</strong></div><div><small>التوقع بنهاية الشهر</small><strong>{goal.is_reliable ? money(goal.projected_sales, 2) : 'استرشادي فقط'}</strong></div></div>
        <div className="db-goal-progress"><div><i style={{ width: `${attainment}%` }} /><b style={{ right: `${Math.max(0, Math.min(100, goal.calendar_pace_pct))}%` }} /></div><span>الإنجاز {percent(goal.attainment_pct || 0, 1)}</span><span>المسار الزمني {percent(goal.calendar_pace_pct, 1)}</span></div>
        <p className="db-goal-guidance">{status === 'behind' ? `الفجوة ${money(goal.gap_amount || 0, 2)}؛ تحتاج متوسط ${money(goal.required_daily_sales || 0, 2)} يوميًا خلال ${goal.days_remaining.toLocaleString('ar-SA-u-nu-latn')} يومًا.` : status === 'ahead' ? 'الأداء أعلى من المسار الزمني الحالي. راقب الربحية والمخزون قبل زيادة الإنفاق.' : 'الأداء قريب من المسار المطلوب. استمر في المتابعة الأسبوعية.'}</p>
      </> : <div className="db-goal-empty"><strong>حدد هدفًا شهريًا قابلًا للقياس</strong><p>سيحسب النظام الفجوة والمبيعات اليومية المطلوبة والانحراف عن المسار.</p></div>}
      <form className="db-goal-form" onSubmit={event => { event.preventDefault(); onSaveTarget(Number(draft || target)) }}><label htmlFor="monthly-sales-target">{target > 0 ? 'تعديل الهدف' : 'الهدف الشهري'}</label><div><input id="monthly-sales-target" inputMode="decimal" type="number" min="1" max="1000000000" step="0.01" value={draft} onChange={event => setDraft(event.target.value)} placeholder={target ? target.toFixed(2) : 'مثال: 50000'} /><span>ر.س</span><button disabled={savingTarget || (!draft && !target)}>{savingTarget ? 'جارٍ الحفظ' : 'حفظ الهدف'}</button></div></form>
    </article>

    <article className="db-cycle-history">
      <header><div><h3>سجل المتابعة الأسبوعية</h3><p>يحفظ النظام آخر قراءة متاحة لكل أسبوع عند فتح مركز القرارات.</p></div><span>{history.length === 1 ? 'أسبوع واحد' : `${history.length.toLocaleString('ar-SA-u-nu-latn')} أسابيع`}</span></header>
      {history.length ? <div className="db-week-list">{history.map(row => {
        const rowProgress = Math.max(0, Math.min(100, Number(row.target_attainment_pct || 0)))
        return <div className="db-week-row" key={row.id}><span><strong>{new Date(`${row.week_start}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' })} – {new Date(`${row.week_end}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' })}</strong><small>البيانات حتى {new Date(`${row.source_data_as_of}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' })}</small></span><b>{money(row.actual_sales, 2)}</b><span className={`db-goal-status db-goal-status--${row.target_status}`}>{GOAL_STATUS_LABEL[row.target_status]}</span><div><i style={{ width: `${rowProgress}%` }} /></div></div>
      })}</div> : <div className="db-week-empty">سيظهر أول تقرير أسبوعي بعد توفر طلبات قابلة للتحليل.</div>}
    </article>
  </div>
}

function ExecutiveMetric({ label, value, delta = null, inverse = false, note }: { label: string; value: string; delta?: number | null; inverse?: boolean; note: string }) {
  const favourable = delta == null ? null : inverse ? delta <= 0 : delta >= 0
  return <article className="db-executive-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small>{delta == null ? <em>لا توجد مقارنة قابلة للاعتماد</em> : <em className={favourable ? 'is-positive' : 'is-negative'}>{delta >= 0 ? 'ارتفاع' : 'انخفاض'} {percent(Math.abs(delta), 1)} عن الأسبوع السابق</em>}</article>
}

function ExecutiveLine({ label, value, total, amount }: { label: string; value: string; total: number; amount: number }) {
  const share = total > 0 ? Math.min(100, Math.max(0, amount / total * 100)) : 0
  return <div className="db-executive-line"><span>{label}</span><strong>{value}</strong><div aria-label={`${label}: ${percent(share, 1)} من المبيعات`}><i style={{ width: `${share}%` }} /></div><small>{percent(share, 1)} من المبيعات</small></div>
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

const HEALTH_LABELS: Record<keyof MerchantHealth['breakdown'], string> = {
  readiness: 'جاهزية البيانات', profitability: 'الربحية', inventory: 'المخزون', demand: 'استمرارية الطلب', marketing: 'كفاءة الإعلان',
}

const CONFIDENCE_LABELS: Record<HealthConfidence, string> = { high: 'ثقة مرتفعة', medium: 'ثقة متوسطة', low: 'ثقة منخفضة' }
const RATING_LABELS: Record<MerchantHealth['rating'], string> = {
  excellent: 'ممتاز', good: 'جيد', watch: 'يحتاج متابعة', critical: 'يحتاج تدخل', insufficient: 'بيانات غير كافية',
}

function HealthPanel({ health }: { health: MerchantHealth | null }) {
  const dimensions = health ? (Object.keys(HEALTH_LABELS) as (keyof MerchantHealth['breakdown'])[]) : []
  const score = health?.score
  return <article className="db-intelligence db-health" aria-labelledby="health-title">
    <div className="db-intelligence-head">
      <div><span className="db-eyebrow"><Activity size={14} /> صحة تشغيل المتجر</span><h2 id="health-title">{!health || score == null ? 'لا يمكن اعتماد التقييم بعد' : RATING_LABELS[health.rating]}</h2></div>
      {health ? <span className={`db-confidence db-confidence--${health.confidence}`}>{CONFIDENCE_LABELS[health.confidence]}</span> : null}
    </div>
    {health ? <>
      <div className="db-health-summary">
        <div className={`db-health-score db-health-score--${health.rating}`}><strong>{score == null ? '—' : score.toLocaleString('ar-SA-u-nu-latn')}</strong><span>من 100</span></div>
        <div><strong>تغطية الأدلة {percent(health.coverage_pct)}</strong><p>{score == null ? 'أكمل مصادر البيانات قبل مقارنة صحة المتجر أو اتخاذ قرار توسع.' : 'النتيجة تجمع الربحية والمخزون والطلب والإعلان، ولا تمنح نقاطًا للمصادر الناقصة.'}</p></div>
      </div>
      <div className="db-health-dimensions">{dimensions.map(key => {
        const item = health.breakdown[key]
        return <div className="db-health-dimension" key={key}>
          <span><strong>{HEALTH_LABELS[key]}</strong><small>{item.available ? `وزن ${item.weight}%` : 'غير داخلة في التقييم'}</small></span>
          <b>{item.available && item.score != null ? percent(item.score) : 'غير متاح'}</b>
          <div className="db-health-bar" aria-label={`${HEALTH_LABELS[key]}: ${item.available && item.score != null ? percent(item.score) : 'غير متاح'}`}><i style={{ width: `${item.available && item.score != null ? Math.max(2, Math.min(100, item.score)) : 0}%` }} /></div>
        </div>
      })}</div>
    </> : <EmptyState text="تعذر تحميل تقييم صحة المتجر من المصادر الحالية." />}
  </article>
}

function ForecastPanel({ forecast }: { forecast: SalesForecast | null }) {
  const hasForecast = Boolean(forecast && forecast.forecast_30 > 0)
  return <article className="db-intelligence db-forecast" aria-labelledby="forecast-title">
    <div className="db-intelligence-head">
      <div><span className="db-eyebrow db-eyebrow--blue"><TrendingUp size={14} /> توقع المبيعات</span><h2 id="forecast-title">الـ 30 يومًا القادمة</h2></div>
      {forecast ? <span className={`db-confidence db-confidence--${forecast.confidence}`}>{CONFIDENCE_LABELS[forecast.confidence]}</span> : null}
    </div>
    {forecast && hasForecast ? <>
      <div className="db-forecast-value"><strong>{money(forecast.forecast_30, 2)}</strong><span>{forecast.is_actionable ? 'توقع قابل للاستخدام في التخطيط' : 'تقدير استرشادي — لا تعتمد عليه للشراء'}</span></div>
      <div className="db-forecast-range" role="img" aria-label={`النطاق المتوقع من ${money(forecast.lower_30, 2)} إلى ${money(forecast.upper_30, 2)}`}>
        <div><i /><b /></div><span>{money(forecast.lower_30)}</span><span>{money(forecast.upper_30)}</span>
      </div>
      <div className="db-forecast-evidence">
        <span><small>آخر 30 يومًا</small><strong>{money(forecast.last_30_sales, 2)}</strong></span>
        <span><small>أيام البيانات</small><strong>{forecast.observed_days.toLocaleString('ar-SA-u-nu-latn')}</strong></span>
        <span><small>أيام بيع فعلية</small><strong>{forecast.active_days.toLocaleString('ar-SA-u-nu-latn')}</strong></span>
      </div>
      <p className="db-forecast-caveat">{forecast.caveat}</p>
    </> : <div className="db-forecast-empty"><strong>لا توجد طلبات كافية لبناء توقع</strong><p>اربط قناة البيع أو ارفع ملف الطلبات، وسيظهر النطاق بعد تراكم سجل قابل للقياس.</p><button onClick={() => go('/integrations')}>إدارة مصادر البيانات <ChevronLeft size={15} /></button></div>}
  </article>
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <span className="db-metric"><small>{label}</small><strong className={danger ? 'db-negative' : ''}>{value}</strong></span>
}

function EmptyState({ text }: { text: string }) { return <div className="db-empty">{text}</div> }
