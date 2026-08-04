import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, History, Loader2, MessageSquare, PackageCheck, Play, Printer, RefreshCw, RotateCcw, Send, Truck, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { userErrorMessage } from '../lib/userError'

type Risk = 'read' | 'write' | 'destructive'
type Capability = { action:string; label:string; group:string; risk:Risk; pathHint?:string; queryHint?:string; payloadHint?:string }

const CAPABILITIES: Capability[] = [
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
  { action:'products.v2_update_delivery',label:'تحديث خيارات التوصيل V2',group:'المنتجات V2',risk:'write',payloadHint:'{"items":[{"barcode":"...","deliveryOptions":{"deliveryDuration":1,"fastDeliveryType":"FAST_DELIVERY"}}]}' },
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
  { action:'packages.tracking',label:'تحديث رقم التتبع',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"cargoSenderNumber":"...","providerCode":"STARLINKS"}' },
  { action:'packages.status',label:'تحديث حالة الشحنة',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"status":"Picking","lines":[{"lineId":1,"quantity":1}]}' },
  { action:'packages.cancel',label:'إلغاء عناصر الشحنة',group:'الطلبات والشحن',risk:'destructive',pathHint:'{"packageId":"..."}',payloadHint:'{"lines":[...]}' },
  { action:'packages.split',label:'تقسيم الشحنة',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"splitPackages":[...]}' },
  { action:'packages.alternative',label:'تسليم بديل',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{}' },
  { action:'packages.cargo_provider',label:'تغيير شركة الشحن',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"cargoProviderCode":"..."}' },
  { action:'packages.box_info',label:'عدد الصناديق والوزن الحجمي',group:'الطلبات والشحن',risk:'write',pathHint:'{"packageId":"..."}',payloadHint:'{"boxQuantity":1,"deci":1}' },
  { action:'packages.common_label_create',label:'طلب إنشاء ملصق الشحن',group:'الطلبات والشحن',risk:'write',pathHint:'{"cargoTrackingNumber":"..."}',payloadHint:'{"format":"ZPL","boxQuantity":1}' },
  { action:'packages.common_label_get',label:'تحميل ملصق الشحن',group:'الطلبات والشحن',risk:'read',pathHint:'{"cargoTrackingNumber":""}' },
  { action:'seller.addresses',label:'عناوين الشحن والإرجاع',group:'الطلبات والشحن',risk:'read' },
  { action:'questions.list',label:'أسئلة العملاء',group:'خدمة العملاء',risk:'read',queryHint:'{"status":"WAITING_FOR_ANSWER","page":0,"size":50}' },
  { action:'questions.detail',label:'تفاصيل سؤال',group:'خدمة العملاء',risk:'read',pathHint:'{"questionId":"..."}' },
  { action:'questions.answer',label:'الرد على سؤال',group:'خدمة العملاء',risk:'write',pathHint:'{"questionId":"..."}',payloadHint:'{"text":"..."}' },
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

export default function TrendyolActionCenter({ merchantCode, onClose, merchantMode=false }:{ merchantCode:string; onClose:()=>void; merchantMode?:boolean }) {
  return merchantMode ? <MerchantTrendyolCenter merchantCode={merchantCode} onClose={onClose}/> : <AdvancedTrendyolActionCenter merchantCode={merchantCode} onClose={onClose}/>
}

function AdvancedTrendyolActionCenter({ merchantCode, onClose }:{ merchantCode:string; onClose:()=>void }) {
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
      if(selected==='packages.common_label_get'&&!String(parsedPath.cargoTrackingNumber||'').trim()) throw new Error('أدخل رقم تتبع الشحنة الحقيقي قبل التنفيذ')
      const { data:{ session } }=await supabase.auth.getSession()
      const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`,{
        method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session?.access_token || ''}`},
        body:JSON.stringify({merchant_code:merchantCode,action:selected,path:parsedPath,query:parsedQuery,payload:parsedPayload,
          confirm:capability.risk==='read'||confirmed,idempotency_key:capability.risk==='read'?undefined:crypto.randomUUID(),storefront:'SA'}),
      })
      const data=await response.json().catch(()=>({}))
      if(!response.ok||data.error) throw new Error(data.error||`HTTP ${response.status}`)
      setResult(data)
    } catch(e:any){console.error('advanced Trendyol action',e);setError(userErrorMessage(e,'تعذّر تنفيذ العملية. راجع المدخلات وحاول مرة أخرى.'))} finally{setBusy(false)}
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

