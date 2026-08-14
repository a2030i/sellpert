import { useEffect, useMemo, useState } from 'react'
import { fmt, relativeTime, PLATFORM_MAP } from './adminShared'
import type { Merchant, PerformanceData, SyncLog } from '../../lib/supabase'
import { supabase } from '../../lib/supabase'
import { localDateKey, performanceDateKey } from '../../lib/adminPerformance'
import {
  BadgePercent, CalendarDays, ChevronDown,
  FileUp, Layers3, PackageCheck, ShoppingCart, TrendingUp, Trophy,
  UserPlus, Users, Wallet,
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

type Preset = '7' | '30' | 'month' | 'custom'
type MetricPayload = {
  range:{start:string;end:string;previous_start:string;previous_end:string}
  totals:{gmv:number;orders:number;fees:number;active_merchants:number;rows:number;first_date:string|null;last_date:string|null;updated_at:string|null}
  previous:{gmv:number;orders:number;active_merchants:number}
  trend:Array<{date:string;gmv:number;orders:number}>
  platforms:Array<{platform:string;gmv:number;orders:number}>
  merchants:Array<{merchant_code:string;name:string;gmv:number;orders:number}>
}

function pct(current:number, previous:number) { return previous ? (current - previous) / previous * 100 : current ? null : 0 }
function dateBounds(preset:Preset, from:string, to:string) {
  const end = new Date(); let start = new Date(end)
  if (preset === 'custom') return [from,to] as const
  if (preset === 'month') start = new Date(end.getFullYear(), end.getMonth(), 1)
  else start.setDate(end.getDate() - Number(preset) + 1)
  return [localDateKey(start),localDateKey(end)] as const
}
function buildFallback(rows:PerformanceData[], start:string, end:string, platforms:string[], merchantCode:string):MetricPayload {
  const days = Math.max(1, Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1)
  const previousEndDate = new Date(`${start}T00:00:00`); previousEndDate.setDate(previousEndDate.getDate() - 1)
  const previousStartDate = new Date(previousEndDate); previousStartDate.setDate(previousStartDate.getDate() - days + 1)
  const previousStart = localDateKey(previousStartDate); const previousEnd = localDateKey(previousEndDate)
  const inScope = (row:PerformanceData) => (!platforms.length || platforms.includes(row.platform)) && (!merchantCode || row.merchant_code === merchantCode)
  const current = rows.filter(row => inScope(row) && performanceDateKey(row) >= start && performanceDateKey(row) <= end)
  const previous = rows.filter(row => inScope(row) && performanceDateKey(row) >= previousStart && performanceDateKey(row) <= previousEnd)
  const total = (source:PerformanceData[]) => ({ gmv:source.reduce((sum,row)=>sum+Number(row.total_sales||0),0), orders:source.reduce((sum,row)=>sum+Number(row.order_count||0),0), active_merchants:new Set(source.map(row=>row.merchant_code)).size })
  const totals = total(current); const previousTotals = total(previous)
  const trendMap = new Map<string,{gmv:number;orders:number}>(); const cursor = new Date(`${start}T12:00:00`); const last = new Date(`${end}T12:00:00`)
  while(cursor<=last){trendMap.set(localDateKey(cursor),{gmv:0,orders:0});cursor.setDate(cursor.getDate()+1)}
  const platformMap = new Map<string,{gmv:number;orders:number}>(); const merchantMap = new Map<string,{gmv:number;orders:number}>()
  current.forEach(row=>{const day=trendMap.get(performanceDateKey(row));if(day){day.gmv+=Number(row.total_sales||0);day.orders+=Number(row.order_count||0)};const platform=platformMap.get(row.platform)||{gmv:0,orders:0};platform.gmv+=Number(row.total_sales||0);platform.orders+=Number(row.order_count||0);platformMap.set(row.platform,platform);const merchant=merchantMap.get(row.merchant_code)||{gmv:0,orders:0};merchant.gmv+=Number(row.total_sales||0);merchant.orders+=Number(row.order_count||0);merchantMap.set(row.merchant_code,merchant)})
  return {range:{start,end,previous_start:previousStart,previous_end:previousEnd},totals:{...totals,fees:current.reduce((sum,row)=>sum+Number(row.platform_fees||0),0),rows:current.length,first_date:current.length?current.map(performanceDateKey).sort()[0]:null,last_date:current.length?current.map(performanceDateKey).sort().slice(-1)[0]||null:null,updated_at:current.length?current.map(row=>row.created_at).sort().slice(-1)[0]||null:null},previous:previousTotals,trend:[...trendMap].map(([date,value])=>({date,...value})),platforms:[...platformMap].map(([platform,value])=>({platform,...value})).sort((a,b)=>b.gmv-a.gmv),merchants:[...merchantMap].map(([merchant_code,value])=>({merchant_code,name:merchant_code,...value})).sort((a,b)=>b.gmv-a.gmv).slice(0,10)}
}

export default function OverviewView({ merchantOnly, activeIntegrations, totalIntegrations, openTaskCount, syncLogs, perfData, onNavigate }: {merchantOnly:Merchant[];activeIntegrations:number;totalIntegrations:number;openTaskCount:number;syncLogs:SyncLog[];perfData:PerformanceData[];onNavigate:(target:string)=>void}) {
  const params = useMemo(()=>new URLSearchParams(window.location.search),[])
  const [preset,setPreset]=useState<Preset>(()=>['7','30','month','custom'].includes(params.get('period')||'')?params.get('period') as Preset:'30')
  const [platforms,setPlatforms]=useState<string[]>(()=>(params.get('platforms')||'').split(',').filter(Boolean))
  const [merchantCode,setMerchantCode]=useState(params.get('merchant')||'')
  const today=new Date(); const [from,setFrom]=useState(params.get('from')||localDateKey(new Date(today.getFullYear(),today.getMonth(),1))); const [to,setTo]=useState(params.get('to')||localDateKey(today))
  const [start,end]=dateBounds(preset,from,to)
  const [remote,setRemote]=useState<MetricPayload|null>(null); const [metricsError,setMetricsError]=useState(''); const [metricsLoading,setMetricsLoading]=useState(false)
  const availablePlatforms=useMemo(()=>[...new Set(['amazon','noon','trendyol',...perfData.map(row=>row.platform)])].filter(platform=>platform!=='other').sort(),[perfData])
  const fallback=useMemo(()=>buildFallback(perfData,start,end,platforms,merchantCode),[perfData,start,end,platforms,merchantCode])
  const metrics=remote||fallback

  useEffect(()=>{const next=new URLSearchParams(window.location.search);next.set('period',preset);if(platforms.length)next.set('platforms',platforms.join(','));else next.delete('platforms');if(merchantCode)next.set('merchant',merchantCode);else next.delete('merchant');if(preset==='custom'){next.set('from',from);next.set('to',to)}else{next.delete('from');next.delete('to')}window.history.replaceState(null,'',`${window.location.pathname}?${next.toString()}`)},[preset,platforms,merchantCode,from,to])
  useEffect(()=>{let cancelled=false;setMetricsLoading(true);setMetricsError('');supabase.rpc('admin_overview_metrics',{p_start_date:start,p_end_date:end,p_platforms:platforms.length?platforms:null,p_merchant_code:merchantCode||null}).then(({data,error})=>{if(cancelled)return;if(error){setRemote(null);setMetricsError('تعذر تشغيل التجميع السريع؛ تم عرض البيانات المحلية المتاحة.')}else setRemote(data as MetricPayload);setMetricsLoading(false)});return()=>{cancelled=true}},[start,end,platforms,merchantCode])

  const currentGMV=Number(metrics.totals.gmv||0), currentOrders=Number(metrics.totals.orders||0), active=Number(metrics.totals.active_merchants||0)
  const gmvDelta=pct(currentGMV,Number(metrics.previous.gmv||0)), orderDelta=pct(currentOrders,Number(metrics.previous.orders||0))
  const failedImports=syncLogs.filter(log=>log.status==='error'||log.status==='stalled').length, inactiveIntegrations=Math.max(0,totalIntegrations-activeIntegrations)
  const oldestDate=metrics.totals.first_date, latestDate=metrics.totals.last_date
  const scopeLabel=`${new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'short'}).format(new Date(`${start}T00:00:00`))} – ${new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${end}T00:00:00`))}`
  function togglePlatform(platform:string){setPlatforms(current=>current.includes(platform)?current.filter(value=>value!==platform):[...current,platform].sort())}

  return <div className="admin-ops-overview" dir="rtl">
    <header className="admin-ops-intro"><div><h1>مركز تشغيل Sellpert</h1><p>ابدأ بالاستثناءات التي تعطل التجار، ثم راقب أداء المنصة.</p></div><span>{metricsLoading?'جارٍ التحديث…':`${scopeLabel}${metrics.totals.updated_at?` · آخر تجميع ${relativeTime(metrics.totals.updated_at)}`:''}`}</span></header>

    <section className="admin-ops-filters" aria-label="فلاتر جميع بيانات نظرة عامة">
      <label><span>الفترة الزمنية</span><b><CalendarDays size={15}/><select aria-label="الفترة الزمنية لجميع بيانات نظرة عامة" value={preset} onChange={event=>setPreset(event.target.value as Preset)}><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يومًا</option><option value="month">هذا الشهر</option><option value="custom">فترة مخصصة</option></select></b></label>
      <details><summary><span>المنصات</span><b><Layers3 size={15}/>{platforms.length?`${platforms.length.toLocaleString('en-US')} منصات`:'كل المنصات'}<ChevronDown size={14}/></b></summary><div className="admin-platform-menu"><label><input type="checkbox" checked={!platforms.length} onChange={()=>setPlatforms([])}/>كل المنصات</label>{availablePlatforms.map(platform=><label key={platform}><input type="checkbox" checked={platforms.includes(platform)} onChange={()=>togglePlatform(platform)}/>{PLATFORM_MAP[platform]||platform}</label>)}</div></details>
      <label><span>التاجر</span><b><Users size={15}/><select aria-label="التاجر لجميع بيانات نظرة عامة" value={merchantCode} onChange={event=>setMerchantCode(event.target.value)}><option value="">كل التجار</option>{merchantOnly.map(merchant=><option key={merchant.id} value={merchant.merchant_code}>{merchant.name}</option>)}</select></b></label>
      {preset==='custom'&&<div className="admin-custom-range"><label>من<input type="date" value={from} max={to} onChange={event=>setFrom(event.target.value)}/></label><label>إلى<input type="date" value={to} min={from} onChange={event=>setTo(event.target.value)}/></label></div>}
    </section>
    {metricsError&&<div role="status" className="admin-ops-notice">{metricsError}</div>}

    <section className="admin-command-grid">
      <article className="admin-decisions"><header><h2>استثناءات تحتاج تدخّل الفريق</h2><p>مرتبة بحسب أثرها على بيانات التاجر وتشغيله</p></header>
        <Decision tone="critical" title="ملفات فشل استيرادها" detail={`${failedImports.toLocaleString('en-US')} ملفات تحتاج مراجعة الخطأ وإعادة المعالجة`} value={failedImports} onClick={()=>onNavigate('uploads')}/>
        <Decision tone="warning" title="مزامنات متأخرة" detail={`${inactiveIntegrations.toLocaleString('en-US')} اتصالات لم تتحدث ضمن الزمن المتوقع`} value={inactiveIntegrations} onClick={()=>onNavigate('operations')}/>
        <Decision tone="info" title="مهام تشغيل مفتوحة" detail="تحتاج متابعة الفريق وإغلاق الإجراء" value={openTaskCount} onClick={()=>onNavigate('tasks')}/>
      </article>
      <article className="admin-quick-actions"><header><h2>إجراءات سريعة</h2></header>
        <Quick icon={<FileUp/>} title="رفع ملفات لتاجر" detail="Amazon أو Noon" onClick={()=>onNavigate('import')}/>
        <Quick icon={<UserPlus/>} title="إنشاء حساب تاجر" detail="تجهيز مساحة عمل جديدة" onClick={()=>onNavigate('merchants')}/>
        <Quick icon={<BadgePercent/>} title="تعديل عمولة Sellpert" detail="حسب عقد التاجر" onClick={()=>onNavigate('fees')}/>
      </article>
    </section>

    <section className="admin-kpi-grid" aria-label="مؤشرات الأداء">
      <Kpi label="التجار النشطون" value={active.toLocaleString('en-US')} sub="ضمن النطاق المحدد" Icon={Users} color="var(--accent)" onClick={()=>onNavigate('merchants')}/>
      <Kpi label="GMV" value={fmt(currentGMV)} sub="كل التجار والمنصات" delta={gmvDelta} Icon={Wallet} color="var(--text)" onClick={()=>onNavigate('performance')}/>
      <Kpi label="إجمالي الطلبات" value={currentOrders.toLocaleString('en-US')} sub="خلال الفترة المحددة" delta={orderDelta} Icon={ShoppingCart} color="var(--warning-text)" onClick={()=>onNavigate('performance')}/>
      <Kpi label="فشل الاستيراد" value={failedImports.toLocaleString('en-US')} sub="يحتاج تدخلًا الآن" Icon={PackageCheck} color="var(--danger-text)" onClick={()=>onNavigate('uploads')}/>
    </section>

    <section className="admin-timeline-panel"><header><div><h2>GMV عبر الزمن</h2><p>{scopeLabel} · جميع الفلاتر أعلاه مطبقة</p></div><strong>{fmt(currentGMV)}</strong></header>
      <div className="admin-chart" aria-label={`إجمالي GMV ${fmt(currentGMV)}`}>{metrics.trend.length?<ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics.trend.map(row=>({...row,label:new Date(`${row.date}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'short'})}))} margin={{top:12,right:0,left:0,bottom:0}}><defs><linearGradient id="adminGmvGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#08786f" stopOpacity={.22}/><stop offset="95%" stopColor="#08786f" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#dce3e3" vertical={false}/><XAxis dataKey="label" tick={{fill:'#8a999f',fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#8a999f',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={value=>value>=1000?`${(value/1000).toFixed(0)}k`:value}/><Tooltip formatter={(value:number)=>[fmt(value),'GMV']}/><Area type="monotone" dataKey="gmv" stroke="#08786f" strokeWidth={2.5} fill="url(#adminGmvGrad)" dot={false}/></AreaChart></ResponsiveContainer>:<div className="admin-empty">لا توجد بيانات في النطاق</div>}</div>
      <details className="chart-data"><summary>عرض القيم كجدول</summary><div><table><thead><tr><th>التاريخ</th><th>GMV</th><th>الطلبات</th></tr></thead><tbody>{metrics.trend.map(row=><tr key={row.date}><td>{row.date}</td><td>{fmt(Number(row.gmv))}</td><td>{Number(row.orders).toLocaleString('en-US')}</td></tr>)}</tbody></table></div></details>
      <small className="admin-data-coverage">تغطية البيانات: {oldestDate||'—'} إلى {latestDate||'—'}</small>
    </section>

    <section className="admin-secondary-grid"><article><h2><Trophy size={16}/>أفضل التجار ضمن النطاق</h2>{metrics.merchants.length?metrics.merchants.slice(0,5).map((row,index)=><button type="button" key={row.merchant_code} onClick={()=>onNavigate('merchants')}><b>{index+1}</b><span>{merchantOnly.find(merchant=>merchant.merchant_code===row.merchant_code)?.name||row.name}</span><strong>{fmt(Number(row.gmv))}</strong></button>):<div className="admin-empty">لا توجد بيانات</div>}</article><article><h2><TrendingUp size={16}/>آخر النشاطات</h2>{syncLogs.length?syncLogs.slice(0,6).map(log=><button type="button" key={log.id} onClick={()=>onNavigate('operations')}><span><b>{log.merchant_code}</b> · {PLATFORM_MAP[log.platform]||log.platform}</span><strong className={log.status==='success'?'success':'danger'}>{relativeTime(log.started_at)}</strong></button>):<div className="admin-empty">لا توجد نشاطات</div>}</article></section>
  </div>
}

