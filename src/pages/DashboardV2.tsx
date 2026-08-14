import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Boxes, CalendarDays, CheckCircle2, ChevronDown, Clock3, Layers3, Minus, Package, RefreshCw, ShoppingCart, TrendingDown, TrendingUp, WalletCards } from 'lucide-react'
import { fetchAll } from '../lib/db'
import { listPlatformCredentials } from '../lib/platformCredentialManager'
import { PLATFORM_COLORS, PLATFORM_MAP } from '../lib/constants'
import { supabase, type Merchant, type PlatformCredential } from '../lib/supabase'
import { createCatalogResolver, type CatalogChannelMapping, type CatalogProductIdentity } from '../lib/catalogIdentity'
import './DashboardV2.css'

type PhaseOneView = 'orders' | 'products' | 'product-catalog' | 'inventory' | 'integrations'
type DatePreset = '7' | '30' | '90' | 'month' | 'custom'
type OrderRow = { order_id:string; platform:string; status:string; product_name:string|null; sku:string|null; quantity:number; total_amount:number; currency:string; order_date:string }
type OrderItemRow = { order_id:string; platform:string; barcode:string|null; sku:string|null; product_name:string|null; quantity:number; line_total:number }
type StockRow = { sku:string; product_name:string|null; platform:string; quantity:number; reserved_quantity:number|null }
type ReturnRow = { sku:string|null; product_name:string|null; platform:string; quantity:number|null; return_amount:number|null; return_date:string }

const STATUS_PENDING = new Set(['pending', 'processing', 'new', 'confirmed', 'ready_to_ship'])

function money(value:number) { return new Intl.NumberFormat('ar-SA-u-nu-latn', { style:'currency', currency:'SAR', maximumFractionDigits:0 }).format(value || 0) }
function number(value:number) { return new Intl.NumberFormat('ar-SA-u-nu-latn').format(value || 0) }
function isoDate(date:Date) { return date.toISOString().slice(0, 10) }
function riyadhDateKey(value:Date|string) { return new Date(value).toLocaleDateString('en-CA', { timeZone:'Asia/Riyadh' }) }
function platformName(key:string) { return PLATFORM_MAP[key] || key }
function platformColor(key:string) { return PLATFORM_COLORS[key] || '#64748b' }
function initialFilters() {
  const params = new URLSearchParams(window.location.search)
  const period = params.get('period')
  const preset:DatePreset = ['7','30','90','month','custom'].includes(period || '') ? period as DatePreset : '30'
  const platforms = (params.get('platforms') || '').split(',').map(value => value.trim()).filter(Boolean)
  const today = new Date()
  return {
    preset,
    platforms,
    from: params.get('from') || isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: params.get('to') || isoDate(today),
  }
}
function periodDelta(current:number, previous:number) {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}
function relativeTime(value?:string|null) {
  if (!value) return 'لم تتم المزامنة بعد'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `قبل ${number(minutes)} دقيقة`
  if (minutes < 1440) return `قبل ${number(Math.floor(minutes / 60))} ساعة`
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day:'numeric', month:'short', year:'numeric' }).format(new Date(value))
}