type MerchantAction = 'questions'|'label'|'status'|'tracking'|'carrier'|'stock'|'approve_return'

function MerchantTrendyolCenter({merchantCode,onClose}:{merchantCode:string;onClose:()=>void}) {
  const [action,setAction]=useState<MerchantAction>('questions')
  const [form,setForm]=useState<Record<string,string>>({status:'Picking'})
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState<{type:'ok'|'err';text:string}|null>(null)
  const actions:[MerchantAction,string,string,any][]=[
    ['questions','أسئلة العملاء','شاهد الأسئلة الجديدة ورد عليها من Sellpert',MessageSquare],
    ['label','ملصقات الشحن','افتح الطلب واختر شحنته لتنزيل الملصق الصحيح',Printer],
    ['status','حالة التجهيز والفاتورة','نفّذ الإجراء من الطلب لتعبئة البنود تلقائيًا',PackageCheck],
    ['tracking','بيانات الشحن والتتبع','اختر الطلب ثم سجّل شركة الشحن ورقم التتبع',Truck],
    ['carrier','شركة الشحن','غيّر الناقل من الشحنة المرتبطة بالطلب',RefreshCw],
    ['stock','السعر والمخزون','افتح المنتج المطلوب وراجع التغيير قبل إرساله',RefreshCw],
    ['approve_return','قرارات المرتجعات','راجع المرتجع ثم اقبله أو ارفضه من سجل التسويات',RotateCcw],
  ]
  const destinations:Partial<Record<MerchantAction,string>>={label:'/orders',status:'/orders',tracking:'/orders',carrier:'/orders',stock:'/products',approve_return:'/statement'}
  function chooseAction(id:MerchantAction) {
    if(id==='questions'){setAction(id);setMessage(null);return}
    const destination=destinations[id]
    if(!destination)return
    onClose();window.history.pushState(null,'',destination);window.dispatchEvent(new PopStateEvent('popstate'))
  }
  const set=(key:string,value:string)=>setForm(current=>({...current,[key]:value}))
  const input=(label:string,key:string,placeholder:string,type='text')=><label style={F.field}><span>{label}</span><input style={M.input} type={type} value={form[key]||''} onChange={e=>set(key,e.target.value)} placeholder={placeholder}/></label>

  async function run() {
    setBusy(true); setMessage(null)
    try {
      let request:any={merchant_code:merchantCode,confirm:true,storefront:'SA',idempotency_key:crypto.randomUUID()}
      if(action==='label') {
        if(!form.tracking?.trim()) throw new Error('أدخل رقم تتبع الشحنة')
        request={...request,action:'packages.common_label_get',path:{cargoTrackingNumber:form.tracking.trim()}}
      } else if(action==='status') {
        const lineId=Number(form.lineId), quantity=Number(form.quantity)
        if(!form.packageId?.trim()) throw new Error('أدخل رقم حزمة الشحنة')
        if(!Number.isInteger(lineId)||lineId<1||!Number.isInteger(quantity)||quantity<1) throw new Error('أدخل رقم بند الطلب والكمية بشكل صحيح')
        if((form.status||'Picking')==='Invoiced'&&!form.invoiceNumber?.trim()) throw new Error('أدخل رقم الفاتورة قبل تحويل الشحنة إلى مفوترة')
        request={...request,action:'packages.status',path:{packageId:form.packageId.trim()},payload:{status:form.status||'Picking',lines:[{lineId,quantity}],...((form.status||'Picking')==='Invoiced'?{params:{invoiceNumber:form.invoiceNumber.trim()}}:{})}}
      } else if(action==='tracking') {
        if(!form.packageId?.trim()||!form.tracking?.trim()||!form.carrier?.trim()) throw new Error('أدخل رقم الحزمة ورقم التتبع وشركة الشحن')
        request={...request,action:'packages.tracking',path:{packageId:form.packageId.trim()},payload:{cargoSenderNumber:form.tracking.trim(),providerCode:form.carrier.trim()}}
      } else if(action==='carrier') {
        if(!form.packageId?.trim()||!form.carrier?.trim()) throw new Error('أدخل رقم الحزمة ورمز شركة الشحن')
        request={...request,action:'packages.cargo_provider',path:{packageId:form.packageId.trim()},payload:{cargoProviderCode:form.carrier.trim()}}
      } else if(action==='stock') {
        if(!form.barcode?.trim()||form.quantity===''||!form.salePrice) throw new Error('أدخل الباركود والكمية وسعر البيع')
        request={...request,action:'products.price_inventory',payload:{items:[{barcode:form.barcode.trim(),quantity:Number(form.quantity),salePrice:Number(form.salePrice),listPrice:Number(form.listPrice||form.salePrice)}]}}
      } else {
        if(!form.claimId?.trim()||!form.claimItems?.trim()) throw new Error('أدخل رقم المطالبة وأرقام عناصر المرتجع')
        request={...request,action:'claims.approve',path:{claimId:form.claimId.trim()},payload:{claimLineItemIdList:form.claimItems.split(',').map(v=>v.trim()).filter(Boolean)}}
      }
      const {data:{session}}=await supabase.auth.getSession()
      const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session?.access_token||''}`},body:JSON.stringify(request)})
      const data=await response.json().catch(()=>({}))
      if(!response.ok||data.error) throw new Error(typeof data.error==='string'?data.error:JSON.stringify(data.error)||`HTTP ${response.status}`)
      if(action==='label') {
        const encoded=data?.data?.data_base64
        const label=data?.data?.data?.[0]?.label
        if(encoded) {
          const binary=atob(encoded); const bytes=new Uint8Array(binary.length)
          for(let index=0;index<binary.length;index+=1) bytes[index]=binary.charCodeAt(index)
          const blob=new Blob([bytes],{type:data?.data?.content_type||'application/octet-stream'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`trendyol-label-${form.tracking}.zpl`; a.click(); URL.revokeObjectURL(url)
        } else if(/^https?:\/\//i.test(label)) window.open(label,'_blank','noopener,noreferrer')
        else if(label) { const blob=new Blob([label],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`trendyol-label-${form.tracking}.zpl`; a.click(); URL.revokeObjectURL(url) }
        else throw new Error('لم يُصدر Trendyol ملصقًا لهذه الشحنة بعد. تأكد أن الشحنة في حالة التجهيز أو مفوترة.')
      }
      setMessage({type:'ok',text:action==='label'?'تم تجهيز ملصق الشحن للتحميل.':'تم إرسال الإجراء إلى Trendyol بنجاح.'})
    } catch(error:any) { console.error('merchant Trendyol action',error);setMessage({type:'err',text:userErrorMessage(error,'تعذّر تنفيذ الإجراء في Trendyol.')}) } finally { setBusy(false) }
  }

  return <div style={M.backdrop} onClick={onClose}><div style={{...M.modal,width:'min(760px,100%)'}} onClick={e=>e.stopPropagation()}>
    <div style={M.header}><div><b style={{fontSize:18}}>خدمات Trendyol</b><div style={M.sub}>نفّذ خدمات متجرك مباشرة دون أكواد أو خطوات تقنية</div></div><button aria-label="إغلاق خدمات Trendyol" style={M.close} onClick={onClose}><X size={18}/></button></div>
    <div style={F.actions}>{actions.map(([id,title,desc,Icon])=><button key={id} onClick={()=>chooseAction(id)} style={{...F.action,borderColor:action===id?'#f27a1a':'var(--border)',background:action===id?'rgba(242,122,26,.08)':'var(--surface2)'}}><Icon size={20} color={action===id?'#f27a1a':'var(--text3)'}/><span style={{display:'grid',gap:3}}><b>{title}</b><small style={{color:'var(--text3)',lineHeight:1.4}}>{desc}</small></span></button>)}</div>
    {action==='questions'?<MerchantQuestions merchantCode={merchantCode}/>:<div style={F.form}>
      {action==='label'?input('رقم تتبع الشحنة','tracking','مثال: 3941019487'):
       action==='status'?<>{input('رقم حزمة الشحنة','packageId','Shipment Package ID')}{input('رقم بند الطلب','lineId','Line ID','number')}{input('الكمية في البند','quantity','1','number')}<label style={F.field}><span>الحالة الجديدة</span><select style={M.input} value={form.status||'Picking'} onChange={e=>set('status',e.target.value)}><option value="Picking">قيد التجهيز</option><option value="Invoiced">تم إصدار الفاتورة</option></select></label>{(form.status||'Picking')==='Invoiced'?input('رقم الفاتورة','invoiceNumber','رقم الفاتورة'):null}</>:
       action==='tracking'?<>{input('رقم حزمة الشحنة','packageId','Shipment Package ID')}{input('رقم التتبع','tracking','رقم التتبع الجديد')}{input('رمز شركة الشحن','carrier','مثال: STARLINKS')}</>:
       action==='carrier'?<>{input('رقم حزمة الشحنة','packageId','Shipment Package ID')}{input('رمز شركة الشحن','carrier','مثال: ARAMEX')}</>:
       action==='stock'?<>{input('باركود المنتج','barcode','Barcode')}{input('الكمية المتاحة','quantity','0','number')}{input('سعر البيع','salePrice','0.00','number')}{input('السعر قبل الخصم','listPrice','اختياري','number')}</>:
       <>{input('رقم مطالبة المرتجع','claimId','Claim ID')}{input('أرقام عناصر المرتجع','claimItems','افصل بينها بفاصلة')}</>}
      {message?<div role="status" aria-live="polite" style={{...F.message,background:message.type==='ok'?'var(--success-bg)':'var(--danger-bg)',color:message.type==='ok'?'var(--success-text)':'var(--danger-text)',display:'flex',alignItems:'center',gap:7}}>{message.type==='ok'?<CheckCircle2 size={16}/>:<AlertTriangle size={16}/>} {message.text}</div>:null}
      <button style={{...M.run,width:'100%',gridColumn:'1/-1',opacity:busy?.6:1}} disabled={busy} onClick={run}>{busy?<Loader2 size={15} className="spin"/>:<Play size={15}/>} {busy?'جارٍ التنفيذ...':'تنفيذ الإجراء'}</button>
    </div>}
  </div></div>
}

function MerchantQuestions({merchantCode}:{merchantCode:string}) {
  const [questions,setQuestions]=useState<any[]>([])
  const [replies,setReplies]=useState<any[]>([])
  const [waitingCount,setWaitingCount]=useState(0)
  const [lastSyncedAt,setLastSyncedAt]=useState<string|null>(null)
  const [view,setView]=useState<'pending'|'history'>('pending')
  const [loading,setLoading]=useState(true)
  const [refreshing,setRefreshing]=useState(false)
  const [replying,setReplying]=useState('')
  const [answers,setAnswers]=useState<Record<string,string>>({})
  const [message,setMessage]=useState<{type:'ok'|'err';text:string}|null>(null)

  const call=useCallback(async (action:string,extra:Record<string,unknown>={}) => {
    const {data:{session}}=await supabase.auth.getSession()
    if(!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
    const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`,{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'idempotency-key':crypto.randomUUID()},
      body:JSON.stringify({merchant_code:merchantCode,action,storefront:'SA',...extra}),
    })
    const data=await response.json().catch(()=>({}))
    if(!response.ok||data.error) throw new Error(data.error||'تعذّر الاتصال بـ Trendyol')
    return data
  },[merchantCode])

  const readInbox=useCallback(async () => {
    const data=await call('questions.inbox',{query:{limit:100}})
    const inbox:any[]=Array.isArray(data?.data?.questions)?data.data.questions:[]
    setQuestions(inbox)
    setReplies(Array.isArray(data?.data?.replies)?data.data.replies:[])
    setWaitingCount(Number(data?.data?.waitingCount||0))
    const newest=inbox.reduce((current:string|null,item:any)=>{
      const value=typeof item?.last_synced_at==='string'?item.last_synced_at:null
      return value&&(!current||value>current)?value:current
    },null)
    setLastSyncedAt(newest)
    return inbox.length>0
  },[call])

  const synchronize=useCallback(async (quiet=false) => {
    setRefreshing(true)
    if(!quiet)setMessage(null)
    try {
      await call('questions.list',{query:{status:'WAITING_FOR_ANSWER',page:0,size:50,orderByField:'CreatedDate',orderByDirection:'DESC'}})
      await readInbox()
      if(!quiet)setMessage({type:'ok',text:'تم تحديث صندوق أسئلة العملاء من Trendyol.'})
    } catch(error:any) {
      setMessage({type:'err',text:userErrorMessage(error,'تعذّر التحديث من Trendyol. ما زالت آخر نسخة محفوظة ظاهرة أمامك.')})
    } finally { setRefreshing(false) }
  },[call,readInbox])

  const load=useCallback(async () => {
    setLoading(true);setMessage(null)
    let hasCached=false
    try { hasCached=await readInbox() }
    catch(error) { console.error('cached Trendyol questions',error) }
    finally { setLoading(false) }
    await synchronize(hasCached)
  },[readInbox,synchronize])

  useEffect(()=>{void load()},[load])

  async function answer(question:any) {
    const id=String(question.question_id||question.id)
    const text=(answers[id]||'').trim()
    if(text.length<10){setMessage({type:'err',text:'اكتب ردًا واضحًا من 10 أحرف على الأقل.'});return}
    if(!window.confirm('تأكيد إرسال هذا الرد إلى العميل عبر Trendyol؟'))return
    setReplying(id);setMessage(null)
    try {
      await call('questions.answer',{confirm:true,path:{questionId:id},payload:{text}})
      setAnswers(current=>({...current,[id]:''}))
      await readInbox()
      setMessage({type:'ok',text:'تم إرسال الرد إلى Trendyol للمراجعة.'})
    } catch(error:any) { setMessage({type:'err',text:userErrorMessage(error,'تعذّر إرسال الرد إلى Trendyol.')}) }
    finally { setReplying('') }
  }

  return <div style={{...F.form,display:'block'}}>
    <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10,marginBottom:12}}>
      <div><b style={{fontSize:14}}>صندوق أسئلة العملاء</b><div style={{fontSize:10,color:'var(--text3)',marginTop:3}}>محفوظ داخل متجرك ويتحدّث من Trendyol دون فقد سجل الردود.</div></div>
      <button style={{...M.close,width:'auto',padding:'0 10px',display:'inline-flex',alignItems:'center',gap:6}} onClick={()=>void synchronize()} disabled={refreshing} aria-label="تحديث الأسئلة"><RefreshCw size={15} className={refreshing?'spin':''}/><span style={{fontSize:10,fontWeight:800}}>{refreshing?'جارٍ التحديث':'تحديث'}</span></button>
    </div>
    <div style={F.questionSummary}>
      <div style={F.questionMetric}><span>تنتظر الرد</span><strong>{waitingCount.toLocaleString('ar-SA')}</strong></div>
      <div style={F.questionMetric}><span>ردود أُرسلت</span><strong>{replies.filter(reply=>reply.status==='sent').length.toLocaleString('ar-SA')}</strong></div>
      <div style={F.questionMetric}><span>آخر مزامنة</span><strong style={{fontSize:11}}>{lastSyncedAt?new Date(lastSyncedAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'short',timeStyle:'short'}):'لم تتم بعد'}</strong></div>
    </div>
    <div style={F.questionTabs}>
      <button onClick={()=>setView('pending')} style={{...F.questionTab,...(view==='pending'?F.questionTabActive:{})}}><Clock3 size={14}/> بانتظار الرد <span>{waitingCount.toLocaleString('ar-SA')}</span></button>
      <button onClick={()=>setView('history')} style={{...F.questionTab,...(view==='history'?F.questionTabActive:{})}}><History size={14}/> سجل الردود <span>{replies.length.toLocaleString('ar-SA')}</span></button>
    </div>
    {message?<div role="status" aria-live="polite" style={{...F.message,marginBottom:10,background:message.type==='ok'?'var(--success-bg)':'var(--danger-bg)',color:message.type==='ok'?'var(--success-text)':'var(--danger-text)'}}>{message.text}</div>:null}
    {loading?<div style={F.empty}><Loader2 size={18} className="spin"/> جارٍ فتح صندوق الأسئلة...</div>:
     view==='history' ? (replies.length===0?<div style={F.empty}><History size={20}/> لم ترسل ردودًا من Sellpert حتى الآن.</div>:<div style={{display:'grid',gap:9}}>{replies.map(reply=><article key={reply.id} style={F.replyCard}>
       <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><b style={{fontSize:11}}>السؤال رقم {reply.question_id}</b><span style={{...F.replyStatus,color:reply.status==='sent'?'var(--success-text)':reply.status==='failed'?'var(--danger-text)':'var(--warning-text)',background:reply.status==='sent'?'var(--success-bg)':reply.status==='failed'?'var(--danger-bg)':'var(--warning-bg)'}}>{reply.status==='sent'?'تم الإرسال':reply.status==='failed'?'تعذّر الإرسال':'جارٍ الإرسال'}</span></div>
       <p style={{fontSize:12,lineHeight:1.8,margin:'8px 0 5px'}}>{reply.answer_text}</p>
       {reply.error_message?<div style={{fontSize:10,color:'var(--danger-text)',marginBottom:5}}>{reply.error_message}</div>:null}
       <small style={{color:'var(--text3)'}}>{new Date(reply.completed_at||reply.requested_at).toLocaleString('ar-SA-u-ca-gregory-nu-latn')}</small>
     </article>)}</div>) : questions.filter(question=>question.status==='WAITING_FOR_ANSWER').length===0?<div style={F.empty}><CheckCircle2 size={20} color="var(--success-text)"/> لا توجد أسئلة تنتظر الرد الآن.</div>:
     <div style={{display:'grid',gap:10}}>{questions.filter(question=>question.status==='WAITING_FOR_ANSWER').map(question=>{
       const id=String(question.question_id||question.id)
       return <article key={id} style={F.questionCard}>
         <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
           {question.image_url?<img src={question.image_url} alt="" style={{width:54,height:54,objectFit:'contain',borderRadius:8,border:'1px solid var(--border)',background:'#fff'}}/>:null}
           <div style={{minWidth:0,flex:1}}><div style={{fontSize:11,fontWeight:800}}>{question.product_name||'منتج Trendyol'}</div><div style={{fontSize:12,lineHeight:1.8,marginTop:5}}>{question.question_text}</div><div style={{fontSize:10,color:'var(--text3)',marginTop:4}}>{question.show_customer_name&&question.customer_name?question.customer_name:'عميل Trendyol'} · {question.asked_at?new Date(question.asked_at).toLocaleString('ar-SA-u-ca-gregory-nu-latn'):'وقت غير متاح'}</div></div>
         </div>
         <textarea value={answers[id]||''} onChange={event=>setAnswers(current=>({...current,[id]:event.target.value.slice(0,2000)}))} placeholder="اكتب ردًا واضحًا للعميل..." style={{...M.textarea,minHeight:78,marginTop:10,fontFamily:'inherit',direction:'rtl',textAlign:'right'}}/>
         <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginTop:7}}><span style={{fontSize:10,color:'var(--text3)'}}>{(answers[id]||'').length.toLocaleString('ar-SA')} / 2,000</span><button style={{...M.run,padding:'8px 13px',opacity:replying===id ? .6 : 1}} disabled={replying===id} onClick={()=>void answer(question)}>{replying===id?<Loader2 size={14} className="spin"/>:<Send size={14}/>} إرسال الرد</button></div>
       </article>
     })}</div>}
  </div>
}

