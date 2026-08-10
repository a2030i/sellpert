import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronLeft, Download, Link2, PackageSearch, Search, Unlink, X } from 'lucide-react'
import { supabase, type Merchant } from '../lib/supabase'
import { toastErr, toastOk } from '../components/Toast'

type Mapping = { id:string; platform:string; identifier_type:string; identifier_value:string; status:'linked'|'review'|'unknown' }
type CatalogItem = { id:string|null; name:string; name_en:string|null; sku:string|null; barcode:string|null; brand:string|null; category:string|null; image_url:string|null; cost_price:number; sale_price:number|null; target_net_price:number; catalog_status:string; inventory:number; mappings:Mapping[]; match_status:'linked'|'review'|'unknown' }
type Stats = { total:number; linked:number; review:number; unknown:number }
type CatalogResult = { items:CatalogItem[]; stats:Stats; filtered_count:number }
type LinkTarget = { id:string; name:string; sku:string|null }
const EMPTY_STATS: Stats = { total:0, linked:0, review:0, unknown:0 }
const PAGE_SIZE = 50
const platformNames: Record<string,string> = { noon:'Noon', amazon:'Amazon', trendyol:'Trendyol', salla:'Salla', zid:'Zid', shopify:'Shopify', other:'أخرى' }

export default function ProductCatalog({ merchant }: { merchant:Merchant|null }) {
  const [items,setItems] = useState<CatalogItem[]>([]), [stats,setStats] = useState(EMPTY_STATS)
  const [filteredCount,setFilteredCount] = useState(0), [status,setStatus] = useState<'all'|'linked'|'review'|'unknown'>('all')
  const [platform,setPlatform] = useState('all'), [search,setSearch] = useState(''), deferredSearch = useDeferredValue(search)
  const [page,setPage] = useState(1), [selected,setSelected] = useState<CatalogItem|null>(null)
  const [loading,setLoading] = useState(true), [error,setError] = useState(''), [reload,setReload] = useState(0)
  const [linkTargets,setLinkTargets] = useState<LinkTarget[]>([]), [targetId,setTargetId] = useState('')

  useEffect(() => { setPage(1) }, [status,platform,deferredSearch])
  useEffect(() => {
    if (!merchant) return
    let cancelled = false
    setLoading(true); setError('')
    supabase.rpc('unified_product_catalog', { p_merchant_code:merchant.merchant_code, p_status:status, p_platform:platform==='all'?null:platform, p_search:deferredSearch.trim()||null, p_limit:PAGE_SIZE, p_offset:(page-1)*PAGE_SIZE })
      .then(({data,error:queryError}) => {
        if (cancelled) return
        if (queryError) { setError(queryError.message); setItems([]) }
        else { const result=data as CatalogResult; setItems(result.items||[]); setStats(result.stats||EMPTY_STATS); setFilteredCount(result.filtered_count||0) }
        setLoading(false)
      })
    return () => { cancelled=true }
  }, [merchant,status,platform,deferredSearch,page,reload])
  useEffect(() => {
    if (!merchant || !selected || selected.id) { setLinkTargets([]); setTargetId(''); return }
    let cancelled=false
    supabase.from('products').select('id,name,sku').eq('merchant_code',merchant.merchant_code).order('name').limit(300).then(({data})=>{
      if (!cancelled) setLinkTargets((data||[]) as LinkTarget[])
    })
    return () => { cancelled=true }
  },[merchant,selected])

  const pageCount=Math.max(1,Math.ceil(filteredCount/PAGE_SIZE))
  const cards=useMemo(()=>[['all','كل المنتجات',stats.total,'#2563eb'],['linked','مرتبط',stats.linked,'#0f958c'],['review','يحتاج مراجعة',stats.review,'#d97706'],['unknown','غير معروف',stats.unknown,'#64748b']] as const,[stats])

  async function unlinkMapping(mapping:Mapping) {
    if (!merchant || !confirm(`فصل معرّف ${mapping.identifier_value} عن المنتج؟`)) return
    const {error}=await supabase.from('product_channel_mappings').update({product_id:null,match_status:'unknown',match_method:null,reviewed_at:new Date().toISOString()}).eq('id',mapping.id).eq('merchant_code',merchant.merchant_code)
    if (error) return toastErr('تعذر فصل الربط')
    toastOk('تم فصل الربط مع الاحتفاظ ببيانات المنصة الأصلية'); setSelected(null); setReload(value=>value+1)
  }

  async function linkUnknown() {
    if (!merchant || !selected || selected.id || !targetId) return
    const mapping=selected.mappings[0]
    const {error}=await supabase.from('product_channel_mappings').update({product_id:targetId,match_status:'linked',match_method:'manual',confidence:1,reviewed_at:new Date().toISOString()}).eq('id',mapping.id).eq('merchant_code',merchant.merchant_code)
    if (error) return toastErr('تعذر اعتماد الربط')
    toastOk('تم ربط المعرّف بالمنتج الموحد'); setSelected(null); setReload(value=>value+1)
  }

  function exportCsv() {
    const rows=[['الاسم العربي','الاسم الإنجليزي','SKU','الباركود','الحالة','المخزون','معرّفات المنصات'],...items.map(item=>[item.name,item.name_en||'',item.sku||'',item.barcode||'',statusLabel(item.match_status),String(item.inventory),item.mappings.map(m=>`${platformNames[m.platform]||m.platform}:${m.identifier_value}`).join(' | ')])]
    const csv='\uFEFF'+rows.map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n'), url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})), a=document.createElement('a')
    a.href=url; a.download=`product-catalog-${merchant?.merchant_code||'store'}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  if (!merchant) return null
  return <div className="product-catalog" dir="rtl">
    <header className="catalog-header"><div><h1><BookOpen size={25}/> دليل المنتجات</h1><p>المرجع الموحد لأسماء المنتجات وربطها عبر جميع قنوات البيع.</p></div><button className="catalog-secondary" onClick={exportCsv}><Download size={16}/> تصدير</button></header>
    <section className="catalog-stats" aria-label="ملخص حالة ربط المنتجات">{cards.map(([key,label,value,color])=><button key={key} className={status===key?'active':''} onClick={()=>setStatus(key)} style={{'--metric-color':color} as React.CSSProperties}><span>{label}</span><strong>{Number(value).toLocaleString('en-US')}</strong><ChevronLeft size={16}/></button>)}</section>
    <section className="catalog-toolbar"><label className="catalog-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="البحث بالاسم أو SKU أو الباركود"/></label><select aria-label="تصفية حسب المنصة" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="all">كل المنصات</option>{Object.entries(platformNames).slice(0,-1).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select aria-label="تصفية حسب حالة الربط" value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="all">كل الحالات</option><option value="linked">مرتبط</option><option value="review">يحتاج مراجعة</option><option value="unknown">غير معروف</option></select></section>
    {error?<div className="catalog-error">تعذر تحميل دليل المنتجات: {error}</div>:null}
    <section className="catalog-table-wrap" aria-busy={loading}><table className="catalog-table"><thead><tr><th>المنتج الموحد</th><th>المعرّفات المرتبطة</th><th>حالة الربط</th><th>إجمالي المخزون</th><th></th></tr></thead><tbody>{!loading&&items.map((item,index)=><tr key={item.id||item.mappings[0]?.id||index} className={selected===item?'selected':''} onClick={()=>setSelected(item)}><td><div className="catalog-product-cell">{item.image_url?<img src={item.image_url} alt=""/>:<span className="catalog-placeholder"><PackageSearch size={19}/></span>}<div><strong>{item.name||'منتج بلا اسم'}</strong><small>{item.sku||item.barcode||'—'}</small></div></div></td><td><div className="catalog-mappings">{item.mappings.length?item.mappings.map(m=><span key={m.id}><b>{platformNames[m.platform]||m.platform}</b>{m.identifier_value}</span>):<span>لا توجد معرّفات</span>}</div></td><td><Status value={item.match_status}/></td><td><strong className="latin-number">{Number(item.inventory).toLocaleString('en-US')}</strong></td><td><button className="catalog-row-action" aria-label={`عرض ${item.name}`}><ChevronLeft size={17}/></button></td></tr>)}</tbody></table>
      {loading?<div className="catalog-empty">جاري تحميل دليل المنتجات…</div>:!items.length?<div className="catalog-empty"><PackageSearch size={34}/><strong>لا توجد نتائج ضمن هذا الفلتر</strong><span>غيّر البحث أو اعرض كل المنتجات.</span></div>:null}
      <footer className="catalog-pagination"><span>عرض {items.length?((page-1)*PAGE_SIZE+1):0}–{Math.min(page*PAGE_SIZE,filteredCount)} من {Number(filteredCount).toLocaleString('en-US')}</span><div><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>السابق</button><b>{page} / {pageCount}</b><button disabled={page===pageCount} onClick={()=>setPage(p=>p+1)}>التالي</button></div></footer>
    </section>
    {selected?<aside className="catalog-drawer" aria-label="تفاصيل المنتج"><div className="catalog-drawer-head"><strong>تفاصيل المنتج</strong><button onClick={()=>setSelected(null)} aria-label="إغلاق"><X size={18}/></button></div><div className="catalog-drawer-product">{selected.image_url?<img src={selected.image_url} alt=""/>:<span className="catalog-placeholder large"><PackageSearch/></span>}<div><h2>{selected.name}</h2><p>{selected.name_en||'لا يوجد اسم إنجليزي'}</p><Status value={selected.match_status}/></div></div><Details item={selected}/><div className="catalog-linked"><h3><Link2 size={16}/> المعرّفات على المنصات</h3>{selected.mappings.map(m=><div key={m.id}><span><b>{platformNames[m.platform]||m.platform}</b><small>{m.identifier_type}</small></span><code>{m.identifier_value}</code>{selected.id?<button onClick={()=>unlinkMapping(m)} title="فصل الربط"><Unlink size={15}/></button>:null}</div>)}</div>{!selected.id?<div className="catalog-link-review"><h3>ربط بمنتج موحد</h3><p>اختر المنتج الصحيح لاعتماد اسمه في جميع التقارير.</p><select value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">اختر المنتج…</option>{linkTargets.map(product=><option key={product.id} value={product.id}>{product.name} · {product.sku||'بدون SKU'}</option>)}</select><button disabled={!targetId} onClick={linkUnknown}><Link2 size={15}/> اعتماد الربط</button></div>:null}</aside>:null}
  </div>
}

function Status({value}:{value:CatalogItem['match_status']}) { return <span className={`catalog-status ${value}`}>{statusLabel(value)}</span> }
function statusLabel(value:CatalogItem['match_status']) { return value==='linked'?'مرتبط':value==='review'?'يحتاج مراجعة':'غير معروف' }
function Details({item}:{item:CatalogItem}) { const rows=[['الاسم بالعربية',item.name],['الاسم بالإنجليزية',item.name_en||'—'],['SKU الداخلي',item.sku||'—'],['الباركود',item.barcode||'—'],['العلامة التجارية',item.brand||'—'],['التصنيف',item.category||'—'],['التكلفة',`${Number(item.cost_price||0).toLocaleString('en-US')} ر.س`],['سعر البيع',`${Number(item.sale_price||item.target_net_price||0).toLocaleString('en-US')} ر.س`],['حالة المنتج',item.catalog_status==='active'?'نشط':'متوقف']]; return <div className="catalog-details">{rows.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> }