export default function DashboardV2({ merchant, onNavigate }: { merchant:Merchant|null; onNavigate:(view:PhaseOneView, query?:Record<string,string>)=>void }) {
  const initial = useMemo(initialFilters, [])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [catalogProducts, setCatalogProducts] = useState<CatalogProductIdentity[]>([])
  const [catalogMappings, setCatalogMappings] = useState<CatalogChannelMapping[]>([])
  const [credentials, setCredentials] = useState<PlatformCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [partial, setPartial] = useState(false)
  const [preset, setPreset] = useState<DatePreset>(initial.preset)
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(initial.platforms)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  useEffect(() => {
    const applyLocation = () => {
      const next = initialFilters()
      setPreset(next.preset); setSelectedPlatforms(next.platforms); setFrom(next.from); setTo(next.to)
    }
    window.addEventListener('popstate', applyLocation)
    return () => window.removeEventListener('popstate', applyLocation)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('period', preset)
    if (selectedPlatforms.length) params.set('platforms', selectedPlatforms.join(',')); else params.delete('platforms')
    if (preset === 'custom') { params.set('from', from); params.set('to', to) }
    else { params.delete('from'); params.delete('to') }
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }, [preset, selectedPlatforms, from, to])

  useEffect(() => {
    const code = merchant?.merchant_code
    if (!code) return
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      fetchAll<OrderRow>((f,t) => supabase.from('orders').select('order_id,platform,status,product_name,sku,quantity,total_amount,currency,order_date').eq('merchant_code', code).order('order_date', { ascending:false }).range(f,t), 'طلبات لوحة التحكم'),
      fetchAll<OrderItemRow>((f,t) => supabase.from('order_items').select('order_id,platform,barcode,sku,product_name,quantity,line_total').eq('merchant_code', code).order('order_id').range(f,t), 'بنود طلبات لوحة التحكم'),
      fetchAll<StockRow>((f,t) => supabase.from('inventory').select('sku,product_name,platform,quantity,reserved_quantity').eq('merchant_code', code).eq('is_active', true).range(f,t), 'مخزون لوحة التحكم'),
      fetchAll<ReturnRow>((f,t) => supabase.from('returns').select('sku,product_name,platform,quantity,return_amount,return_date').eq('merchant_code', code).order('return_date', { ascending:false }).range(f,t), 'مرتجعات لوحة التحكم'),
      fetchAll<CatalogProductIdentity>((f,t) => supabase.from('products').select('id,name,name_en,sku,barcode,psku_code,noon_sku_child,asin,external_id,supplier_sku,model_code').eq('merchant_code', code).order('id').range(f,t), 'دليل منتجات لوحة التحكم'),
      fetchAll<CatalogChannelMapping>((f,t) => supabase.from('product_channel_mappings').select('product_id,platform,identifier_value,source_sku,source_barcode,source_name,match_status').eq('merchant_code', code).order('id').range(f,t), 'روابط دليل المنتجات'),
      listPlatformCredentials(code),
    ]).then(results => {
      if (cancelled) return
      const [o,oi,s,r,p,m,c] = results
      setOrders(o.status === 'fulfilled' ? o.value : [])
      setOrderItems(oi.status === 'fulfilled' ? oi.value : [])
      setStock(s.status === 'fulfilled' ? s.value : [])
      setReturns(r.status === 'fulfilled' ? r.value : [])
      setCatalogProducts(p.status === 'fulfilled' ? p.value : [])
      setCatalogMappings(m.status === 'fulfilled' ? m.value : [])
      setCredentials(c.status === 'fulfilled' ? c.value : [])
      setPartial(results.some(x => x.status === 'rejected'))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [merchant?.merchant_code])

  const bounds = useMemo(() => {
    const end = new Date(); end.setHours(23,59,59,999)
    let start:Date
    if (preset === 'custom') { start = new Date(`${from}T00:00:00`); const customEnd = new Date(`${to}T23:59:59`); return [start, customEnd] as const }
    if (preset === 'month') start = new Date(end.getFullYear(), end.getMonth(), 1)
    else { start = new Date(end); start.setDate(start.getDate() - Number(preset) + 1); start.setHours(0,0,0,0) }
    return [start,end] as const
  }, [preset, from, to])

  const availablePlatforms = useMemo(() => [...new Set([
    ...orders.map(row => row.platform),
    ...returns.map(row => row.platform),
    ...stock.map(row => row.platform),
    ...credentials.map(row => row.platform),
  ].filter(Boolean))].sort(), [orders, returns, stock, credentials])
  const activePlatformSet = useMemo(() => selectedPlatforms.length ? new Set(selectedPlatforms) : null, [selectedPlatforms])
  const selected = useMemo(() => orders.filter(o => {
    const d = new Date(o.order_date)
    return d >= bounds[0] && d <= bounds[1] && (!activePlatformSet || activePlatformSet.has(o.platform))
  }), [orders,bounds,activePlatformSet])
  const previousBounds = useMemo(() => {
    const duration = bounds[1].getTime() - bounds[0].getTime() + 1
    const end = new Date(bounds[0].getTime() - 1)
    return [new Date(end.getTime() - duration + 1), end] as const
  }, [bounds])
  const previousSelected = useMemo(() => orders.filter(o => {
    const d = new Date(o.order_date)
    return d >= previousBounds[0] && d <= previousBounds[1] && (!activePlatformSet || activePlatformSet.has(o.platform))
  }), [orders, previousBounds, activePlatformSet])
  const selectedReturns = useMemo(() => returns.filter(r => {
    const d = new Date(r.return_date)
    return d >= bounds[0] && d <= bounds[1] && (!activePlatformSet || activePlatformSet.has(r.platform))
  }), [returns,bounds,activePlatformSet])
  const selectedStock = useMemo(() => stock.filter(row => !activePlatformSet || activePlatformSet.has(row.platform)), [stock, activePlatformSet])
  const uniqueOrders = useMemo(() => Array.from(new Map(selected.map(o => [`${o.platform}:${o.order_id}`, o])).values()), [selected])
  const revenue = selected.reduce((sum,o) => sum + Number(o.total_amount || 0), 0)
  const previousRevenue = previousSelected.reduce((sum,o) => sum + Number(o.total_amount || 0), 0)
  const revenueDelta = periodDelta(revenue, previousRevenue)
  const pending = new Set(orders.filter(o => (!activePlatformSet || activePlatformSet.has(o.platform)) && STATUS_PENDING.has(String(o.status).toLowerCase())).map(o => `${o.platform}:${o.order_id}`)).size
  const outStock = selectedStock.filter(s => Number(s.quantity || 0) - Number(s.reserved_quantity || 0) <= 0).length
  const outStockRate = selectedStock.length ? outStock / selectedStock.length * 100 : 0

  function togglePlatform(platform:string) {
    setSelectedPlatforms(current => {
      const active = current.length ? current : availablePlatforms
      if (active.includes(platform)) return active.length === 1 ? current : active.filter(value => value !== platform)
      const next = [...active, platform].sort()
      return next.length === availablePlatforms.length ? [] : next
    })
  }

  const platformFilterLabel = selectedPlatforms.length === 0
    ? 'كل المنصات'
    : selectedPlatforms.length === 1
      ? platformName(selectedPlatforms[0])
      : `${number(selectedPlatforms.length)} منصات`

  const trend = useMemo(() => {
    const days = new Map<string,{ date:string; sales:number; previousSales:number; orders:Set<string> }>()
    const cursor = new Date(bounds[0]); cursor.setHours(12,0,0,0)
    const end = new Date(bounds[1]); end.setHours(12,0,0,0)
    while (cursor <= end) {
      const key = riyadhDateKey(cursor)
      days.set(key, { date:key, sales:0, previousSales:0, orders:new Set() })
      cursor.setDate(cursor.getDate() + 1)
    }
    selected.forEach(o => {
      const key = riyadhDateKey(o.order_date)
      if (!days.has(key)) days.set(key, { date:key, sales:0, previousSales:0, orders:new Set() })
      const day = days.get(key)!; day.sales += Number(o.total_amount || 0); day.orders.add(`${o.platform}:${o.order_id}`)
    })
    const orderedDays = [...days.values()].sort((a,b) => a.date.localeCompare(b.date))
    const previousByOffset = new Map<number,number>()
    previousSelected.forEach(order => {
      const offset = Math.floor((new Date(order.order_date).getTime() - previousBounds[0].getTime()) / 86400000)
      previousByOffset.set(offset, (previousByOffset.get(offset) || 0) + Number(order.total_amount || 0))
    })
    return orderedDays.map((d,index) => ({ ...d, previousSales:previousByOffset.get(index) || 0, label:new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'short'}).format(new Date(d.date)), orderCount:d.orders.size }))
  }, [selected, previousSelected, previousBounds, bounds])

  const channels = useMemo(() => {
    const values = new Map<string,{ sales:number; orders:Set<string> }>()
    const previous = new Map<string,number>()
    selected.forEach(o => { const v = values.get(o.platform) || {sales:0,orders:new Set<string>()}; v.sales += Number(o.total_amount || 0); v.orders.add(o.order_id); values.set(o.platform,v) })
    previousSelected.forEach(o => previous.set(o.platform, (previous.get(o.platform) || 0) + Number(o.total_amount || 0)))
    return [...values].map(([platform,v]) => ({ platform, name:platformName(platform), value:v.sales, orders:v.orders.size, delta:periodDelta(v.sales, previous.get(platform) || 0) })).sort((a,b)=>b.value-a.value)
  }, [selected, previousSelected])

  const resolveCatalogProduct = useMemo(() => createCatalogResolver(catalogProducts, catalogMappings), [catalogProducts, catalogMappings])

  const topProducts = useMemo(() => {
    const values = new Map<string,{ name:string; sales:number; qty:number }>()
    const selectedOrders = new Map(selected.map(order => [`${order.platform}:${order.order_id}`, order]))
    const ordersWithItems = new Set<string>()
    const add = (platform:string, orderId:string, identifiers:Array<string|null|undefined>, sourceName:string|null, qty:number, sales:number) => {
      const product = resolveCatalogProduct({ platform, identifiers, sourceName })
      const fallback = sourceName || identifiers.find(Boolean) || 'منتج غير معروف'
      const key = product?.id || `${platform}:${String(fallback)}`
      const value = values.get(key) || { name:product?.name || String(fallback), sales:0, qty:0 }
      value.sales += Number(sales || 0); value.qty += Number(qty || 1); values.set(key, value)
      ordersWithItems.add(`${platform}:${orderId}`)
    }
    orderItems.forEach(item => {
      if (!selectedOrders.has(`${item.platform}:${item.order_id}`)) return
      add(item.platform, item.order_id, [item.barcode,item.sku], item.product_name, item.quantity, item.line_total)
    })
    selected.forEach(order => {
      if (ordersWithItems.has(`${order.platform}:${order.order_id}`)) return
      add(order.platform, order.order_id, [order.sku], order.product_name, order.quantity, order.total_amount)
    })
    return [...values.values()].sort((a,b)=>b.sales-a.sales).slice(0,5)
  }, [selected, orderItems, resolveCatalogProduct])

  const topReturns = useMemo(() => {
    const values = new Map<string,{ name:string; qty:number; amount:number }>()
    selectedReturns.forEach(r => { const product=resolveCatalogProduct({platform:r.platform,identifiers:[r.sku],sourceName:r.product_name}); const key=product?.id||r.sku||r.product_name||'—'; const v=values.get(key)||{name:product?.name||r.product_name||key,qty:0,amount:0}; v.qty+=Number(r.quantity||1); v.amount+=Number(r.return_amount||0); values.set(key,v) })
    return [...values.values()].sort((a,b)=>b.qty-a.qty).slice(0,5)
  }, [selectedReturns, resolveCatalogProduct])

  const connected = credentials.filter(c => c.is_active && (!activePlatformSet || activePlatformSet.has(c.platform)))
  const syncDates = connected.map(c => c.last_sync_at).filter((value): value is string => Boolean(value)).sort()
  const oldestSync = syncDates[0]
  const staleConnections = connected.filter(c => !c.last_sync_at || Date.now() - new Date(c.last_sync_at).getTime() > 24 * 60 * 60 * 1000).length
  const navigationQuery = useMemo(() => ({
    period:preset,
    ...(preset === 'custom' ? { from, to } : {}),
    ...(selectedPlatforms.length === 1 ? { platform:selectedPlatforms[0] } : {}),
  }), [preset, from, to, selectedPlatforms])
  const navigate = (view:PhaseOneView, extra:Record<string,string>={}) => onNavigate(view, { ...navigationQuery, ...extra })

  return <main className="merchant-dashboard" dir="rtl">
    <header className="dashboard-header">
      <div><span className="eyebrow">ملخص صحة المتجر</span><h1>مرحبًا {merchant?.name || 'بك'}</h1><p>راقب مبيعاتك وطلباتك ومخزونك عبر جميع قنوات البيع من مكان واحد.</p></div>
      <div className="dashboard-controls">
        <div className="date-control"><CalendarDays size={17}/><select value={preset} onChange={e=>setPreset(e.target.value as DatePreset)} aria-label="الفترة الزمنية"><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يومًا</option><option value="90">آخر 90 يومًا</option><option value="month">هذا الشهر</option><option value="custom">فترة مخصصة</option></select></div>
        <details className="platform-control">
          <summary aria-label={`منصات البيع: ${platformFilterLabel}`}><Layers3 size={17}/><span>{platformFilterLabel}</span><ChevronDown size={15}/></summary>
          <div className="platform-menu" role="group" aria-label="تصفية جميع بيانات اللوحة حسب المنصة">
            <label className="platform-option all"><input type="checkbox" checked={selectedPlatforms.length === 0} onChange={()=>setSelectedPlatforms([])}/><span>كل المنصات</span><small>بيانات مجمعة</small></label>
            {availablePlatforms.map(platform => <label className="platform-option" key={platform}><input type="checkbox" checked={!activePlatformSet || activePlatformSet.has(platform)} onChange={()=>togglePlatform(platform)}/><span>{platformName(platform)}</span></label>)}
          </div>
        </details>
      </div>
    </header>
    {preset === 'custom' && <div className="custom-range"><label>من <input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label>إلى <input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label></div>}
    {partial && !loading && <div className="quiet-notice">تعذر تحديث بعض البيانات الآن، وتم عرض أحدث بيانات متاحة.</div>}

    <section className="kpi-grid">
      <Kpi icon={<WalletCards/>} label="إجمالي المبيعات" value={loading?'—':money(revenue)} hint="خلال الفترة المحددة" delta={revenueDelta} tone="teal" onClick={()=>navigate('orders')}/>
      <Kpi icon={<ShoppingCart/>} label="إجمالي الطلبات" value={loading?'—':number(uniqueOrders.length)} hint="خلال الفترة المحددة" onClick={()=>navigate('orders')}/>
      <Kpi icon={<Clock3/>} label="قيد المعالجة الآن" value={loading?'—':number(pending)} hint={pending?'جميع الطلبات المفتوحة حاليًا':'لا توجد طلبات معلقة'} tone={pending?'amber':'green'} onClick={()=>navigate('orders',{preset:'needsAction',period:'all'})}/>
      <Kpi icon={<Boxes/>} label="منتجات نافدة الآن" value={loading?'—':number(outStock)} hint={selectedStock.length?`${number(outStock)} من ${number(selectedStock.length)} · ${outStockRate.toFixed(1)}%`:'لا توجد بيانات مخزون'} tone={outStock?'red':'green'} onClick={()=>navigate('inventory',{stock:'out'})}/>
    </section>

    <section className="analytics-grid">
      <article className="panel sales-panel"><PanelHead title="المبيعات عبر الزمن" subtitle={`${number(uniqueOrders.length)} طلبًا بقيمة ${money(revenue)} · مقارنة بالفترة السابقة`}/><div className="chart-wrap" aria-label={`اتجاه المبيعات: ${money(revenue)} في الفترة الحالية مقابل ${money(previousRevenue)} في الفترة السابقة`}>
        {trend.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{top:15,right:0,left:0,bottom:0}}><defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f958c" stopOpacity={.3}/><stop offset="100%" stopColor="#0f958c" stopOpacity={.02}/></linearGradient></defs><CartesianGrid stroke="#e7edf1" strokeDasharray="3 4" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill:'#748390',fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:'#748390',fontSize:11}} width={52}/><Tooltip formatter={(v,name)=>[money(Number(v)),name]}/><Line type="monotone" dataKey="previousSales" name="الفترة السابقة" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 5" dot={false}/><Area type="monotone" dataKey="sales" name="الفترة الحالية" stroke="#0f958c" strokeWidth={2.5} fill="url(#salesFill)"/></AreaChart></ResponsiveContainer>:<Empty text="لا توجد مبيعات في هذه الفترة"/>}
      </div><details className="chart-data"><summary>عرض بيانات الرسم كجدول</summary><div><table><thead><tr><th>التاريخ</th><th>الفترة الحالية</th><th>الفترة السابقة المقابلة</th></tr></thead><tbody>{trend.map(day=><tr key={day.date}><td>{day.label}</td><td>{money(day.sales)}</td><td>{money(day.previousSales)}</td></tr>)}</tbody></table></div></details></article>
      <article className="panel channel-panel"><PanelHead title="أداء قنوات البيع" subtitle="نسبة المبيعات لكل منصة"/><div className="channel-content">
        <div className={`donut ${channels.length === 1 ? 'single-channel' : ''}`}>{channels.length>1?<ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={channels} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3}>{channels.map(c=><Cell key={c.platform} fill={platformColor(c.platform)}/>)}</Pie><Tooltip formatter={(v)=>money(Number(v))}/></PieChart></ResponsiveContainer>:channels.length===1?<div className="single-channel-summary"><span className="channel-dot" style={{background:platformColor(channels[0].platform)}}/><strong>{channels[0].name}</strong><b>{money(channels[0].value)}</b><small>{number(channels[0].orders)} طلب</small></div>:<Empty text="لا توجد بيانات"/>}{channels.length>1&&<div className="donut-total"><strong>{money(revenue)}</strong><span>الإجمالي</span></div>}</div>
        <div className="channel-list">{channels.slice(0,5).map(c=><button type="button" onClick={()=>navigate('orders',{platform:c.platform})} key={c.platform}><span className="channel-dot" style={{background:platformColor(c.platform)}}/><span>{c.name}</span><b>{money(c.value)}</b><small>{number(c.orders)} طلب <DeltaIcon value={c.delta}/></small></button>)}</div>
      </div></article>
    </section>

    <section className="health-grid single">
      <article className="panel sync"><PanelHead title="حالة المزامنة الآن" subtitle={`${number(connected.length)} قنوات متصلة`}/><div className="sync-state">{connected.length > 0 && staleConnections === 0?<CheckCircle2/>:<AlertTriangle/>}<div><strong>{connected.length === 0?'لم يتم ربط قناة بعد':staleConnections?`${number(staleConnections)} قناة تحتاج تحديثًا`:'جميع القنوات محدثة'}</strong><span>{oldestSync?`أقدم مزامنة ${relativeTime(oldestSync)}`:'اربط أول قناة لاستقبال البيانات تلقائيًا'}</span></div></div><button onClick={()=>navigate('integrations')}><RefreshCw size={15}/> إدارة الربط والمزامنة</button></article>
    </section>

    <section className="products-grid">
      <article className="panel"><PanelHead title="أفضل 5 منتجات مبيعًا" subtitle="أسماء موحدة من دليل المنتجات"/><RankList onClick={()=>navigate('product-catalog')} items={topProducts.map(x=>({name:x.name,value:money(x.sales),detail:`${number(x.qty)} قطعة`}))} empty="لا توجد مبيعات منتجات"/></article>
      <article className="panel"><PanelHead title="أعلى المنتجات إرجاعًا" subtitle="أسماء موحدة من دليل المنتجات"/><RankList onClick={()=>navigate('product-catalog')} danger items={topReturns.map(x=>({name:x.name,value:`${number(x.qty)} مرتجع`,detail:money(x.amount)}))} empty="لا توجد مرتجعات في هذه الفترة"/></article>
    </section>
  </main>
}

