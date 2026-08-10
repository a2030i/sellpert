import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Boxes, CalendarDays, CheckCircle2, Clock3, Package, RefreshCw, ShoppingCart, TrendingDown, TrendingUp, WalletCards } from 'lucide-react'
import { fetchAll } from '../lib/db'
import { listPlatformCredentials } from '../lib/platformCredentialManager'
import { PLATFORM_COLORS, PLATFORM_MAP } from '../lib/constants'
import { supabase, type Merchant, type PlatformCredential } from '../lib/supabase'
import './DashboardV2.css'

type PhaseOneView = 'orders' | 'products' | 'inventory' | 'integrations'
type DatePreset = '7' | '30' | '90' | 'month' | 'custom'
type OrderRow = { order_id:string; platform:string; status:string; product_name:string|null; sku:string|null; quantity:number; total_amount:number; currency:string; order_date:string }
type StockRow = { sku:string; product_name:string|null; platform:string; quantity:number; reserved_quantity:number|null }
type ReturnRow = { sku:string|null; product_name:string|null; platform:string; quantity:number|null; return_amount:number|null; return_date:string }

const STATUS_PENDING = new Set(['pending', 'processing', 'new', 'confirmed', 'ready_to_ship'])

function money(value:number) { return new Intl.NumberFormat('ar-SA-u-nu-latn', { style:'currency', currency:'SAR', maximumFractionDigits:0 }).format(value || 0) }
function number(value:number) { return new Intl.NumberFormat('ar-SA-u-nu-latn').format(value || 0) }
function isoDate(date:Date) { return date.toISOString().slice(0, 10) }
function platformName(key:string) { return PLATFORM_MAP[key] || key }
function platformColor(key:string) { return PLATFORM_COLORS[key] || '#64748b' }
function relativeTime(value?:string|null) {
  if (!value) return 'لم تتم المزامنة بعد'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `قبل ${number(minutes)} دقيقة`
  if (minutes < 1440) return `قبل ${number(Math.floor(minutes / 60))} ساعة`
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day:'numeric', month:'short', year:'numeric' }).format(new Date(value))
}

