import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/db'
import { useMobile } from '../lib/hooks'
import { PageTabs } from '../components/UI'
import PayoutCalendar from '../components/PayoutCalendar'
import SettlementReconciliationPanel from '../components/SettlementReconciliationPanel'
import BankStatementReconciliationPanel from '../components/BankStatementReconciliationPanel'
import type { Merchant } from '../lib/supabase'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Landmark, RefreshCw } from 'lucide-react'
import { financialTransactionMeta } from '../lib/trendyolFinance'

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  amazon:   { label: 'أمازون',    color: '#ff9900' },
  noon:     { label: 'نون',       color: '#f5c518' },
  trendyol: { label: 'Trendyol', color: '#a84400' },
}

const RETURN_STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pending:  { label: 'بانتظار القرار', bg: 'var(--warning-bg)', color: 'var(--warning-text)' },
  approved: { label: 'تمت الموافقة', bg: 'var(--success-bg)', color: 'var(--success-text)' },
  refunded: { label: 'تم رد المبلغ', bg: 'var(--success-bg)', color: 'var(--success-text)' },
  rejected: { label: 'تم الرفض', bg: 'var(--danger-bg)', color: 'var(--danger-text)' },
}

const RETURN_REASON_AR: Record<string, string> = {
  'Undelivered shipment': 'تعذر تسليم الشحنة',
  'Delayed Deliveries': 'تأخر تسليم الشحنة',
  'I believe this item is not original': 'العميل يعتقد أن المنتج غير أصلي',
}

type ReturnReasonOption = { id: string; label: string }

function returnReasonLabel(value: unknown) {
  const reason = String(value || '').trim()
  return RETURN_REASON_AR[reason] || reason || 'لم يحدد العميل سببًا'
}

function parseReturnReasonOptions(payload: any): ReturnReasonOption[] {
  const candidates = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.content) ? payload.content
    : Array.isArray(payload?.claimIssueReasons) ? payload.claimIssueReasons
    : []
  return candidates.flatMap((item: any) => {
    const id = item?.id ?? item?.claimIssueReasonId ?? item?.externalReasonId
    if (id === undefined || id === null) return []
    return [{ id: String(id), label: returnReasonLabel(item?.name || item?.description || item?.code || id) }]
  })
}