function Kpi({icon,label,value,hint,tone='',delta,onClick}:{icon:React.ReactNode;label:string;value:string;hint:string;tone?:string;delta?:number|null;onClick?:()=>void}) { return <button type="button" className={`kpi ${tone} ${onClick?'clickable':''}`} onClick={onClick}>{<span className="kpi-icon">{icon}</span>}<div><span>{label}</span><strong>{value}</strong><small>{hint}{delta !== undefined && <span className={`delta ${delta === null ? 'new' : delta >= 0 ? 'up' : 'down'}`}>{delta === null ? 'جديد' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}%`}</span>}</small></div></button> }
function DeltaIcon({value}:{value:number|null}) { if(value === null) return <span className="channel-delta new">جديد</span>; if(value === 0) return <span className="channel-delta"><Minus size={13}/> 0%</span>; return <span className={`channel-delta ${value > 0 ? 'up' : 'down'}`}>{value > 0?<TrendingUp size={13}/>:<TrendingDown size={13}/>} {Math.abs(value).toFixed(1)}%</span> }
function PanelHead({title,subtitle,action}:{title:string;subtitle:string;action?:React.ReactNode}) { return <header className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</header> }
function Empty({text}:{text:string}) { return <div className="empty"><Package size={22}/><span>{text}</span></div> }
function RankList({items,empty,danger=false,onClick}:{items:{name:string;value:string;detail:string}[];empty:string;danger?:boolean;onClick?:()=>void}) { return items.length?<div className={`rank-list ${danger?'danger':''}`}>{items.map((x,i)=><button type="button" onClick={onClick} key={`${x.name}-${i}`}><b>{i+1}</b><span><strong>{x.name}</strong><small>{x.detail}</small></span><em>{x.value}</em></button>)}</div>:<Empty text={empty}/> }