export default function DashboardV2({ merchant, onNavigate }: { merchant:Merchant|null; onNavigate:(view:PhaseOneView)=>void }) {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [credentials, setCredentials] = useState<PlatformCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [partial, setPartial] = useState(false)
  const [preset, setPreset] = useState<DatePreset>('30')
  const now = new Date()
  const [from, setFrom] = useState(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(isoDate(now))

  useEffect(() => {
    const code = merchant?.merchant_code
    if (!code) return
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      fetchAll<OrderRow>((f,t) => supabase.from('orders').select('order_id,platform,status,product_name,sku,quantity,total_amount,currency,order_date').eq('merchant_code', code).order('order_date', { ascending:false }).range(f,t), 'طلبات لوحة التحكم'),
      fetchAll<StockRow>((f,t) => supabase.from('inventory').select('sku,product_name,platform,quantity,reserved_quantity').eq('merchant_code', code).eq('is_active', true).range(f,t), 'مخزون لوحة التحكم'),
      fetchAll<ReturnRow>((f,t) => supabase.from('returns').select('sku,product_name,platform,quantity,return_amount,return_date').eq('merchant_code', code).order('return_date', { ascending:false }).range(f,t), 'مرتجعات لوحة التحكم'),
      listPlatformCredentials(code),
    ]).then(results => {
      if (cancelled) return
      const [o,s,r,c] = results
      setOrders(o.status === 'fulfilled' ? o.value : [])
      setStock(s.status === 'fulfilled' ? s.value : [])
      setReturns(r.status === 'fulfilled' ? r.value : [])
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

  const selected = useMemo(() => orders.filter(o => { const d = new Date(o.order_date); return d >= bounds[0] && d <= bounds[1] }), [orders,bounds])
  const selectedReturns = useMemo(() => returns.filter(r => { const d = new Date(r.return_date); return d >= bounds[0] && d <= bounds[1] }), [returns,bounds])
  const uniqueOrders = useMemo(() => Array.from(new Map(selected.map(o => [o.order_id, o])).values()), [selected])
  const revenue = selected.reduce((sum,o) => sum + Number(o.total_amount || 0), 0)
  const pending = new Set(selected.filter(o => STATUS_PENDING.has(String(o.status).toLowerCase())).map(o => o.order_id)).size
  const outStock = stock.filter(s => Number(s.quantity || 0) - Number(s.reserved_quantity || 0) <= 0).length

  const trend = useMemo(() => {
    const days = new Map<string,{ date:string; sales:number; orders:Set<string> }>()
    selected.forEach(o => {
      const key = o.order_date.slice(0,10)
      if (!days.has(key)) days.set(key, { date:key, sales:0, orders:new Set() })
      const day = days.get(key)!; day.sales += Number(o.total_amount || 0); day.orders.add(o.order_id)
    })
    return [...days.values()].sort((a,b) => a.date.localeCompare(b.date)).map(d => ({ ...d, label:new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'short'}).format(new Date(d.date)), orderCount:d.orders.size }))
  }, [selected])

  const channels = useMemo(() => {
    const values = new Map<string,{ sales:number; orders:Set<string> }>()
    selected.forEach(o => { const v = values.get(o.platform) || {sales:0,orders:new Set<string>()}; v.sales += Number(o.total_amount || 0); v.orders.add(o.order_id); values.set(o.platform,v) })
    return [...values].map(([platform,v]) => ({ platform, name:platformName(platform), value:v.sales, orders:v.orders.size })).sort((a,b)=>b.value-a.value)
  }, [selected])

  const topProducts = useMemo(() => {
    const values = new Map<string,{ name:string; sales:number; qty:number }>()
    selected.forEach(o => { const key=o.sku || o.product_name || '—'; const v=values.get(key)||{name:o.product_name||key,sales:0,qty:0}; v.sales+=Number(o.total_amount||0); v.qty+=Number(o.quantity||1); values.set(key,v) })
    return [...values.values()].sort((a,b)=>b.sales-a.sales).slice(0,5)
  }, [selected])

  const topReturns = useMemo(() => {
    const values = new Map<string,{ name:string; qty:number; amount:number }>()
    selectedReturns.forEach(r => { const key=r.sku||r.product_name||'—'; const v=values.get(key)||{name:r.product_name||key,qty:0,amount:0}; v.qty+=Number(r.quantity||1); v.amount+=Number(r.return_amount||0); values.set(key,v) })
    return [...values.values()].sort((a,b)=>b.qty-a.qty).slice(0,5)
  }, [selectedReturns])

  const connected = credentials.filter(c => c.is_active)
  const syncDates = connected.map(c => c.last_sync_at).filter((value): value is string => Boolean(value)).sort()
  const lastSync = syncDates[syncDates.length - 1]

  return <main className="merchant-dashboard" dir="rtl">
    <header className="dashboard-header">
      <div><span className="eyebrow">ملخص صحة المتجر</span><h1>مرحبًا {merchant?.name || 'بك'}</h1><p>راقب مبيعاتك وطلباتك ومخزونك عبر جميع قنوات البيع من مكان واحد.</p></div>
      <div className="date-control"><CalendarDays size={17}/><select value={preset} onChange={e=>setPreset(e.target.value as DatePreset)} aria-label="الفترة الزمنية"><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يومًا</option><option value="90">آخر 90 يومًا</option><option value="month">هذا الشهر</option><option value="custom">فترة مخصصة</option></select></div>
    </header>
    {preset === 'custom' && <div className="custom-range"><label>من <input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label>إلى <input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label></div>}
    {partial && !loading && <div className="quiet-notice">تعذر تحديث بعض البيانات الآن، وتم عرض أحدث بيانات متاحة.</div>}

    <section className="kpi-grid">
      <Kpi icon={<WalletCards/>} label="إجمالي المبيعات" value={loading?'—':money(revenue)} hint="خلال الفترة المحددة" tone="teal" onClick={()=>onNavigate('orders')}/>
      <Kpi icon={<ShoppingCart/>} label="إجمالي الطلبات" value={loading?'—':number(uniqueOrders.length)} hint="من جميع القنوات" onClick={()=>onNavigate('orders')}/>
      <Kpi icon={<Clock3/>} label="قيد المعالجة" value={loading?'—':number(pending)} hint={pending?'تحتاج إلى متابعة':'لا توجد طلبات معلقة'} tone={pending?'amber':'green'} onClick={()=>onNavigate('orders')}/>
      <Kpi icon={<Boxes/>} label="منتجات نافدة" value={loading?'—':number(outStock)} hint={outStock?'تحتاج إلى إعادة التزويد':'لا توجد منتجات نافدة'} tone={outStock?'red':'green'} onClick={()=>onNavigate('inventory')}/>
    </section>

    <section className="analytics-grid">
      <article className="panel sales-panel"><PanelHead title="المبيعات عبر الزمن" subtitle={`${number(uniqueOrders.length)} طلبًا بقيمة ${money(revenue)}`}/><div className="chart-wrap">
        {trend.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{top:15,right:0,left:0,bottom:0}}><defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f958c" stopOpacity={.3}/><stop offset="100%" stopColor="#0f958c" stopOpacity={.02}/></linearGradient></defs><CartesianGrid stroke="#e7edf1" strokeDasharray="3 4" vertical={false}/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill:'#748390',fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:'#748390',fontSize:11}} width={52}/><Tooltip formatter={(v)=>money(Number(v))}/><Area type="monotone" dataKey="sales" name="المبيعات" stroke="#0f958c" strokeWidth={2.5} fill="url(#salesFill)"/></AreaChart></ResponsiveContainer>:<Empty text="لا توجد مبيعات في هذه الفترة"/>}
      </div></article>
      <article className="panel channel-panel"><PanelHead title="أداء قنوات البيع" subtitle="نسبة المبيعات لكل منصة"/><div className="channel-content">
        <div className="donut">{channels.length?<ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={channels} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3}>{channels.map(c=><Cell key={c.platform} fill={platformColor(c.platform)}/>)}</Pie><Tooltip formatter={(v)=>money(Number(v))}/></PieChart></ResponsiveContainer>:<Empty text="لا توجد بيانات"/>}<div className="donut-total"><strong>{money(revenue)}</strong><span>الإجمالي</span></div></div>
        <div className="channel-list">{channels.slice(0,5).map((c,i)=><button type="button" onClick={()=>onNavigate('orders')} key={c.platform}><span className="channel-dot" style={{background:platformColor(c.platform)}}/><span>{c.name}</span><b>{money(c.value)}</b><small>{number(c.orders)} طلب {i===0&&channels.length>1?<TrendingUp size={13}/>:<TrendingDown size={13}/>}</small></button>)}</div>
      </div></article>
    </section>

    <section className="health-grid single">
      <article className="panel sync"><PanelHead title="حالة المزامنة" subtitle={`${number(connected.length)} قنوات متصلة`}/><div className="sync-state">{lastSync?<CheckCircle2/>:<AlertTriangle/>}<div><strong>{lastSync?'المزامنة تعمل بنجاح':'لم يتم ربط قناة بعد'}</strong><span>{lastSync?`آخر تحديث ${relativeTime(lastSync)}`:'اربط أول قناة لاستقبال البيانات تلقائيًا'}</span></div></div><button onClick={()=>onNavigate('integrations')}><RefreshCw size={15}/> إدارة الربط والمزامنة</button></article>
    </section>

    <section className="products-grid">
      <article className="panel"><PanelHead title="أفضل 5 منتجات مبيعًا" subtitle="الأعلى إيرادًا خلال الفترة"/><RankList onClick={()=>onNavigate('products')} items={topProducts.map(x=>({name:x.name,value:money(x.sales),detail:`${number(x.qty)} قطعة`}))} empty="لا توجد مبيعات منتجات"/></article>
      <article className="panel"><PanelHead title="أعلى المنتجات إرجاعًا" subtitle="راقب الجودة وتكرار المرتجعات"/><RankList onClick={()=>onNavigate('products')} danger items={topReturns.map(x=>({name:x.name,value:`${number(x.qty)} مرتجع`,detail:money(x.amount)}))} empty="لا توجد مرتجعات في هذه الفترة"/></article>
    </section>
  </main>
}

function Kpi({icon,label,value,hint,tone='',onClick}:{icon:React.ReactNode;label:string;value:string;hint:string;tone?:string;onClick?:()=>void}) { return <button type="button" className={`kpi ${tone} ${onClick?'clickable':''}`} onClick={onClick}>{<span className="kpi-icon">{icon}</span>}<div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></button> }
function PanelHead({title,subtitle}:{title:string;subtitle:string}) { return <header className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div></header> }
function Empty({text}:{text:string}) { return <div className="empty"><Package size={22}/><span>{text}</span></div> }
function RankList({items,empty,danger=false,onClick}:{items:{name:string;value:string;detail:string}[];empty:string;danger?:boolean;onClick?:()=>void}) { return items.length?<div className={`rank-list ${danger?'danger':''}`}>{items.map((x,i)=><button type="button" onClick={onClick} key={`${x.name}-${i}`}><b>{i+1}</b><span><strong>{x.name}</strong><small>{x.detail}</small></span><em>{x.value}</em></button>)}</div>:<Empty text={empty}/> }