function fmt(v: number) { return v.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س' }

type StatementTab = 'month' | 'settlements' | 'trends' | 'returns'

function requestedStatementTab(): StatementTab {
  const value = new URLSearchParams(window.location.search).get('tab')
  return value === 'settlements' || value === 'trends' || value === 'returns' ? value : 'month'
}

export default function Statement({ merchant }: { merchant: Merchant | null }) {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [stab, setStab]   = useState<StatementTab>(requestedStatementTab)
  const [perfData, setPerfData]     = useState<any[]>([])
  const [returns, setReturns]       = useState<any[]>([])
  const [targets, setTargets]       = useState<any[]>([])
  const [financialTransactions, setFinancialTransactions] = useState<any[]>([])
  const [refreshingFinance, setRefreshingFinance] = useState(false)
  const [financeMessage, setFinanceMessage] = useState<{ type:'ok'|'err'; text:string } | null>(null)
  const [costInfo, setCostInfo] = useState({ cogs: 0, costedUnits: 0, missingUnits: 0 })
  const [qualityInfo, setQualityInfo] = useState({
    orders: 0, apiOrders: 0, uploadedOrders: 0, costCoverage: 0,
    transactions: 0, settlements: 0, adRows: 0, uploadedAdRows: 0,
    latestSync: '', latestTransaction: '', latestAdReport: '',
  })
  // الباقة الحالية مجانية، لذلك لا تُحتسب أي عمولة للمنصة.
  const commRate = 0
  const [loading, setLoading]       = useState(true)
  const [periodReady, setPeriodReady] = useState(false)
  const isMobile = useMobile()
  const merchantCode = merchant?.merchant_code

  function selectStatementTab(next: StatementTab) {
    setStab(next)
    const params = new URLSearchParams(window.location.search)
    if (next === 'month') params.delete('tab')
    else params.set('tab', next)
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }

  // Open on the latest month that actually contains financial data. A new
  // calendar month should not make the first merchant view look empty.
  useEffect(() => {
    if (!merchantCode) return
    setPeriodReady(false); setLoading(true)
    supabase.from('performance_data').select('data_date')
      .eq('merchant_code', merchantCode)
      .order('data_date', { ascending:false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (data?.data_date) {
          const latest = new Date(`${data.data_date}T00:00:00`)
          setYear(latest.getFullYear()); setMonth(latest.getMonth() + 1)
        }
        setPeriodReady(true)
      })
  }, [merchantCode])

  const load = useCallback(async (code: string) => {
    setLoading(true)
    const start = `${year}-${String(month).padStart(2,'0')}-01`
    const endDate = new Date(year, month, 0)
    const end   = `${year}-${String(month).padStart(2,'0')}-${endDate.getDate()}`

    const [perf, rets, { data: tgts }, monthOrders, productCosts, monthTransactions, monthAds] = await Promise.all([
      // fetchAll: كشف حساب مالي — لا نقبل اقتطاع PostgREST الصامت عند 1000 صف
      fetchAll<any>((f, t) => supabase.from('performance_data').select('*')
        .eq('merchant_code', code)
        .gte('data_date', start).lte('data_date', end)
        .order('data_date').order('platform').range(f, t), 'بيانات الأداء'),
      fetchAll<any>((f, t) => supabase.from('returns').select('*')
        .eq('merchant_code', code)
        .gte('return_date', start).lte('return_date', end)
        .order('id').range(f, t), 'المرتجعات'),
      supabase.from('sales_targets').select('*')
        .eq('merchant_code', code)
        .eq('year', year).eq('month', month),
      fetchAll<any>((f, t) => supabase.rpc('list_order_operating_facts', { p_merchant_code: code, p_sku: null })
        .gte('order_date', `${start}T00:00:00`).lte('order_date', `${end}T23:59:59`)
        .order('id').range(f, t), 'تكلفة الطلبات'),
      fetchAll<any>((f, t) => supabase.from('products').select('sku,cost_price')
        .eq('merchant_code', code).order('id').range(f, t), 'تكلفة المنتجات'),
      fetchAll<any>((f, t) => supabase.from('account_transactions').select('id,platform,settlement_id,transaction_date,posted_date,transaction_type,debit,credit,net_amount,currency,upload_id')
        .eq('merchant_code', code).gte('transaction_date', `${start}T00:00:00`).lte('transaction_date', `${end}T23:59:59`)
        .order('id').range(f, t), 'معاملات الشهر'),
      fetchAll<any>((f, t) => supabase.from('ad_metrics').select('id,platform,report_date,upload_id')
        .eq('merchant_code', code).gte('report_date', start).lte('report_date', end)
        .order('id').range(f, t), 'بيانات إعلانات الشهر'),
    ])
    setPerfData(perf)
    setReturns(rets)
    setTargets(tgts || [])
    setFinancialTransactions(monthTransactions)
    const costs = new Map<string, number>()
    for (const product of productCosts) if (product.sku && Number(product.cost_price) > 0) costs.set(String(product.sku).toLowerCase(), Number(product.cost_price))
    let cogs = 0, costedUnits = 0, missingUnits = 0
    const activeOrders = monthOrders.filter((row: any) => !['cancelled','returned'].includes(row.status))
    for (const order of activeOrders) {
      const units = Number(order.quantity || 1)
      const cost = order.sku ? costs.get(String(order.sku).toLowerCase()) : undefined
      if (cost) { cogs += cost * units; costedUnits += units } else missingUnits += units
    }
    setCostInfo({ cogs, costedUnits, missingUnits })
    const totalUnits = costedUnits + missingUnits
    setQualityInfo({
      orders: activeOrders.length,
      apiOrders: activeOrders.filter((row: any) => !row.upload_id).length,
      uploadedOrders: activeOrders.filter((row: any) => row.upload_id).length,
      costCoverage: totalUnits > 0 ? costedUnits / totalUnits * 100 : 0,
      transactions: monthTransactions.length,
      settlements: new Set(monthTransactions.map((row: any) => row.settlement_id).filter(Boolean)).size,
      adRows: monthAds.length,
      uploadedAdRows: monthAds.filter((row: any) => row.upload_id).length,
      latestSync: activeOrders.map((row: any) => row.last_synced_at).filter(Boolean).sort().slice(-1)[0] || '',
      latestTransaction: monthTransactions.map((row: any) => row.transaction_date).filter(Boolean).sort().slice(-1)[0] || '',
      latestAdReport: monthAds.map((row: any) => row.report_date).filter(Boolean).sort().slice(-1)[0] || '',
    })
    setLoading(false)
  }, [month, year])

  // Reload only for the selected merchant and accounting period.
  useEffect(() => { if (merchantCode && periodReady) load(merchantCode) }, [load, merchantCode, periodReady])

  // ── Computed ──────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const grossRevenue  = perfData.reduce((s, r) => s + r.total_sales, 0)
    const platformFees  = perfData.reduce((s, r) => s + (r.platform_fees || 0), 0)
    const adSpend       = perfData.reduce((s, r) => s + (r.ad_spend || 0), 0)
    const totalReturns  = returns.reduce((s, r) => s + (r.return_amount || 0), 0)
    const afterFees     = grossRevenue - platformFees - adSpend - totalReturns
    const sellpertComm  = Math.round(grossRevenue * commRate / 100)
    const netPayout     = afterFees - sellpertComm
    const estimatedProfit = netPayout - costInfo.cogs
    const costsComplete = costInfo.missingUnits === 0 && costInfo.costedUnits > 0
    const margin        = grossRevenue > 0 && costsComplete ? (estimatedProfit / grossRevenue * 100) : null
    const totalOrders   = perfData.reduce((s, r) => s + r.order_count, 0)
    return { grossRevenue, platformFees, adSpend, totalReturns, afterFees, sellpertComm, netPayout, estimatedProfit, costsComplete, margin, totalOrders }
  }, [perfData, returns, commRate, costInfo])

  // Per-platform breakdown
  const byPlatform = useMemo(() => {
    const map: Record<string, { revenue: number; fees: number; ad: number; orders: number; returns: number }> = {}
    for (const r of perfData) {
      if (!map[r.platform]) map[r.platform] = { revenue: 0, fees: 0, ad: 0, orders: 0, returns: 0 }
      map[r.platform].revenue += r.total_sales
      map[r.platform].fees   += r.platform_fees || 0
      map[r.platform].ad     += r.ad_spend || 0
      map[r.platform].orders += r.order_count
    }
    for (const r of returns) {
      if (!map[r.platform]) map[r.platform] = { revenue: 0, fees: 0, ad: 0, orders: 0, returns: 0 }
      map[r.platform].returns += r.return_amount || 0
    }
    return map
  }, [perfData, returns])

  // Daily trend for chart
  const dailyTrend = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of perfData) {
      const d = r.data_date || r.created_at?.split('T')[0]
      if (d) map[d] = (map[d] || 0) + r.total_sales
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, rev]) => ({
      date: new Date(date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' }),
      rev: Math.round(rev),
    }))
  }, [perfData])

  // Month target
  const monthTarget = targets.find(t => t.platform === 'all')?.target_amount || 0
  const targetPct   = monthTarget > 0 ? Math.min((summary.grossRevenue / monthTarget) * 100, 100) : 0

  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
    if (isCurrentMonth) return
    if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1)
  }

  async function refreshTrendyolFinance() {
    if (!merchantCode || refreshingFinance) return
    setRefreshingFinance(true); setFinanceMessage(null)
    try {
      const { data, error } = await supabase.functions.invoke('sync-trendyol', { body:{ merchant_code:merchantCode } })
      if (error || data?.error) throw new Error(data?.error || error?.message || 'تعذر تحديث Trendyol')
      await load(merchantCode)
      setFinanceMessage({ type:'ok', text:'تم تحديث معاملات وتسويات Trendyol وإعادة المطابقة.' })
    } catch (error:any) {
      setFinanceMessage({ type:'err', text:error?.message || 'تعذر تحديث التسويات الآن.' })
    } finally { setRefreshingFinance(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ padding: isMobile ? '16px' : '28px 32px', maxWidth: 1180, margin: '0 auto' }}>
      <PageTabs tabs={[{ label: 'الطلبات', path: '/orders' }, { label: 'الأرباح والتحصيل', path: '/statement' }]} />

      {/* Header + month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>الأرباح والتحصيل</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>اعرف ربحك، مستحقاتك، وما سجّلته المنصات كتحويل، واكشف أي فرق يحتاج مراجعة.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '6px 12px' }}>
          <button style={S.navBtn} onClick={prevMonth}>›</button>
          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 110, textAlign: 'center' }}>
            {MONTHS[month - 1]} {year}
          </span>
          <button style={{ ...S.navBtn, opacity: year === now.getFullYear() && month === now.getMonth() + 1 ? 0.3 : 1 }} onClick={nextMonth}>‹</button>
        </div>
      </div>

      <div role="tablist" aria-label="أقسام الأرباح والتحصيل" style={{ display:'flex', gap:6, background:'var(--surface2)', padding:4, borderRadius:10, marginBottom:20, width:isMobile ? '100%' : 'fit-content', overflowX:'auto' }}>
        {[{ k:'month', l:'الملخص المالي' }, { k:'settlements', l:'التسويات والتحويلات' }, { k:'trends', l:'تحليلات واتجاهات' }, { k:'returns', l:'المرتجعات' }].map(t => (
          <button role="tab" aria-selected={stab === t.k} key={t.k} onClick={() => selectStatementTab(t.k as StatementTab)} style={{
            padding:'7px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit', whiteSpace:'nowrap',
            background:stab === t.k ? 'var(--surface)' : 'transparent', color:stab === t.k ? 'var(--accent)' : 'var(--text2)', boxShadow:stab === t.k ? 'var(--shadow)' : 'none',
          }}>{t.l}</button>
        ))}
      </div>

      {stab === 'month' ? <>
      <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'repeat(3,1fr)', gap:10, marginBottom:20 }}>
        {[
          ['ملخص الربحية','المبيعات ناقص رسوم المنصات والإعلانات والمرتجعات.'],
          ['التسويات المسجّلة','المبالغ والمواعيد التي تم تسجيلها أو تأكيدها في النظام.'],
          ['كشف المعاملات','تفاصيل المدين والدائن والخصومات لكل منصة.'],
        ].map(([title, desc]) => <div key={title} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'13px 15px' }}>
          <div style={{ fontSize:12, fontWeight:800, color:'var(--text)', marginBottom:4 }}>{title}</div>
          <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.6 }}>{desc}</div>
        </div>)}
      </div>

      <div style={{ ...S.card, marginBottom:20, padding:0, overflow:'hidden' }}>
        <div style={{ padding:'14px 17px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
          <div><div style={{ fontSize:13, fontWeight:800 }}>حالة بيانات الشهر</div><div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>توضح ما هو مؤكد، وما يعتمد على ملف، وما يحتاج استكمالًا قبل اتخاذ قرار مالي.</div></div>
          <span style={{ fontSize:10, color:'var(--text3)' }}>{MONTHS[month - 1]} {year}</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'repeat(4,1fr)' }}>
          {[
            {
              label:'المبيعات',
              value: qualityInfo.orders ? `${qualityInfo.orders.toLocaleString('ar-SA')} طلب` : 'لا توجد طلبات',
              detail: qualityInfo.orders ? `${qualityInfo.apiOrders.toLocaleString('ar-SA')} عبر الربط · ${qualityInfo.uploadedOrders.toLocaleString('ar-SA')} عبر الملفات` : 'اربط منصة أو ارفع ملف الطلبات',
              ok: qualityInfo.orders > 0,
            },
            {
              label:'تكاليف المنتجات',
              value: qualityInfo.orders ? `${qualityInfo.costCoverage.toFixed(0)}% مكتملة` : 'لا توجد مبيعات',
              detail: qualityInfo.costCoverage >= 100 ? 'صافي الربح قابل للحساب' : 'الصافي المعروض لا يشمل التكاليف الناقصة',
              ok: qualityInfo.orders === 0 || qualityInfo.costCoverage >= 100,
            },
            {
              label:'المعاملات والتسويات',
              value: qualityInfo.transactions ? `${qualityInfo.transactions.toLocaleString('ar-SA')} معاملة` : 'غير متوفرة',
              detail: qualityInfo.settlements ? `${qualityInfo.settlements.toLocaleString('ar-SA')} تسوية مرجعية مسجّلة` : 'لا يوجد رقم تسوية مؤكد لهذا الشهر',
              ok: qualityInfo.transactions > 0,
            },
            {
              label:'بيانات الإعلانات',
              value: qualityInfo.adRows ? `${qualityInfo.adRows.toLocaleString('ar-SA')} سجل` : 'غير متوفرة',
              detail: qualityInfo.adRows ? `${qualityInfo.uploadedAdRows.toLocaleString('ar-SA')} من ملفات التقارير${qualityInfo.latestAdReport ? ` · حتى ${new Date(qualityInfo.latestAdReport).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}` : ''}` : 'لن تُخصم الإعلانات من الربحية',
              ok: qualityInfo.adRows > 0,
            },
          ].map((item, index) => <div key={item.label} style={{ padding:'14px 16px', borderLeft:!isMobile && index < 3 ? '1px solid var(--border)' : undefined, borderBottom:isMobile && index < 3 ? '1px solid var(--border)' : undefined }}>
            <div style={{ fontSize:10, color:'var(--text3)', marginBottom:5 }}>{item.label}</div>
            <div style={{ fontSize:13, fontWeight:800, color:item.ok ? 'var(--text)' : 'var(--warning-text)' }}>{item.value}</div>
            <div style={{ fontSize:10, color:'var(--text3)', lineHeight:1.6, marginTop:4 }}>{item.detail}</div>
          </div>)}
        </div>
      </div>
      </> : null}

      {/* القادم لحسابك: أول ما يبحث عنه التاجر — كم ومتى تصله مستحقاته */}
      {stab === 'month' ? <PayoutCalendar merchantCode={merchant?.merchant_code} /> : null}

      {perfData.length === 0 && stab !== 'returns' && stab !== 'settlements' ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text3)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>لا توجد بيانات لهذا الشهر</div>
          <div style={{ fontSize: 13 }}>لم يتم إدخال مبيعات لـ {MONTHS[month-1]} {year}</div>
        </div>
      ) : (
        <>
          {stab === 'month' && (<>
          {/* Target progress */}
          {monthTarget > 0 && (
            <div style={{ ...S.card, marginBottom: 16, padding: '14px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>الهدف الشهري</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: targetPct >= 100 ? 'var(--accent2)' : 'var(--accent)' }}>
                  {fmt(summary.grossRevenue)} / {fmt(monthTarget)} ({targetPct.toFixed(0)}%)
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 8, background: 'var(--surface2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${targetPct}%`, background: targetPct >= 100 ? 'var(--accent2)' : 'var(--accent)', borderRadius: 8, transition: 'width 0.8s ease' }} />
              </div>
            </div>
          )}

          {/* Summary KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'إجمالي المبيعات',   value: fmt(summary.grossRevenue), color: '#0f958c', icon: '', sub: `${summary.totalOrders} طلب` },
              { label: 'رسوم وإعلانات',      value: fmt(summary.platformFees + summary.adSpend), color: 'var(--danger-text)', icon: '', sub: `${((summary.platformFees + summary.adSpend) / (summary.grossRevenue || 1) * 100).toFixed(1)}% من الإيراد` },
              { label: 'المرتجعات', value: fmt(summary.totalReturns), color: 'var(--warning-text)', icon: '', sub: 'بحسب البيانات المستوردة' },
              { label: summary.costsComplete ? 'صافي الربح التقديري' : 'الصافي قبل تكلفة المنتجات', value: fmt(summary.costsComplete ? summary.estimatedProfit : summary.netPayout), color: (summary.costsComplete ? summary.estimatedProfit : summary.netPayout) >= 0 ? 'var(--success-text)' : 'var(--danger-text)', icon: '', sub: summary.costsComplete ? `${summary.margin?.toFixed(1)}% هامش تقديري` : 'الربحية غير مكتملة حتى تُدخل تكاليف المنتجات' },
            ].map((k, i) => (
              <div key={i} style={{ ...S.card, padding: 16, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color, borderRadius: '12px 12px 0 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
                  <span style={{ fontSize: 18 }}>{k.icon}</span>
                </div>
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: k.color, letterSpacing: '-0.5px' }}>{k.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Detailed breakdown */}
          <div style={{ ...S.card, marginBottom: 20, overflow: 'hidden', padding: 0 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
              تفصيل الحساب
            </div>
            <div style={{ padding: '20px' }}>
              {[
                { label: 'إجمالي المبيعات الخام',   value: summary.grossRevenue,  color: 'var(--accent)', sign: '' },
                { label: 'رسوم المنصات',              value: -summary.platformFees, color: 'var(--danger-text)', sign: '−' },
                { label: 'الإنفاق الإعلاني',          value: -summary.adSpend,      color: 'var(--danger-text)', sign: '−' },
                { label: 'قيمة المرتجعات',            value: -summary.totalReturns, color: 'var(--warning-text)', sign: '−' },
                { label: 'تكلفة المنتجات المسجّلة', value: -costInfo.cogs, color: 'var(--danger-text)', sign: '−' },
                null, // divider
                { label: 'الصافي بعد الرسوم والإعلانات والمرتجعات', value: summary.afterFees, color: 'var(--text)', sign: '', bold: true },
                null,
                { label: summary.costsComplete ? 'صافي الربح التقديري' : 'الصافي قبل تكاليف المنتجات الناقصة', value: summary.costsComplete ? summary.estimatedProfit : summary.netPayout, color: (summary.costsComplete ? summary.estimatedProfit : summary.netPayout) >= 0 ? 'var(--accent2)' : 'var(--danger-text)', sign: '', bold: true, large: true },
              ].map((row, i) => row === null ? (
                <div key={i} style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
              ) : (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
                  <span style={{ fontSize: row.bold ? 13 : 12, fontWeight: row.bold ? 700 : 500, color: row.bold ? 'var(--text)' : 'var(--text2)' }}>{row.label}</span>
                  <span style={{ fontSize: row.large ? 20 : row.bold ? 14 : 13, fontWeight: row.bold ? 800 : 600, color: row.color, fontFamily: 'monospace' }}>
                    {row.sign}{fmt(Math.abs(row.value))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {!summary.costsComplete ? <div style={{ marginBottom:16, padding:'12px 15px', borderRadius:10, background:'var(--warning-bg)', border:'1px solid rgba(245,166,35,.35)' }}>
            <div style={{ fontSize:12, fontWeight:800, color:'var(--warning-text)' }}>الربحية غير مكتملة</div>
            <div style={{ fontSize:11, color:'var(--text2)', marginTop:4, lineHeight:1.7 }}>هناك {costInfo.missingUnits.toLocaleString('ar-SA')} وحدة مباعة بلا تكلفة منتج مسجّلة. لذلك لا نعرضها كصافي ربح، ويمكن استكمال التكاليف من صفحة المنتجات.</div>
          </div> : null}

          {/* Data mismatch warning — منصات فيها إنفاق إعلاني بدون مبيعات */}
          {(() => {
            const mismatched = Object.entries(byPlatform).filter(([_, d]) => d.ad > 0 && d.revenue === 0)
            if (mismatched.length === 0) return null
            return (
              <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10,
                background: 'var(--warning-bg)', border: '1px solid rgba(255,153,0,0.3)',
                display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, fontSize: 12, lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 700, color: 'var(--warning-text)', marginBottom: 4 }}>تنبيه: تقارير ناقصة لهذا الشهر</div>
                  <div style={{ color: 'var(--text2)' }}>
                    {mismatched.map(([p]) => PLATFORM_META[p]?.label || p).join(' و')} فيها إنفاق إعلاني <b>بدون مبيعات مسجّلة</b> — قد يكون تقرير المبيعات الفعلي لم يُرفع بعد. الأرقام السالبة في "الصافي" بسبب هذا التشوّه.
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Per-platform table */}
          {Object.keys(byPlatform).length > 0 && (
            <div style={{ ...S.card, marginBottom: 20, overflow: 'hidden', padding: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                تفصيل المنصات
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['المنصة', 'الإيرادات', 'رسوم المنصة', 'الإعلانات', 'المرتجعات', 'الطلبات', 'الصافي'].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(byPlatform).map(([p, d]) => {
                      const net = d.revenue - d.fees - d.ad - d.returns
                      const meta = PLATFORM_META[p]
                      const isMismatched = d.ad > 0 && d.revenue === 0
                      return (
                        <tr key={p} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={S.td}>
                            <span style={{ color: meta?.color, fontWeight: 700 }}>{meta?.label || p}</span>
                            {isMismatched && (
                              <span title="إنفاق إعلاني بدون مبيعات — قد ينقص تقرير" style={{ marginRight: 8, fontSize: 10, color: 'var(--warning-text)', background: 'var(--warning-bg)', borderRadius: 6, padding: '3px 7px', whiteSpace: 'nowrap' }}>
                                بيانات المبيعات ناقصة
                              </span>
                            )}
                          </td>
                          <td style={{ ...S.td, color: 'var(--accent)', fontWeight: 700 }}>{fmt(d.revenue)}</td>
                          <td style={{ ...S.td, color: 'var(--danger-text)' }}>{d.fees > 0 ? fmt(d.fees) : '—'}</td>
                          <td style={{ ...S.td, color: 'var(--danger-text)' }}>{d.ad > 0 ? fmt(d.ad) : '—'}</td>
                          <td style={{ ...S.td, color: 'var(--warning-text)' }}>{d.returns > 0 ? fmt(d.returns) : '—'}</td>
                          <td style={S.td}>{d.orders.toLocaleString()}</td>
                          <td style={{ ...S.td, color: net >= 0 ? 'var(--accent2)' : 'var(--danger-text)', fontWeight: 700 }}>{fmt(net)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily trend chart */}
          {dailyTrend.length > 1 && (
            <div style={{ ...S.card, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>المبيعات اليومية</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={dailyTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="stmtGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0f958c" stopOpacity={0.35}/>
                      <stop offset="95%" stopColor="#0f958c" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text3)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(0)+'k' : v} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text)' }} formatter={(v: number) => [fmt(v), 'المبيعات']} />
                  <Area type="monotone" dataKey="rev" stroke="#0f958c" strokeWidth={2.5} fill="url(#stmtGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* سجل معاملات هذا الشهر (ضمن كشف الشهر) */}
          <TransactionsLedger merchant={merchant} month={month} year={year} />
          </>)}

          {stab === 'settlements' && (<>
            {financeMessage ? <div role="status" style={{ marginBottom:10, padding:'10px 12px', borderRadius:9, background:financeMessage.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color:financeMessage.type === 'ok' ? 'var(--success-text)' : 'var(--danger-text)', fontSize:11, fontWeight:700 }}>{financeMessage.text}</div> : null}
            <SettlementReconciliationPanel transactions={financialTransactions} refreshing={refreshingFinance} onRefresh={() => void refreshTrendyolFinance()} />
            {merchantCode ? <BankStatementReconciliationPanel merchantCode={merchantCode} transactions={financialTransactions} year={year} month={month} /> : null}
            <PayoutCalendar merchantCode={merchant?.merchant_code} />
            <TransactionsLedger merchant={merchant} month={month} year={year} />
          </>)}

          {stab === 'trends' && (<>
            <PnLPanel merchant={merchant} year={year} month={month} />
            <RevenueForecastPanel merchant={merchant} />
            <MonthlyCashflowPanel merchant={merchant} />
          </>)}

          {stab === 'returns' && (<>
            <ReturnsAnalytics merchant={merchant} grossRevenue={summary.grossRevenue} />
            <ReturnReasonsBreakdown merchant={merchant} />
            <ReturnsSection merchant={merchant} month={month} year={year} onUpdate={() => { if (merchantCode) void load(merchantCode) }} />
          </>)}
        </>
      )}
    </div>
  )
}

// ── Account Transactions Ledger ──────────────────────────────────────────────
function TransactionsLedger({ merchant, month, year }: { merchant: Merchant | null; month: number; year: number }) {
  const [tx, setTx] = useState<any[]>([])
  const [filter, setFilter] = useState<'all' | 'amazon' | 'trendyol'>('all')
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (merchant) loadTx() /* eslint-disable-line */ }, [merchant?.merchant_code, month, year])
  async function loadTx() {
    if (!merchant) return
    setLoading(true)
    const start = `${year}-${String(month).padStart(2,'0')}-01`
    const endDate = new Date(year, month, 0)
    const end   = `${year}-${String(month).padStart(2,'0')}-${endDate.getDate()}T23:59:59`
    const { data } = await supabase.from('account_transactions')
      .select('platform, transaction_date, transaction_type, order_id, description, debit, credit, net_amount, currency, amount_description')
      .eq('merchant_code', merchant.merchant_code)
      .gte('transaction_date', start).lte('transaction_date', end)
      .order('transaction_date', { ascending: false })
      .limit(500)
    setTx(data || [])
    setLoading(false)
  }
  const filtered = filter === 'all' ? tx : tx.filter(r => r.platform === filter)
  const totals = useMemo(() => filtered.reduce((a, r) => ({
    debit: a.debit + (Number(r.debit) || 0),
    credit: a.credit + (Number(r.credit) || 0),
    net: a.net + (Number(r.net_amount) || 0),
  }), { debit: 0, credit: 0, net: 0 }), [filtered])

  if (loading) return null
  if (tx.length === 0) return null

  return (
    <div style={{ ...S.card, marginBottom: 20, overflow: 'hidden', padding: 0 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>كشف المعاملات المالية ({filtered.length})</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'amazon', 'trendyol'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', background: filter === f ? 'var(--accent-strong)' : 'var(--surface2)',
              color: filter === f ? '#fff' : 'var(--text2)',
            }}>
              {f === 'all' ? 'الكل' : f === 'amazon' ? 'أمازون' : 'Trendyol'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: '12px 20px', display: 'flex', gap: 24, fontSize: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span>الدائن: <b style={{ color: 'var(--success-text)' }}>{fmt(totals.credit)}</b></span>
        <span>المدين: <b style={{ color: 'var(--danger-text)' }}>{fmt(totals.debit)}</b></span>
        <span>الصافي: <b style={{ color: totals.net >= 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>{fmt(totals.net)}</b></span>
      </div>
      <div role="region" aria-label="جدول المعاملات المالية" tabIndex={0} style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)' }}>
            <tr>
              {['التاريخ', 'المنصة', 'النوع', 'الوصف', 'رقم الطلب', 'مدين', 'دائن', 'الصافي'].map(h => (
                <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const d = r.transaction_date ? new Date(r.transaction_date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' }) : '—'
              const meta = PLATFORM_META[r.platform]
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...S.td, fontSize: 11, whiteSpace: 'nowrap' }}>{d}</td>
                  <td style={{ ...S.td, fontSize: 11, color: meta?.color, fontWeight: 700 }}>{meta?.label || r.platform}</td>
                  <td style={{ ...S.td, fontSize: 11 }}>{financialTransactionMeta(r.transaction_type).label}</td>
                  <td style={{ ...S.td, fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }} title={r.description || ''}>{r.description || r.amount_description || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>{r.order_id || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--danger-text)', fontFamily: 'var(--font-data)' }}>{Number(r.debit) > 0 ? Number(r.debit).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--success-text)', fontFamily: 'var(--font-data)' }}>{Number(r.credit) > 0 ? Number(r.credit).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, fontWeight: 700, color: r.net_amount >= 0 ? 'var(--text)' : 'var(--danger-text)', fontFamily: 'var(--font-data)' }}>{Number(r.net_amount || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Cash flow forecast ────────────────────────────────────────────────────────
// ── التدفق النقدي التاريخي الشهري (كم دخل/خرج فعلياً من كشوف الحسابات) ──────────
function MonthlyCashflowPanel({ merchant }: { merchant: Merchant | null }) {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])
  async function load() {
    if (!merchant) return
    const { data } = await supabase.from('monthly_cashflow')
      .select('*').eq('merchant_code', merchant.merchant_code)
      .order('month', { ascending: false }).limit(18)
    setRows(data || [])
  }
  // تجميع كل المنصات لكل شهر
  const byMonth = useMemo(() => {
    const m: Record<string, { month: string; cash_in: number; cash_out: number; net: number }> = {}
    for (const r of rows) {
      const k = String(r.month)
      if (!m[k]) m[k] = { month: k, cash_in: 0, cash_out: 0, net: 0 }
      m[k].cash_in += Number(r.cash_in) || 0
      m[k].cash_out += Number(r.cash_out) || 0
      m[k].net += Number(r.net) || 0
    }
    return Object.values(m).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6)
  }, [rows])
  if (byMonth.length === 0) return null
  const maxAbs = Math.max(...byMonth.map(m => Math.max(m.cash_in, m.cash_out)), 1)
  const totalIn = byMonth.reduce((a, m) => a + m.cash_in, 0)
  const totalOut = byMonth.reduce((a, m) => a + m.cash_out, 0)
  return (
    <div style={{ ...S.card, marginBottom: 20, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <Landmark size={16} aria-hidden="true" /> التدفق النقدي الفعلي — آخر 6 أشهر
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', marginRight: 8 }}>(من كشوف حسابات المنصات)</span>
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard label="إجمالي الداخل" value={fmt(totalIn)} color="var(--success-text)" />
          <StatCard label="إجمالي الخارج" value={fmt(totalOut)} color="var(--danger-text)" />
          <StatCard label="صافي النقد" value={fmt(totalIn - totalOut)} color={totalIn - totalOut >= 0 ? 'var(--success-text)' : 'var(--danger-text)'} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {byMonth.map(m => {
            const label = new Date(m.month).toLocaleDateString('ar-SA-u-ca-gregory', { month: 'long', year: 'numeric' })
            return (
              <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 90, fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{label}</div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ height: 14, width: `${(m.cash_in / maxAbs) * 100}%`, minWidth: 2, background: 'var(--green)', borderRadius: 3 }} />
                    <span style={{ fontSize: 10, color: 'var(--success-text)', fontFamily: 'monospace' }}>{fmt(m.cash_in)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ height: 14, width: `${(m.cash_out / maxAbs) * 100}%`, minWidth: 2, background: 'var(--red)', borderRadius: 3 }} />
                    <span style={{ fontSize: 10, color: 'var(--danger-text)', fontFamily: 'monospace' }}>{fmt(m.cash_out)}</span>
                  </div>
                </div>
                <div style={{ width: 90, textAlign: 'left', fontSize: 13, fontWeight: 800, color: m.net >= 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>
                  {m.net >= 0 ? '+' : ''}{fmt(m.net)}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text3)', display: 'flex', gap: 16 }}>
          <span><span style={{ color: 'var(--green)' }}>▬</span> داخل (مبيعات/إيداعات)</span>
          <span><span style={{ color: 'var(--red)' }}>▬</span> خارج (رسوم/خصومات)</span>
        </div>
      </div>
    </div>
  )
}

// Retained temporarily for migration archaeology; the rendered panel was removed
// because marketplace payout debits were incorrectly presented as cash outflows.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CashFlowForecastLegacy({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])
  async function load() {
    if (!merchant) return
    const { data: rows } = await supabase.rpc('cash_flow_forecast', { p_merchant_code: merchant.merchant_code })
    setData(rows || [])
  }
  if (data.length === 0) return null
  const totalIn  = data.reduce((a, r) => a + (Number(r.expected_in) || 0), 0)
  const totalOut = data.reduce((a, r) => a + (Number(r.expected_out) || 0), 0)
  const net      = totalIn - totalOut
  return (
    <div style={{ ...S.card, marginBottom: 20, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
        توقّع التدفق النقدي (المستحقات القادمة)
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
          <StatCard label="مستحقات قادمة" value={fmt(totalIn)} color="var(--success-text)" />
          <StatCard label="مدفوعات قادمة" value={fmt(totalOut)} color="var(--danger-text)" />
          <StatCard label="الصافي المتوقّع" value={fmt(net)} color={net >= 0 ? 'var(--success-text)' : 'var(--danger-text)'} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['الفترة','عدد المعاملات','مستحقات','مدفوعات','الصافي'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...S.td, fontWeight: 700 }}>{r.bucket}</td>
                  <td style={S.td}>{r.count}</td>
                  <td style={{ ...S.td, color: 'var(--success-text)', fontFamily: 'monospace' }}>{fmt(Number(r.expected_in))}</td>
                  <td style={{ ...S.td, color: 'var(--danger-text)', fontFamily: 'monospace' }}>{fmt(Number(r.expected_out))}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: r.net >= 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>{fmt(Number(r.net))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Returns analytics ─────────────────────────────────────────────────────────
function ReturnsAnalytics({ merchant }: { merchant: Merchant | null; grossRevenue?: number }) {
  const [data, setData] = useState<any[]>([])
  const [orderCount, setOrderCount] = useState(0)
  const [allTimeRevenue, setAllTimeRevenue] = useState(0)
  const [commissionByPlatform, setCommissionByPlatform] = useState<Record<string, number>>({})
  const [shippingByPlatform, setShippingByPlatform] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])
  async function load() {
    if (!merchant) return
    setLoading(true)
    const [rows, { count }, { data: rates }, perfRows] = await Promise.all([
      fetchAll<any>((f, t) => supabase.from('returns').select('*').eq('merchant_code', merchant.merchant_code).order('id').range(f, t), 'المرتجعات'),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('merchant_code', merchant.merchant_code),
      supabase.from('platform_commission_rates').select('platform, rate, shipping_fee'),
      // إيراد كل الفترات: المرتجعات هنا تاريخية كاملة، فيجب أن يكون مقام النسبة تاريخياً كاملاً أيضاً
      // (كانت تُقسم على إيراد الشهر المعروض فقط → نسب عبثية مثل 911%)
      fetchAll<any>((f, t) => supabase.from('performance_data').select('total_sales').eq('merchant_code', merchant.merchant_code).order('id').range(f, t), 'الإيراد الكلي'),
    ])
    setData(rows)
    setOrderCount(count || 0)
    setAllTimeRevenue(perfRows.reduce((a: number, r: any) => a + (Number(r.total_sales) || 0), 0))
    const cm: Record<string, number> = {}, sh: Record<string, number> = {}
    for (const r of (rates || [])) { cm[r.platform] = Number(r.rate) || 0; sh[r.platform] = Number(r.shipping_fee) || 0 }
    setCommissionByPlatform(cm); setShippingByPlatform(sh)
    setLoading(false)
  }

  const stats = useMemo(() => {
    const total = data.reduce((a, r) => a + (Number(r.return_amount) || 0), 0)
    const count = data.length
    const refunded = data.filter(r => r.status === 'refunded' || r.status === 'processed').length
    const pending  = data.filter(r => r.status === 'pending').length
    const rateOfRevenue = allTimeRevenue > 0 ? (total / allTimeRevenue) * 100 : 0
    const rateOfOrders  = orderCount > 0 ? (count / orderCount) * 100 : 0

    // الخسائر المتكبدة = العمولات + الشحن على القيم المرتجعة
    let lossFees = 0, lossShipping = 0
    for (const r of data) {
      const cmRate = commissionByPlatform[r.platform] || 12  // افتراضي 12%
      const shFee  = shippingByPlatform[r.platform] || 0
      const ret    = Number(r.return_amount) || 0
      const qty    = Number(r.quantity) || 1
      lossFees     += (ret * cmRate) / 100
      lossShipping += shFee * qty
    }
    const lossTotal = lossFees + lossShipping
    return { total, count, refunded, pending, rateOfRevenue, rateOfOrders, lossFees, lossShipping, lossTotal }
  }, [data, allTimeRevenue, orderCount, commissionByPlatform, shippingByPlatform])

  const byPlatform = useMemo(() => {
    const m: Record<string, { count: number; amount: number }> = {}
    for (const r of data) {
      if (!m[r.platform]) m[r.platform] = { count: 0, amount: 0 }
      m[r.platform].count += 1
      m[r.platform].amount += Number(r.return_amount) || 0
    }
    return Object.entries(m).map(([p, v]) => ({ platform: p, ...v })).sort((a, b) => b.amount - a.amount)
  }, [data])

  const topReasons = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of data) {
      const k = r.reason || 'غير محدّد'
      m[k] = (m[k] || 0) + 1
    }
    return Object.entries(m).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [data])

  const topProducts = useMemo(() => {
    const m: Record<string, { count: number; amount: number }> = {}
    for (const r of data) {
      const k = r.product_name || 'غير محدّد'
      if (!m[k]) m[k] = { count: 0, amount: 0 }
      m[k].count += 1
      m[k].amount += Number(r.return_amount) || 0
    }
    return Object.entries(m).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [data])

  if (loading || data.length === 0) return null

  return (
    <div style={{ ...S.card, marginBottom: 20, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
        تحليل المرتجعات
      </div>
      <div style={{ padding: 20 }}>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
          <StatCard label="عدد المرتجعات" value={stats.count.toString()} sub={`من ${orderCount} طلب`} color="var(--warning-text)" />
          <StatCard label="نسبة الإرجاع" value={stats.rateOfOrders.toFixed(1) + '%'} sub={stats.rateOfOrders > 10 ? 'مرتفعة' : stats.rateOfOrders > 5 ? 'متوسطة' : 'طبيعية'} color={stats.rateOfOrders > 10 ? 'var(--danger-text)' : stats.rateOfOrders > 5 ? 'var(--warning-text)' : 'var(--success-text)'} />
          <StatCard label="القيمة المرتجعة (كل الفترات)" value={fmt(stats.total)} sub={stats.rateOfRevenue.toFixed(1) + '% من إجمالي الإيراد الكلي'} color="var(--danger-text)" />
          <StatCard label="الخسائر المتكبدة" value={fmt(stats.lossTotal)} sub={`عمولة ${fmt(stats.lossFees)} · شحن ${fmt(stats.lossShipping)}`} color="var(--danger-text)" />
          <StatCard label="مُسترد" value={stats.refunded.toString()} sub={stats.pending > 0 ? `${stats.pending} قيد المراجعة` : 'مكتمل'} color="#0f958c" />
        </div>

        {/* صدق: المرتجعات تعتمد على التقارير المرفوعة — صفر لا يعني «لا مرتجعات» بل قد يعني «لم يُرفع الملف» */}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 800 }}>ملاحظة</span>
          تعكس هذه الأرقام تقارير المرتجعات المرفوعة فقط — إن كانت منصة بلا مرتجعات فقد يكون تقريرها لم يُرفع بعد.
        </div>

        {/* By platform */}
        {byPlatform.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 10 }}>المرتجعات حسب المنصة</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byPlatform.map(p => {
                const meta = PLATFORM_META[p.platform]
                const pct = stats.total > 0 ? (p.amount / stats.total) * 100 : 0
                return (
                  <div key={p.platform} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ minWidth: 80, fontSize: 12, fontWeight: 700, color: meta?.color || 'var(--text)' }}>{meta?.label || p.platform}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: meta?.color || 'var(--accent)', borderRadius: 4, transition: 'width 0.6s' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text3)', minWidth: 50, textAlign: 'left' }}>{p.count} مرتجع</span>
                    <span style={{ fontSize: 12, fontWeight: 700, minWidth: 90, textAlign: 'left' }}>{fmt(p.amount)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Top products + reasons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {topProducts.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>أكثر المنتجات إرجاعاً</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topProducts.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={p.name}>{p.name}</span>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <span style={{ color: 'var(--text3)' }}>{p.count}×</span>
                      <span style={{ fontWeight: 700, color: 'var(--danger-text)' }}>{fmt(p.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topReasons.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>أكثر الأسباب</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topReasons.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12 }}>
                    <span>{r.reason}</span>
                    <span style={{ fontWeight: 700, color: 'var(--warning-text)' }}>{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ── Returns mini-section ──────────────────────────────────────────────────────

function ReturnsSection({ merchant, month, year, onUpdate }: { merchant: Merchant | null; month: number; year: number; onUpdate: () => void }) {
  const [returns, setReturns] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ platform: 'amazon', order_id: '', product_name: '', quantity: '1', return_amount: '', reason: '', return_date: new Date().toISOString().split('T')[0], status: 'pending' })
  const [saving, setSaving] = useState(false)
  const [returnActionId, setReturnActionId] = useState<string | null>(null)
  const [returnActionMessage, setReturnActionMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [rejectingReturn, setRejectingReturn] = useState<any | null>(null)
  const [rejectReasons, setRejectReasons] = useState<ReturnReasonOption[]>([])
  const [rejectReasonId, setRejectReasonId] = useState('')
  const [rejectDescription, setRejectDescription] = useState('')
  const [approvingReturn, setApprovingReturn] = useState<any | null>(null)
  const [syncingClaims, setSyncingClaims] = useState(false)

  // The returns query is intentionally keyed by the selected period.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadReturns() }, [month, year, merchant?.merchant_code])

  async function loadReturns() {
    if (!merchant) return
    const start = `${year}-${String(month).padStart(2,'0')}-01`
    const end = new Date(year, month, 0).toISOString().split('T')[0]
    const [periodRows, pendingRows] = await Promise.all([
      fetchAll<any>((f, t) => supabase.from('returns').select('*').eq('merchant_code', merchant.merchant_code)
        .gte('return_date', start).lte('return_date', end)
        .order('created_at', { ascending: false }).order('id').range(f, t), 'مرتجعات الفترة'),
      fetchAll<any>((f, t) => supabase.from('returns').select('*').eq('merchant_code', merchant.merchant_code)
        .eq('platform', 'trendyol').eq('status', 'pending')
        .order('created_at', { ascending: false }).order('id').range(f, t), 'قرارات المرتجعات'),
    ])
    const rowsById = new Map([...pendingRows, ...periodRows].map(row => [row.id, row]))
    setReturns([...rowsById.values()])
  }

  async function refreshClaims() {
    if (!merchant || syncingClaims) return
    setSyncingClaims(true); setReturnActionMessage(null)
    const { data, error } = await supabase.functions.invoke('sync-trendyol', { body: { merchant_code: merchant.merchant_code } })
    if (error || data?.error) {
      setReturnActionMessage({ type:'err', text:data?.error || error?.message || 'تعذر تحديث المرتجعات من Trendyol.' })
    } else {
      await loadReturns(); onUpdate()
      setReturnActionMessage({ type:'ok', text:'تم تحديث طلبات المرتجعات من Trendyol.' })
    }
    setSyncingClaims(false)
  }

  async function addReturn() {
    if (!form.return_amount) return
    setSaving(true)
    await supabase.from('returns').insert({
      merchant_code: merchant!.merchant_code,
      platform: form.platform,
      order_id: form.order_id || null,
      product_name: form.product_name || null,
      quantity: parseInt(form.quantity) || 1,
      return_amount: parseFloat(form.return_amount) || 0,
      reason: form.reason || null,
      return_date: form.return_date,
      status: form.status,
    })
    setSaving(false)
    setShowForm(false)
    setForm(f => ({ ...f, order_id: '', product_name: '', quantity: '1', return_amount: '', reason: '' }))
    loadReturns()
    onUpdate()
  }

  async function loadRejectReasons(row: any) {
    setRejectingReturn(row)
    setReturnActionMessage(null)
    if (rejectReasons.length) return
    setReturnActionId(String(row.id))
    const { data, error } = await supabase.functions.invoke('trendyol-actions', {
      body: { merchant_code: merchant!.merchant_code, action: 'claims.issue_reasons', storefront: 'SA' },
    })
    setReturnActionId(null)
    if (error || data?.error) {
      setRejectingReturn(null)
      setReturnActionMessage({ type: 'err', text: data?.error || error?.message || 'تعذر تحميل أسباب رفض المرتجع من Trendyol.' })
      return
    }
    const options = parseReturnReasonOptions(data?.data)
    if (!options.length) {
      setRejectingReturn(null)
      setReturnActionMessage({ type: 'err', text: 'لم يرسل Trendyol قائمة أسباب متاحة للرفض في الوقت الحالي.' })
      return
    }
    setRejectReasons(options)
    setRejectReasonId(options[0].id)
  }

  async function runReturnDecision(row: any, decision: 'approve' | 'reject') {
    if (!row.claim_id || !row.provider_claim_item_id) {
      setReturnActionMessage({ type: 'err', text: 'بيانات المرتجع غير مكتملة. حدّث بيانات Trendyol ثم حاول مرة أخرى.' })
      return
    }
    if (decision === 'reject' && !rejectReasonId) {
      setReturnActionMessage({ type: 'err', text: 'اختر سبب رفض المرتجع.' })
      return
    }
    const label = decision === 'approve' ? 'الموافقة على المرتجع' : 'رفض المرتجع'
    setReturnActionId(String(row.id)); setReturnActionMessage(null)
    const body = decision === 'approve'
      ? {
          merchant_code: merchant!.merchant_code,
          action: 'claims.approve',
          path: { claimId: row.claim_id },
          payload: { claimLineItemIdList: [row.provider_claim_item_id] },
          confirm: true,
          idempotency_key: crypto.randomUUID(),
        }
      : {
          merchant_code: merchant!.merchant_code,
          action: 'claims.reject',
          path: { claimId: row.claim_id },
          query: {
            claimIssueReasonId: rejectReasonId,
            claimItemIdList: row.provider_claim_item_id,
            description: rejectDescription.trim() || 'تمت المراجعة من التاجر عبر Sellpert',
          },
          confirm: true,
          idempotency_key: crypto.randomUUID(),
        }
    const { data, error } = await supabase.functions.invoke('trendyol-actions', { body })
    if (error || data?.error) {
      setReturnActionMessage({ type: 'err', text: data?.error || error?.message || `تعذر ${label}.` })
      setReturnActionId(null)
      return
    }
    const syncResult = await supabase.functions.invoke('sync-trendyol', { body: { merchant_code: merchant!.merchant_code } })
    await loadReturns()
    onUpdate()
    setRejectingReturn(null); setApprovingReturn(null); setRejectDescription(''); setReturnActionId(null)
    setReturnActionMessage({
      type: 'ok',
      text: syncResult.error || syncResult.data?.error
        ? `تم ${label} في Trendyol. ستتحدث الحالة تلقائيًا مع المزامنة التالية.`
        : `تم ${label} في Trendyol وتحديث حالة المرتجع.`,
    })
  }

  const pendingDecisions = returns.filter(row => row.platform === 'trendyol' && row.status === 'pending' && row.claim_id && row.provider_claim_item_id)
  const completedDecisions = returns.filter(row => ['approved','refunded'].includes(String(row.status || '').toLowerCase())).length
  const rejectedDecisions = returns.filter(row => String(row.status || '').toLowerCase() === 'rejected').length
  const totalReturns = returns.reduce((s, r) => s + Number(r.return_amount || 0), 0)

  return (
    <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>إدارة المرتجعات</div>
          <div style={{ fontSize: 11, color:'var(--text3)', marginTop:4 }}>راجع طلبات العملاء واتخذ القرار مباشرة في Trendyol</div>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button style={S.addBtn} onClick={() => void refreshClaims()} disabled={syncingClaims}>
            <RefreshCw size={14} aria-hidden="true" style={{ marginLeft:6, verticalAlign:'middle' }} />
            {syncingClaims ? 'جارٍ التحديث...' : 'تحديث من Trendyol'}
          </button>
          <button style={S.addBtn} onClick={() => setShowForm(v => !v)}>{showForm ? 'إلغاء' : 'إضافة مرتجع يدويًا'}</button>
        </div>
      </div>

      <div style={{ padding:'16px 20px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:10, borderBottom:'1px solid var(--border)' }}>
        {[
          { label:'تحتاج قرارك', value:pendingDecisions.length, color:pendingDecisions.length ? 'var(--warning-text)' : 'var(--text)' },
          { label:'مقبولة أو مستردة', value:completedDecisions, color:'var(--success-text)' },
          { label:'مرفوضة', value:rejectedDecisions, color:'var(--danger-text)' },
          { label:'قيمة المرتجعات المعروضة', value:fmt(totalReturns), color:'var(--text)' },
        ].map(item => <div key={item.label} style={{ padding:'12px 14px', border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
          <div style={{ fontSize:11, color:'var(--text3)', marginBottom:5 }}>{item.label}</div>
          <div style={{ fontSize:17, fontWeight:800, color:item.color }}>{item.value}</div>
        </div>)}
      </div>

      {showForm && (
        <div style={{ padding: '16px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
            {[
              { label: 'المنصة', key: 'platform', type: 'select', opts: ['amazon','noon','trendyol'] },
              { label: 'رقم الطلب', key: 'order_id', type: 'text', placeholder: 'اختياري' },
              { label: 'اسم المنتج', key: 'product_name', type: 'text', placeholder: 'اختياري' },
              { label: 'الكمية', key: 'quantity', type: 'number', placeholder: '1' },
              { label: 'مبلغ المرتجع (ر.س) *', key: 'return_amount', type: 'number', placeholder: '0' },
              { label: 'تاريخ المرتجع', key: 'return_date', type: 'date', placeholder: '' },
              { label: 'الحالة', key: 'status', type: 'select', opts: ['pending','approved','refunded'] },
              { label: 'السبب', key: 'reason', type: 'text', placeholder: 'اختياري' },
            ].map(f => (
              <div key={f.key}>
                <label style={S.label}>{f.label}</label>
                {f.type === 'select' ? (
                  <select style={S.input} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}>
                    {f.opts!.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input style={S.input} type={f.type} placeholder={f.placeholder} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
          <button style={{ background: 'var(--accent-strong)', border: 'none', color: '#fff', padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }} onClick={addReturn} disabled={saving}>
            {saving ? 'جارٍ الحفظ...' : 'حفظ المرتجع'}
          </button>
        </div>
      )}

      {returnActionMessage ? (
        <div style={{ margin: '14px 20px 0', padding: '10px 12px', borderRadius: 8, fontSize: 12, background: returnActionMessage.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color: returnActionMessage.type === 'ok' ? 'var(--success-text)' : 'var(--danger-text)' }}>
          {returnActionMessage.text}
        </div>
      ) : null}

      {approvingReturn ? (
        <div role="dialog" aria-modal="true" aria-labelledby="approve-return-title" style={{ margin:'14px 20px 0', padding:14, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
          <div id="approve-return-title" style={{ fontSize:13, fontWeight:800, marginBottom:4 }}>تأكيد قبول طلب المرتجع</div>
          <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            سيتم إرسال الموافقة مباشرة إلى Trendyol للمنتج «{approvingReturn.product_name || 'المنتج'}»
            {approvingReturn.order_id ? ` في الطلب ${approvingReturn.order_id}` : ''}. لا يمكن التراجع عن القرار من Sellpert بعد إرساله.
          </div>
          <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
            <button autoFocus style={{ ...S.addBtn, background:'var(--success-bg)', color:'var(--success-text)' }} disabled={returnActionId === String(approvingReturn.id)} onClick={() => void runReturnDecision(approvingReturn, 'approve')}>
              {returnActionId === String(approvingReturn.id) ? 'جارٍ إرسال القرار...' : 'تأكيد القبول وإرساله'}
            </button>
            <button style={S.addBtn} disabled={returnActionId === String(approvingReturn.id)} onClick={() => setApprovingReturn(null)}>العودة دون إرسال</button>
          </div>
        </div>
      ) : null}

      {rejectingReturn ? (
        <div role="dialog" aria-modal="true" aria-labelledby="reject-return-title" style={{ margin: '14px 20px 0', padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface2)' }}>
          <div id="reject-return-title" style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>رفض مرتجع {rejectingReturn.product_name || `الطلب ${rejectingReturn.order_id || ''}`}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>اختر السبب الذي سيُرسل إلى Trendyol. لن يتم تنفيذ القرار قبل التأكيد النهائي.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <select aria-label="سبب رفض المرتجع" style={S.input} value={rejectReasonId} onChange={event => setRejectReasonId(event.target.value)}>
              {rejectReasons.map(reason => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
            </select>
            <input aria-label="ملاحظة رفض المرتجع" style={S.input} value={rejectDescription} onChange={event => setRejectDescription(event.target.value)} placeholder="ملاحظة توضح سبب الرفض (اختيارية)" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button style={{ ...S.addBtn, background: 'var(--danger-bg)', color: 'var(--danger-text)' }} disabled={returnActionId === String(rejectingReturn.id)} onClick={() => void runReturnDecision(rejectingReturn, 'reject')}>
              {returnActionId === String(rejectingReturn.id) ? 'جارٍ الإرسال...' : 'تأكيد رفض المرتجع'}
            </button>
            <button style={S.addBtn} onClick={() => setRejectingReturn(null)}>إلغاء</button>
          </div>
        </div>
      ) : null}

      {returns.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>لا توجد مرتجعات هذا الشهر</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['التاريخ','المنصة','المصدر','المنتج','السبب','الكمية','المبلغ','الحالة','الإجراءات'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {returns.map(r => {
                const statusMeta = RETURN_STATUS_META[String(r.status || '').toLowerCase()] || RETURN_STATUS_META.pending
                const isPendingTrendyol = r.platform === 'trendyol' && r.status === 'pending' && r.claim_id && r.provider_claim_item_id
                return <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...S.td, fontSize: 11 }}>{r.return_date}</td>
                  <td style={{ ...S.td, color: PLATFORM_META[r.platform]?.color, fontWeight: 700 }}>{PLATFORM_META[r.platform]?.label || r.platform}</td>
                  <td style={S.td}>{r.platform === 'trendyol' && r.claim_id ? 'ربط Trendyol' : r.upload_id ? 'ملف مرفوع' : 'إدخال يدوي'}</td>
                  <td style={{ ...S.td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name || '—'}</td>
                  <td style={{ ...S.td, maxWidth: 180 }}>{returnReasonLabel(r.reason)}</td>
                  <td style={S.td}>{r.quantity}</td>
                  <td style={{ ...S.td, color: 'var(--warning-text)', fontWeight: 700 }}>{fmt(r.return_amount)}</td>
                  <td style={S.td}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 7, background: statusMeta.bg, color: statusMeta.color, whiteSpace: 'nowrap' }}>
                      {statusMeta.label}
                    </span>
                  </td>
                  <td style={S.td}>
                    {isPendingTrendyol ? <div style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
                      <button style={{ ...S.addBtn, color: 'var(--success-text)' }} disabled={returnActionId === String(r.id)} onClick={() => { setRejectingReturn(null); setReturnActionMessage(null); setApprovingReturn(r) }}>
                        قبول الطلب
                      </button>
                      <button style={{ ...S.addBtn, color: 'var(--danger-text)' }} disabled={returnActionId === String(r.id)} onClick={() => { setApprovingReturn(null); void loadRejectReasons(r) }}>رفض الطلب</button>
                    </div> : <span style={{ fontSize: 11, color: 'var(--text3)' }}>لا يوجد إجراء مطلوب</span>}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── P&L Statement ────────────────────────────────────────────────────────────
function PnLPanel({ merchant, year, month }: { merchant: Merchant | null; year: number; month: number }) {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    if (!merchant) return
    supabase.rpc('pnl_statement', { p_merchant_code: merchant.merchant_code, p_year: year, p_month: month })
      .then(({ data }) => setData(data))
  }, [merchant, year, month])
  if (!data || Number(data.revenue) === 0) return null
  const lines = [
    { label: 'الإيرادات', value: Number(data.revenue), bold: true, color: 'var(--text)' },
    { label: 'تكلفة البضاعة المباعة (COGS)', value: -Number(data.cogs), color: 'var(--danger-text)' },
    null,
    { label: 'الربح الإجمالي', value: Number(data.gross_profit), bold: true, color: 'var(--accent2)', sub: data.gross_margin_pct ? `هامش ${data.gross_margin_pct}%` : '' },
    { label: 'رسوم المنصات', value: -Number(data.platform_fees), color: 'var(--danger-text)' },
    { label: 'الإنفاق الإعلاني', value: -Number(data.ad_spend), color: 'var(--danger-text)' },
    { label: 'المرتجعات', value: -Number(data.returns), color: 'var(--warning-text)' },
    null,
    { label: 'صافي الدخل', value: Number(data.net_income), bold: true, large: true, color: Number(data.net_income) >= 0 ? 'var(--accent2)' : 'var(--danger-text)', sub: data.net_margin_pct ? `هامش صافي ${data.net_margin_pct}%` : '' },
  ] as any[]
  return (
    <div style={{ ...S.card, padding: 0, marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
        قائمة الأرباح والخسائر (P&L)
      </div>
      <div style={{ padding: 20 }}>
        {lines.map((row, i) => row === null ? (
          <div key={i} style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
        ) : (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
            <div>
              <span style={{ fontSize: row.bold ? 13 : 12, fontWeight: row.bold ? 700 : 500, color: row.bold ? 'var(--text)' : 'var(--text2)' }}>{row.label}</span>
              {row.sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{row.sub}</div>}
            </div>
            <span style={{ fontSize: row.large ? 20 : row.bold ? 14 : 13, fontWeight: row.bold ? 800 : 600, color: row.color, fontFamily: 'monospace' }}>
              {row.value < 0 ? '−' : ''}{fmt(Math.abs(row.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Revenue Forecast ─────────────────────────────────────────────────────────
function RevenueForecastPanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    if (!merchant) return
    supabase.rpc('revenue_forecast', { p_merchant_code: merchant.merchant_code }).then(({ data }) => setData(data))
  }, [merchant])
  if (!data || !Number(data.avg_daily)) return null
  const growth = data.growth_rate_pct
  const confidence = ({ high: 'مرتفعة', medium: 'متوسطة', low: 'منخفضة' } as Record<string, string>)[data.confidence] || 'منخفضة'
  return (
    <div style={{ ...S.card, padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>توقّع المبيعات خلال 30 يومًا</div>
        <span style={{ padding: '4px 7px', borderRadius: 5, fontSize: 9, fontWeight: 800, background: data.confidence === 'high' ? 'var(--success-bg)' : data.confidence === 'medium' ? 'var(--warning-bg)' : 'var(--danger-bg)', color: data.confidence === 'high' ? 'var(--success-text)' : data.confidence === 'medium' ? 'var(--warning-text)' : 'var(--danger-text)' }}>ثقة {confidence}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>
        مبني على معدل البيع الحديث مع ضبط اتجاه النمو وإظهار نطاق عدم اليقين
        {growth !== null && <> · النمو: <span style={{ color: growth >= 0 ? 'var(--success-text)' : 'var(--danger-text)', fontWeight: 700 }}>{growth >= 0 ? '+' : ''}{growth}%</span></>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <ForecastBox label="آخر 30 يوم (فعلي)" value={fmt(Number(data.last_30_sales))} color="#0f958c" />
        <ForecastBox label="المتوقع" value={fmt(Number(data.forecast_30))} color="var(--success-text)" />
        <ForecastBox label="الحد الأدنى المتوقع" value={fmt(Number(data.lower_30))} color="var(--warning-text)" />
        <ForecastBox label="الحد الأعلى المتوقع" value={fmt(Number(data.upper_30))} color="var(--info-text)" />
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', color: 'var(--text3)', fontSize: 10, lineHeight: 1.7 }}>{data.caveat}</div>
    </div>
  )
}

function ForecastBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
    </div>
  )
}

// ── Return Reasons Deep Dive ──────────────────────────────────────────────────
function ReturnReasonsBreakdown({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.rpc('return_reasons_breakdown', { p_merchant_code: merchant.merchant_code }).then(({ data }) => setData(data || []))
  }, [merchant])
  if (data.length === 0) return null
  const labels: Record<string, string> = {
    customer: 'ألغاها العميل', trendyol: 'ألغتها المنصة', seller: 'ألغيتها أنت',
    dislike: 'لم يعجبني', defective: 'منتج معيب', wrong_product: 'منتج خاطئ',
    changed_mind: 'غيّر رأيه', mismatch: 'لا يطابق الصورة', bad_quality: 'جودة سيئة',
    too_small: 'صغير جداً', too_large: 'كبير جداً', wrong_order: 'طلب خاطئ',
    not_delivered: 'لم يُسلَّم', shipping_failed: 'فشل الشحن',
    transit: 'إرجاع أثناء النقل', no_tracking: 'بدون تتبع',
    unfulfilled: 'غير مستوفى', late_delivery: 'تأخر التسليم',
    no_confirm: 'لا تأكيد عميل', compensation: 'تعويضات', other: 'غير ذلك',
  }
  return (
    <div style={{ ...S.card, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>تحليل أسباب المرتجعات</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.slice(0, 10).map((r, i) => {
          const pct = Number(r.percentage)
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ minWidth: 130, fontSize: 12, fontWeight: 600 }}>{labels[r.reason] || r.reason}</span>
              <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(pct * 2, 100)}%`, background: '#ff6b6b', borderRadius: 4 }} />
              </div>
              <span style={{ minWidth: 60, textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#ff6b6b' }}>{r.count} ({pct}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  card:   { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 },
  navBtn: { background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px', fontWeight: 800 },
  th:     { padding: '10px 16px', textAlign: 'right' as const, fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const },
  td:     { padding: '11px 16px', fontSize: 13 },
  label:  { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase' as const },
  input:  { width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  addBtn: { background: 'var(--accent-strong)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' },
}