function Decision({tone,title,detail,value,onClick}:{tone:'critical'|'warning'|'info';title:string;detail:string;value:number;onClick:()=>void}) { return <button type="button" className={`admin-decision ${tone}`} onClick={onClick}><span><strong>{title}</strong><small>{detail}</small></span><b>{value.toLocaleString('en-US')}</b></button> }
function Quick({icon,title,detail,onClick}:{icon:React.ReactNode;title:string;detail:string;onClick:()=>void}) { return <button type="button" className="admin-quick" onClick={onClick}><span><strong>{title}</strong><small>{detail}</small></span><i>{icon}</i></button> }
function Kpi({label,value,sub,delta,Icon,color,onClick}:{label:string;value:string;sub:string;delta?:number|null;Icon:any;color:string;onClick:()=>void}) { return <button type="button" className="admin-kpi" onClick={onClick} style={{'--metric-color':color} as React.CSSProperties}><span className="admin-kpi-accent"/><div><span>{label}</span><Icon size={16}/></div><strong>{value}</strong><footer><small>{sub}</small>{delta!==undefined&&<b className={delta===null?'neutral':delta>=0?'positive':'negative'}>{delta===null?'جديد':`${delta>=0?'▲':'▼'} ${Math.abs(delta).toFixed(1)}%`}</b>}</footer></button> }
