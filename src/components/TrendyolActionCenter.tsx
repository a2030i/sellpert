import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Play, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Risk = 'read' | 'write' | 'destructive'
type Capability = { action:string; label:string; group:string; risk:Risk; pathHint?:string; queryHint?:string; payloadHint?:string }

const CAPABILITIES: Capability[] = [
  { action:'products.list',label:'قراءة المنتجات',group:'المنتجات',risk:'read',queryHint:'{"approved":true,"page":0,"size":50}' },
  { action:'products.create',label:'إنشاء منتجات',group:'المنتجات',risk:'write',payloadHint:'{"items":[...]}' },
  { action:'products.update',label:'تحديث منتجات',group:'المنتجات',risk:'write',payloadHint:'{"items":[...]}' },
  { action:'products.delete',label:'حذف منتجات',group:'المنتجات',risk:'destructive',payloadHint:'{"items":[{"barcode":"..."}]}' },
  { action:'products.archive',label:'أرشفة/إلغاء أرشفة',group:'المنتجات',risk:'destructive',payloadHint:'{"items":[...]}' },
  { action:'products.unlock',label:'فك قفل المنتج',group:'المنتجات',risk:'write',payloadHint:'{"items":[...]}' },
  { action:'products.buybox',label:'معلومات Buy Box',group:'المنتجات',risk:'read',queryHint:'{"barcode":"..."}' },
  { action:'products.qc_audit',label:'سجل فحص الجودة',group:'المنتجات',risk:'read',pathHint:'{"contentId":"..."}' },
  { action:'products.price_inventory',label:'تحديث السعر والمخزون',group:'المنتجات',risk:'write',payloadHint:'{"items":[{"barcode":"...","quantity":10,"salePrice":50,"listPrice":60}]}' },
  { action:'products.batch_result',label:'نتيجة Batch',group:'المنتجات',risk:'read',pathHint:'{"batchRequestId":"..."}' },
  { action:'products.v2_create',label:'إنشاء منتج V2',group:'المنتجات V2',risk:'write',payloadHint:'{"items":[...]}' },
  { action:'products.v2_base',label:'بيانات المنتج الأساسية V2',group:'المنتجات V2',risk:'read',pathHint:'{"barcode":"..."}' },
  { action:'products.v2_unapproved',label:'المنتجات غير المقبولة V2',group:'المنتجات V2',risk:'read',queryHint:'{"page":0,"size":50}' },
  { action:'products.v2_approved',label:'المنتجات المقبولة V2',group:'المنتجات V2',risk:'read',queryHint:'{"page":0,"size":50}' },
  { action:'products.v2_stock_price',label:'سعر ومخزون المقبول V2',group:'المنتجات V2',risk:'read',queryHint:'{"page":0,"size":50}' },
  { action:'products.v2_update_unapproved',label:'تحديث غير المقبول V2',group:'المنتجات V2',risk:'write',payloadHint:'{"items":[...]}' },
  { action:'products.v2_update_content',label:'تحديث محتوى المقبول V2',group:'المنتجات V2',risk:'write',payloadHint:'{"items":[...]}' },
  { action:'products.v2_update_variant',label:'تحديث متغيرات المنتج V2',group:'المنتجات V2',risk:'write',payloadHint:'{"items":[...]}' },
  { action:'brands.list',label:'قائمة العلامات',group:'المراجع',risk:'read',queryHint:'{"page":0,"size":50}' },
  { action:'brands.search',label:'البحث عن علامة',group:'المراجع',risk:'read',queryHint:'{"name":"..."}' },
  { action:'brands.create',label:'طلب إنشاء علامة',group:'المراجع',risk:'write',payloadHint:'{"name":"..."}' },
  { action:'categories.list',label:'قائمة الفئات',group:'المراجع',risk:'read' },
  { action:'categories.attributes',label:'خصائص الفئة',group:'المراجع',risk:'read',pathHint:'{"categoryId":123}' },
  { action:'categories.v2_attributes',label:'خصائص الفئة V2',group:'المراجع',risk:'read',pathHint:'{"categoryId":123}' },
  { action:'categories.v2_values',label:'قيم خاصية الفئة V2',group:'المراجع',risk:'read',pathHint:'{"categoryId":123,"attributeId":456}' },
  { action:'videos.list',label:'قراءة فيديوهات المنتجات',group:'الفيديو',risk:'read',queryHint:'{"page":0,"size":50}' },
  { action:'videos.upload',label:'رفع فيديو منتج',group:'الفيديو',risk:'write',payloadHint:'{}' },
  { action:'orders.list',label:'قراءة الطلبات',group:'الطلبات والشحن',risk:'read',queryHint:'{"startDate":0,"endDate":0,"page":0,"size":50}' },
  { action:'orders.stream',label:'قراءة الطلبات Stream',group:'الطلبات والشحن',risk:'read',queryHint:'{"startDate":0,"endDate":0}' },
  { action:'packages.tracking',label:'تحديث رقم التتبع',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"trackingNumber":"..."}' },
  { action:'packages.status',label:'تحديث حالة الشحنة',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"status":"Shipped"}' },
  { action:'packages.cancel',label:'إلغاء عناصر الشحنة',group:'الطلبات والشحن',risk:'destructive',pathHint:'{"packageId":"..."}',payloadHint:'{"lines":[...]}' },
  { action:'packages.split',label:'تقسيم الشحنة',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"splitPackages":[...]}' },
  { action:'packages.alternative',label:'تسليم بديل',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{}' },
  { action:'packages.cargo_provider',label:'تغيير شركة الشحن',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"cargoProviderCode":"..."}' },
  { action:'packages.box_info',label:'عدد الصناديق والوزن الحجمي',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"boxQuantity":1,"deci":1}' },
  { action:'packages.common_label',label:'تحميل ملصق الشحن',group:'الطلبات والشحن',risk:'read',queryHint:'{"id":"رقم التتبع"}' },
  { action:'seller.addresses',label:'عناوين الشحن والإرجاع',group:'الطلبات والشحن',risk:'read' },
  { action:'webhooks.list',label:'قائمة Webhooks',group:'Webhooks',risk:'read' },
  { action:'webhooks.create',label:'إنشاء Webhook',group:'Webhooks',risk:'write',payloadHint:'{"url":"https://...","subscribedStatuses":[...]}' },
  { action:'webhooks.update',label:'تحديث Webhook',group:'Webhooks',risk:'write',pathHint:'{"webhookId":"..."}',payloadHint:'{}' },
  { action:'webhooks.delete',label:'حذف Webhook',group:'Webhooks',risk:'destructive',pathHint:'{"webhookId":"..."}' },
  { action:'webhooks.activate',label:'تفعيل/تعطيل Webhook',group:'Webhooks',risk:'write',pathHint:'{"webhookId":"..."}',payloadHint:'{"status":"ACTIVE"}' },
  { action:'claims.list',label:'قراءة المرتجعات',group:'المرتجعات',risk:'read',queryHint:'{"startDate":0,"endDate":0,"page":0,"size":50}' },
  { action:'claims.create',label:'إنشاء طلب مرتجع',group:'المرتجعات',risk:'write',payloadHint:'{}' },
  { action:'claims.approve',label:'قبول المرتجع',group:'المرتجعات',risk:'write',pathHint:'{"claimId":"..."}',payloadHint:'{"claimLineItemIdList":[...]}' },
  { action:'claims.reject',label:'رفض المرتجع',group:'المرتجعات',risk:'destructive',pathHint:'{"claimId":"..."}',queryHint:'{"claimIssueReasonId":1,"claimItemIdList":"...","description":"..."}' },
  { action:'claims.issue_reasons',label:'أسباب رفض المرتجع',group:'المرتجعات',risk:'read' },
  { action:'claims.audit',label:'سجل مراجعة المرتجع',group:'المرتجعات',risk:'read',pathHint:'{"claimItemId":"..."}' },
  { action:'invoices.send_link',label:'إرسال رابط الفاتورة',group:'الفواتير',risk:'write',payloadHint:'{}' },
  { action:'invoices.send_file',label:'إرسال ملف الفاتورة',group:'الفواتير',risk:'write',payloadHint:'{}' },
  { action:'invoices.delete_link',label:'حذف رابط الفاتورة',group:'الفواتير',risk:'destructive',payloadHint:'{}' },
  { action:'finance.settlements',label:'المبيعات والمرتجعات المالية',group:'الماليات',risk:'read',queryHint:'{"transactionType":"Sale","startDate":0,"endDate":0,"page":0,"size":500}' },
  { action:'finance.other',label:'الحركات المالية الأخرى',group:'الماليات',risk:'read',queryHint:'{"transactionType":"PaymentOrder","startDate":0,"endDate":0,"page":0,"size":500}' },
]

export default function TrendyolActionCenter({ merchantCode, onClose }:{ merchantCode:string; onClose:()=>void }) {
  const [selected,setSelected] = useState(CAPABILITIES[0].action)
  const [path,setPath] = useState('{}'); const [query,setQuery] = useState('{}'); const [payload,setPayload] = useState('{}')
  const [confirmed,setConfirmed] = useState(false); const [busy,setBusy] = useState(false)
  const [result,setResult] = useState<any>(null); const [error,setError] = useState('')
  const capability = useMemo(()=>CAPABILITIES.find(c=>c.action===selected)!,[selected])

  function choose(value:string) {
    const c=CAPABILITIES.find(x=>x.action===value)!; setSelected(value)
    setPath(c.pathHint || '{}'); setQuery(c.queryHint || '{}'); setPayload(c.payloadHint || '{}')
    setConfirmed(false); setResult(null); setError('')
  }
  async function run() {
    setBusy(true); setError(''); setResult(null)
    try {
      const parsedPath=JSON.parse(path||'{}'), parsedQuery=JSON.parse(query||'{}'), parsedPayload=JSON.parse(payload||'{}')
      const { data:{ session } }=await supabase.auth.getSession()
      const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`,{
        method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session?.access_token || ''}`},
        body:JSON.stringify({merchant_code:merchantCode,action:selected,path:parsedPath,query:parsedQuery,payload:parsedPayload,
          confirm:capability.risk==='read'||confirmed,idempotency_key:capability.risk==='read'?undefined:crypto.randomUUID(),storefront:'SA'}),
      })
      const data=await response.json().catch(()=>({}))
      if(!response.ok||data.error) throw new Error(data.error||`HTTP ${response.status}`)
      setResult(data)
    } catch(e:any){setError(e.message||'تعذر تنفيذ العملية')} finally{setBusy(false)}
  }
  function download() {
    const file=result?.data?.data_base64; if(!file)return
    const bytes=Uint8Array.from(atob(file),(c)=>c.charCodeAt(0)); const blob=new Blob([bytes],{type:result.data.content_type||'application/octet-stream'})
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='trendyol-file'; a.click(); URL.revokeObjectURL(url)
  }
  const groups=[...new Set(CAPABILITIES.map(c=>c.group))]
  return <div style={M.backdrop} onClick={onClose}><div style={M.modal} onClick={e=>e.stopPropagation()}>
    <div style={M.header}><div><b style={{fontSize:18}}>مركز عمليات Trendyol</b><div style={M.sub}>جميع الطلبات تمر عبر قائمة آمنة وتُسجل نتائجها</div></div><button style={M.close} onClick={onClose}><X size={18}/></button></div>
    <div style={M.grid}>
      <div><label style={M.label}>العملية</label><select style={M.input} value={selected} onChange={e=>choose(e.target.value)}>{groups.map(g=><optgroup key={g} label={g}>{CAPABILITIES.filter(c=>c.group===g).map(c=><option key={c.action} value={c.action}>{c.label}</option>)}</optgroup>)}</select></div>
      <div style={{display:'flex',alignItems:'end'}}><span style={{...M.risk,background:capability.risk==='read'?'var(--success-bg)':capability.risk==='write'?'var(--warning-bg)':'var(--danger-bg)',color:capability.risk==='read'?'var(--success-text)':capability.risk==='write'?'var(--warning-text)':'var(--danger-text)'}}>{capability.risk==='read'?'قراءة فقط':capability.risk==='write'?'تغيير بيانات':'عملية حساسة'}</span></div>
    </div>
    <div style={M.grid}>{[['معاملات المسار',path,setPath],['معاملات الاستعلام',query,setQuery],['جسم الطلب',payload,setPayload]].map(([label,value,setter]:any)=><div key={label}><label style={M.label}>{label} (JSON)</label><textarea style={M.textarea} value={value} onChange={e=>setter(e.target.value)} dir="ltr"/></div>)}</div>
    {capability.risk!=='read'?<label style={M.confirm}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><AlertTriangle size={15}/> أفهم أن هذه العملية سترسل تغييراً حقيقياً إلى حساب Trendyol</label>:null}
    {error?<div style={M.error}>{error}</div>:null}{result?<div style={M.result}><div style={{fontWeight:800,marginBottom:6}}>نجحت العملية {result.batchRequestId?`· Batch: ${result.batchRequestId}`:''}</div><pre style={M.pre}>{JSON.stringify(result.data?.data_base64?{...result.data,data_base64:'[ملف جاهز للتحميل]'}:result.data,null,2)}</pre>{result.data?.data_base64?<button style={M.run} onClick={download}>تحميل الملف</button>:null}</div>:null}
    <button style={{...M.run,opacity:busy||(capability.risk!=='read'&&!confirmed)?.55:1}} disabled={busy||(capability.risk!=='read'&&!confirmed)} onClick={run}>{busy?<Loader2 size={15} className="spin"/>:<Play size={15}/>} تنفيذ العملية</button>
  </div></div>
}