const M:Record<string,React.CSSProperties>={backdrop:{position:'fixed',inset:0,zIndex:1200,background:'rgba(4,15,23,.65)',display:'grid',placeItems:'center',padding:18},modal:{width:'min(940px,100%)',maxHeight:'92vh',overflowY:'auto',background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:18,padding:22},header:{display:'flex',justifyContent:'space-between',borderBottom:'1px solid var(--border)',paddingBottom:14,marginBottom:16},sub:{fontSize:11,color:'var(--text3)',marginTop:4},close:{width:34,height:34,borderRadius:9,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',cursor:'pointer'},grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:14},label:{display:'block',fontSize:11,fontWeight:700,color:'var(--text3)',marginBottom:6},input:{width:'100%',padding:'10px 12px',borderRadius:9,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)'},textarea:{width:'100%',minHeight:105,padding:10,borderRadius:9,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontFamily:'monospace',fontSize:11,resize:'vertical'},risk:{display:'inline-flex',padding:'6px 12px',borderRadius:20,fontSize:11,fontWeight:800},confirm:{display:'flex',alignItems:'center',gap:8,padding:11,borderRadius:9,background:'var(--warning-bg)',color:'var(--warning-text)',fontSize:12,marginBottom:12},run:{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:7,padding:'10px 18px',border:0,borderRadius:10,background:'var(--accent-strong)',color:'#fff',fontWeight:800,cursor:'pointer'},error:{padding:10,borderRadius:9,background:'var(--danger-bg)',color:'var(--danger-text)',fontSize:12,marginBottom:12},result:{padding:12,borderRadius:10,background:'var(--success-bg)',color:'var(--success-text)',marginBottom:12},pre:{maxHeight:240,overflow:'auto',direction:'ltr',textAlign:'left',fontSize:10,whiteSpace:'pre-wrap'}}
const F:Record<string,React.CSSProperties>={actions:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:9,marginBottom:16},action:{display:'grid',gridTemplateColumns:'26px 1fr',gap:'3px 8px',alignItems:'center',textAlign:'right',padding:12,border:'1px solid var(--border)',borderRadius:11,color:'var(--text)',cursor:'pointer',fontFamily:'inherit'},form:{padding:16,borderRadius:12,background:'var(--surface2)',border:'1px solid var(--border)',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12},field:{display:'grid',gap:6,fontSize:11,fontWeight:700,color:'var(--text2)'},message:{gridColumn:'1/-1',padding:10,borderRadius:8,fontSize:12},empty:{minHeight:110,display:'flex',alignItems:'center',justifyContent:'center',gap:8,color:'var(--text3)',fontSize:12},questionCard:{padding:13,border:'1px solid var(--border)',borderRadius:11,background:'var(--surface)'},questionSummary:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(125px,1fr))',gap:8,marginBottom:12},questionMetric:{padding:'10px 11px',border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',display:'grid',gap:5,fontSize:10,color:'var(--text3)'},questionTabs:{display:'flex',gap:7,borderBottom:'1px solid var(--border)',marginBottom:12},questionTab:{border:0,borderBottom:'2px solid transparent',background:'transparent',color:'var(--text3)',padding:'9px 10px',display:'inline-flex',alignItems:'center',gap:6,fontFamily:'inherit',fontSize:11,fontWeight:800,cursor:'pointer'},questionTabActive:{color:'#d96000',borderBottomColor:'#f27a1a'},replyCard:{padding:12,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)'},replyStatus:{padding:'4px 8px',borderRadius:999,fontSize:9,fontWeight:800},}
