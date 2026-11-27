import { useEffect, useState } from 'react'
import { useSellingAccountClient, useSelectedSellingAccounts } from './SellingAccountScope'
import { fetchAllStrict } from '../lib/db'

type Observation = { id:string; marketplace_account_id:string; platform:string; sku:string; product_name:string; quantity:number; reserved_quantity:number }
type Pool = {id:string;name:string}
type Link = {inventory_id:string;pool_id:string;product_id:string}
export default function InventoryPoolEditor({merchantCode,productId}:{merchantCode:string;productId:string}) {
  const db=useSellingAccountClient()
  const accounts=useSelectedSellingAccounts()
  const accountLabel=(id:string)=>accounts.find(account=>account.id===id)?.label || id
  const [rows,setRows]=useState<Observation[]>([]), [pools,setPools]=useState<Pool[]>([]), [links,setLinks]=useState<Link[]>([])
  const [choices,setChoices]=useState<Record<string,string>>({}), [name,setName]=useState('')
  const [kind,setKind]=useState('warehouse'), [busy,setBusy]=useState(false), [error,setError]=useState(''), [reload,setReload]=useState(0)
  useEffect(() => {
    let cancelled=false
    setBusy(true);setError('');setRows([]);setChoices({})
    Promise.all([
      fetchAllStrict<Observation>((f,t)=>db.from('inventory').select('id,marketplace_account_id,platform,sku,product_name,quantity,reserved_quantity').eq('merchant_code',merchantCode).eq('is_active',true).order('id').range(f,t)),
      fetchAllStrict<any>((f,t)=>db.from('product_channel_mappings').select('marketplace_account_id,identifier_value,source_sku,source_barcode').eq('merchant_code',merchantCode).eq('product_id',productId).eq('match_status','linked').order('id').range(f,t)),
      fetchAllStrict<Pool>((f,t)=>db.from('inventory_pools').select('id,name').eq('merchant_code',merchantCode).order('name').order('id').range(f,t)),
      fetchAllStrict<Link>((f,t)=>db.from('inventory_pool_links').select('inventory_id,pool_id,product_id').eq('merchant_code',merchantCode).order('inventory_id').range(f,t)),
    ]).then(([inventory,mappings,poolRows,linkRows]) => {
      if(cancelled)return
      const identifiers=new Set(mappings.flatMap(m=>[m.identifier_value,m.source_sku,m.source_barcode].filter(Boolean).map(sku=>JSON.stringify([m.marketplace_account_id,sku]))))
      setRows(inventory.filter(row=>identifiers.has(JSON.stringify([row.marketplace_account_id,row.sku]))||linkRows.some(link=>link.inventory_id===row.id&&link.product_id===productId)))
      setPools(poolRows);setLinks(linkRows);setChoices(Object.fromEntries(linkRows.map(link=>[link.inventory_id,link.pool_id])))
    }).catch(()=>{if(!cancelled)setError('تعذر تحميل مصادر المخزون')}).finally(()=>{if(!cancelled)setBusy(false)})
    return()=>{cancelled=true}
  },[db,merchantCode,productId,reload])
  async function createPool(){
    setBusy(true);setError('')
    try {
      const {data,error}=await db.from('inventory_pools').insert({merchant_code:merchantCode,name:name.trim(),location_type:kind}).select('id,name').single()
      if(error)throw error
      setPools(current=>[...current,data]);setName('')
    }catch{setError('تعذر إضافة مصدر المخزون. تحقق من صلاحية إدارة المخزون.')}
    finally{setBusy(false)}
  }
  async function save(row:Observation){
    const pool=pools.find(pool=>pool.id===choices[row.id]);if(!pool)return
    if(!window.confirm(`تأكيد أن مخزون ${accountLabel(row.marketplace_account_id)} / ${row.platform} / ${row.sku} يعكس المصدر الفعلي «${pool.name}»؟ استخدم المصدر نفسه فقط إذا كانت القنوات تعرض الوحدات نفسها.`))return
    setBusy(true);setError('')
    try{
      const {error}=await db.from('inventory_pool_links').upsert({merchant_code:merchantCode,inventory_id:row.id,pool_id:pool.id,product_id:productId,reviewed_at:new Date().toISOString()},{onConflict:'inventory_id'})
      if(error)throw error
      setLinks(current=>[...current.filter(link=>link.inventory_id!==row.id),{inventory_id:row.id,pool_id:pool.id,product_id:productId}])
    }catch{setError('تعذر حفظ مصدر المخزون. تحقق من الصلاحية ثم أعد المحاولة.')}
    finally{setBusy(false)}
  }
  return <details className="catalog-pool-editor" style={{marginTop:16,borderTop:'1px solid var(--border)',paddingTop:14}}>
    <summary>مصادر المخزون الفعلي</summary>
    <p style={{fontSize:12,color:'var(--text2)'}}>إذا كانت قناتان تعرضان الوحدات نفسها، اختر لهما مصدرًا واحدًا. يُحسب كل مصدر مرة واحدة. اختلاف كمياته أو تقادمها أكثر من يومين يجعل الإجمالي غير متحقق.</p>
    {error?<p role="alert">{error} <button type="button" onClick={()=>setReload(n=>n+1)}>إعادة التحميل</button></p>:null}
    {busy?<p role="status">جارٍ التحديث…</p>:null}
    {!busy&&!error&&!rows.length?<p>لا توجد أرصدة نشطة مرتبطة بهذا المتغير. راجع معرّفات المنصات أولًا.</p>:null}
    {rows.map(row=><div key={row.id} style={{paddingBlock:12,borderBottom:'1px solid var(--border)',display:'grid',gap:8}}>
      <span><b>{accountLabel(row.marketplace_account_id)} · {row.platform}</b> · <bdi>{row.sku}</bdi> · المتاح المسجل {Math.max(0,row.quantity-(row.reserved_quantity||0))}</span>
      <label>مصدر هذه الوحدات<select value={choices[row.id]||''} disabled={busy} onChange={event=>setChoices(current=>({...current,[row.id]:event.target.value}))}><option value="">لم يُحدد</option>{pools.map(pool=><option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
      <button type="button" disabled={busy||Boolean(error)||!choices[row.id]||links.some(link=>link.inventory_id===row.id&&link.pool_id===choices[row.id]&&link.product_id===productId)} onClick={()=>void save(row)}>اعتماد المصدر</button>
    </div>)}
    <form onSubmit={event=>{event.preventDefault();void createPool()}} style={{display:'grid',gap:8,marginTop:12}}>
      <label>مصدر مخزون جديد<input required value={name} maxLength={120} placeholder="مثال: مستودع الرياض" onChange={event=>setName(event.target.value)}/></label>
      <label>نوع المصدر<select value={kind} onChange={event=>setKind(event.target.value)}><option value="warehouse">مستودع التاجر</option><option value="provider">مستودع المنصة</option><option value="other">آخر</option></select></label>
      <button type="submit" disabled={busy||Boolean(error)||!name.trim()}>إضافة المصدر</button>
    </form>
  </details>
}