const M:Record<string,React.CSSProperties>={backdrop:{position:'fixed',inset:0,zIndex:1200,background:'rgba(4,15,23,.65)',display:'grid',placeItems:'center',padding:18},modal:{width:'min(940px,100%)',maxHeight:'92vh',overflowY:'auto',background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:18,padding:22},header:{display:'flex',justifyContent:'space-between',borderBottom:'1px solid var(--border)',paddingBottom:14,marginBottom:16},sub:{fontSize:11,color:'var(--text3)',marginTop:4},close:{width:34,height:34,borderRadius:9,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',cursor:'pointer'},grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:14},label:{display:'block',fontSize:11,fontWeight:700,color:'var(--text3)',marginBottom:6},input:{width:'100%',padding:'10px 12px',borderRadius:9,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)'},textarea:{width:'100%',minHeight:105,padding:10,borderRadius:9,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontFamily:'monospace',fontSize:11,resize:'vertical'},risk:{display:'inline-flex',padding:'6px 12px',borderRadius:20,fontSize:11,fontWeight:800},confirm:{display:'flex',alignItems:'center',gap:8,padding:11,borderRadius:9,background:'var(--warning-bg)',color:'var(--warning-text)',fontSize:12,marginBottom:12},run:{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:7,padding:'10px 18px',border:0,borderRadius:10,background:'var(--accent-strong)',color:'#fff',fontWeight:800,cursor:'pointer'},error:{padding:10,borderRadius:9,background:'var(--danger-bg)',color:'var(--danger-text)',fontSize:12,marginBottom:12},result:{padding:12,borderRadius:10,background:'var(--success-bg)',color:'var(--success-text)',marginBottom:12},pre:{maxHeight:240,overflow:'auto',direction:'ltr',textAlign:'left',fontSize:10,whiteSpace:'pre-wrap'}}
