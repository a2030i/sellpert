import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { BookOpen, Calculator, ChevronLeft, Download, Link2, PackageSearch, Save, Search, Truck, Unlink, X } from 'lucide-react'
import { supabase, type Merchant } from '../lib/supabase'
import { toastErr, toastOk } from '../components/Toast'
import { categoryCommission, type FeeCategory } from '../lib/commission'
import { calculateProductProfitability, type ProductProfitability, type SellpertFeeType } from '../lib/productProfitability'

type Mapping = { id:string; platform:string; identifier_type:string; identifier_value:string; status:'linked'|'review'|'unknown' }
type CatalogItem = { id:string|null; name:string; name_en:string|null; sku:string|null; barcode:string|null; brand:string|null; category:string|null; image_url:string|null; cost_price:number; sale_price:number|null; target_net_price:number; catalog_status:string; inventory:number; mappings:Mapping[]; match_status:'linked'|'review'|'unknown' }
type Stats = { total:number; linked:number; review:number; unknown:number }
type CatalogResult = { items:CatalogItem[]; stats:Stats; filtered_count:number }
type LinkTarget = { id:string; name:string; sku:string|null }
type PlatformPrice = { product_id:string; platform:string; selling_price:number; override_price:number|null; commission_rate:number; category_key:string|null; commission_source:string|null }
type FinanceSetting = { platform:string; shipping_cost_tax_inclusive:number }
type ContractTerm = { sellpert_fee_type:SellpertFeeType; sellpert_fee_value:number }
type ExactProductRate = { id:string; commission_rate:number|null }
const EMPTY_STATS: Stats = { total:0, linked:0, review:0, unknown:0 }
const PAGE_SIZE = 50
const platformNames: Record<string,string> = { noon:'Noon', amazon:'Amazon', trendyol:'Trendyol', salla:'Salla', zid:'Zid', shopify:'Shopify', other:'أخرى' }
const platformPriority = ['amazon','noon','trendyol','salla','zid','shopify']

function initialPlatform() {
  const requested = new URLSearchParams(window.location.search).get('platform') || ''
  return platformPriority.includes(requested) ? requested : ''
}

export default function ProductCatalog({ merchant }: { merchant:Merchant|null }) {
  const [items,setItems] = useState<CatalogItem[]>([]), [stats,setStats] = useState(EMPTY_STATS)
  const [filteredCount,setFilteredCount] = useState(0), [status,setStatus] = useState<'all'|'linked'|'review'|'unknown'>('all')
  const [platform,setPlatform] = useState(initialPlatform), [search,setSearch] = useState(''), deferredSearch = useDeferredValue(search)
  const [page,setPage] = useState(1), [selected,setSelected] = useState<CatalogItem|null>(null)
  const [loading,setLoading] = useState(true), [error,setError] = useState(''), [reload,setReload] = useState(0)
  const [linkTargets,setLinkTargets] = useState<LinkTarget[]>([]), [targetId,setTargetId] = useState('')
  const [prices,setPrices] = useState<PlatformPrice[]>([]), [feeCategories,setFeeCategories] = useState<FeeCategory[]>([])
  const [financeLoading,setFinanceLoading] = useState(true)
  const [exactRates,setExactRates] = useState<ExactProductRate[]>([]), [financeSettings,setFinanceSettings] = useState<FinanceSetting[]>([])
  const [contractTerm,setContractTerm] = useState<ContractTerm|null>(null)
  const [shippingInput,setShippingInput] = useState('0'), [savingShipping,setSavingShipping] = useState(false)

  useEffect(() => { setPage(1) }, [status,platform,deferredSearch])
  useEffect(() => {
    if (!merchant) return
    let cancelled = false
    setLoading(true); setError('')
    supabase.rpc('unified_product_catalog', { p_merchant_code:merchant.merchant_code, p_status:status, p_platform:platform&&platform!=='all'?platform:null, p_search:deferredSearch.trim()||null, p_limit:PAGE_SIZE, p_offset:(page-1)*PAGE_SIZE })
      .then(({data,error:queryError}) => {
        if (cancelled) return
        if (queryError) { setError(queryError.message); setItems([]) }
        else { const result=data as CatalogResult; setItems(result.items||[]); setStats(result.stats||EMPTY_STATS); setFilteredCount(result.filtered_count||0) }
        setLoading(false)
      })
    return () => { cancelled=true }
  }, [merchant,status,platform,deferredSearch,page,reload])
  useEffect(() => {
    if (!merchant) return
    let cancelled=false
    setFinanceLoading(true)
    Promise.all([
      supabase.from('product_platform_prices').select('product_id,platform,selling_price,override_price,commission_rate,category_key,commission_source').eq('merchant_code',merchant.merchant_code),
      supabase.from('products').select('id,commission_rate').eq('merchant_code',merchant.merchant_code),
      supabase.from('platform_fee_categories').select('platform,category_key,commission_rate,commission_fbn_fba,min_fee_sar'),
      supabase.from('merchant_platform_finance_settings').select('platform,shipping_cost_tax_inclusive').eq('merchant_code',merchant.merchant_code),
      supabase.from('merchant_contract_terms').select('sellpert_fee_type,sellpert_fee_value').eq('merchant_code',merchant.merchant_code).limit(1),
    ]).then(([priceResult,productResult,categoryResult,settingResult,contractResult])=>{
      if (cancelled) return
      setFinanceLoading(false)
      if (priceResult.error || productResult.error || categoryResult.error || settingResult.error || contractResult.error) {
        console.error('load catalog profitability', priceResult.error || productResult.error || categoryResult.error || settingResult.error || contractResult.error)
        return
      }
      setPrices((priceResult.data||[]) as PlatformPrice[])
      setExactRates((productResult.data||[]) as ExactProductRate[])
      setFeeCategories((categoryResult.data||[]) as FeeCategory[])
      setFinanceSettings((settingResult.data||[]) as FinanceSetting[])
      setContractTerm(((contractResult.data||[])[0] as ContractTerm|undefined) || null)
    })
    return () => { cancelled=true }
  },[merchant])
  useEffect(() => {
    const shipping=financeSettings.find(row=>row.platform===platform)?.shipping_cost_tax_inclusive || 0
    setShippingInput(String(shipping))
  },[financeSettings,platform])
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
  const availablePlatforms=useMemo(()=>{
    const available=new Set([...prices.map(row=>row.platform),...financeSettings.map(row=>row.platform),...items.flatMap(item=>item.mappings.map(mapping=>mapping.platform))])
    return platformPriority.filter(value=>available.has(value))
  },[prices,financeSettings,items])
  const priceByProduct=useMemo(()=>new Map(prices.filter(row=>row.platform===platform).map(row=>[row.product_id,row])),[prices,platform])
  const exactRateByProduct=useMemo(()=>new Map(exactRates.map(row=>[row.id,Number(row.commission_rate||0)])),[exactRates])
  const shippingCost=Number(financeSettings.find(row=>row.platform===platform)?.shipping_cost_tax_inclusive||0)
  const financialMode=Boolean(platform&&platform!=='all')

  useEffect(()=>{
    if (platform || loading || financeLoading) return
    setPlatform(availablePlatforms[0] || 'all')
  },[platform,loading,financeLoading,availablePlatforms])

  useEffect(()=>{
    if (!platform) return
    const params=new URLSearchParams(window.location.search)
    if (platform==='all') params.delete('platform'); else params.set('platform',platform)
    const query=params.toString()
    window.history.replaceState(null,'',`${window.location.pathname}${query?`?${query}`:''}`)
  },[platform])

  function profitabilityFor(item:CatalogItem): ProductProfitability | null {
    if (!financialMode || !item.id) return null
    const price=priceByProduct.get(item.id)
    const exactRate=platform==='trendyol' ? exactRateByProduct.get(item.id)||0 : 0
    const categoryRate=categoryCommission(feeCategories,platform,item.category)
    const commissionRate=Number(price?.commission_rate||0)>0 ? Number(price!.commission_rate) : exactRate>0 ? exactRate : categoryRate?.rate ?? null
    const sellingPrice=Number(price?.override_price||price?.selling_price||0)>0 ? Number(price?.override_price||price?.selling_price) : Number(item.sale_price||item.target_net_price||0)
    return calculateProductProfitability({ salePrice:sellingPrice, costPrice:Number(item.cost_price||0), commissionRate, minimumCommission:categoryRate?.minFee||0, shippingCostTaxInclusive:shippingCost, sellpertFeeType:contractTerm?.sellpert_fee_type||'none', sellpertFeeValue:Number(contractTerm?.sellpert_fee_value||0) })
  }

  async function saveShippingCost() {
    if (!merchant || !financialMode) return
    const value=Number(shippingInput)
    if (!Number.isFinite(value) || value<0) return toastErr('أدخل تكلفة شحن صحيحة تساوي صفرًا أو أكثر')
    setSavingShipping(true)
    const {data,error}=await supabase.from('merchant_platform_finance_settings').upsert({ merchant_code:merchant.merchant_code, platform, shipping_cost_tax_inclusive:value, updated_at:new Date().toISOString() },{onConflict:'merchant_code,platform'}).select('platform,shipping_cost_tax_inclusive').maybeSingle()
    setSavingShipping(false)
    if (error || !data) return toastErr('تعذر حفظ تكلفة الشحن')
    setFinanceSettings(current=>[...current.filter(row=>row.platform!==platform),data as FinanceSetting])
    toastOk(`تم حفظ تكلفة الشحن لمنصة ${platformNames[platform]||platform}`)
  }

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
    const financial=financialMode
    const rows=financial
      ? [['المنتج','SKU','المنصة','سعر البيع','تكلفة المنتج','نسبة عمولة المنصة','قيمة عمولة المنصة شاملة الضريبة','الشحن شامل الضريبة','عمولة Sellpert للطلب الناجح','صافي المبلغ الواصل','صافي الربح','الجدوى'],...items.map(item=>{const value=profitabilityFor(item);return [item.name,item.sku||'',platformNames[platform]||platform,value?.salePrice??'',item.cost_price,value?.commissionRate??'',value?.commissionValue??'',value?.shippingCost??'',value?.sellpertCommissionValue??'',value?.netReceived??'',value?.netProfit??'',value?viabilityLabel(value.viability):'بيانات ناقصة']})]
      : [['الاسم العربي','الاسم الإنجليزي','SKU','الباركود','الحالة','المخزون','معرّفات المنصات'],...items.map(item=>[item.name,item.name_en||'',item.sku||'',item.barcode||'',statusLabel(item.match_status),String(item.inventory),item.mappings.map(m=>`${platformNames[m.platform]||m.platform}:${m.identifier_value}`).join(' | ')])]
    const csv='\uFEFF'+rows.map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n'), url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})), a=document.createElement('a')
    a.href=url; a.download=`product-catalog-${merchant?.merchant_code||'store'}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  if (!merchant) return null
  return <div className="product-catalog" dir="rtl">
    <header className="catalog-header"><div><h1><BookOpen size={25}/> دليل المنتجات</h1><p>المرجع الموحد لأسماء المنتجات وربطها عبر جميع قنوات البيع.</p></div><button className="catalog-secondary" onClick={exportCsv}><Download size={16}/> تصدير</button></header>
    <section className="catalog-stats" aria-label="ملخص حالة ربط المنتجات">{cards.map(([key,label,value,color])=><button key={key} className={status===key?'active':''} onClick={()=>setStatus(key)} style={{'--metric-color':color} as React.CSSProperties}><span>{label}</span><strong>{Number(value).toLocaleString('en-US')}</strong><ChevronLeft size={16}/></button>)}</section>
    <section className="catalog-toolbar"><label className="catalog-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="البحث بالاسم أو SKU أو الباركود"/></label><select aria-label="اختيار منصة حساب الربحية" value={platform} onChange={e=>setPlatform(e.target.value)}>{!platform?<option value="" disabled>جاري تحديد المنصة…</option>:null}<option value="all">كل المنصات — عرض الربط</option>{Object.entries(platformNames).slice(0,-1).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select aria-label="تصفية حسب حالة الربط" value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="all">كل الحالات</option><option value="linked">مرتبط</option><option value="review">يحتاج مراجعة</option><option value="unknown">غير معروف</option></select></section>
    {financialMode?<section className="catalog-profitability-section" aria-labelledby="catalog-profitability-title"><header className="catalog-profitability-head"><div><Calculator size={18}/><span><h2 id="catalog-profitability-title">تحليل التسعير والربحية</h2><small>تتحدث جميع القيم حسب منصة {platformNames[platform]||platform}</small></span></div><em>تقدير أسوأ الأحوال</em></header><div className="catalog-shipping"><div><Truck size={18}/><span><strong>تكلفة الشحن في {platformNames[platform]||platform}</strong><small>أدخل أسوأ تكلفة متوقعة للطلب الواحد، شاملة ضريبة القيمة المضافة.</small></span></div><label><span>الشحن شامل الضريبة</span><input aria-label="تكلفة الشحن شاملة الضريبة" type="number" min="0" step="0.01" value={shippingInput} onChange={event=>setShippingInput(event.target.value)}/><em>ر.س</em></label><button disabled={savingShipping} onClick={saveShippingCost}><Save size={15}/>{savingShipping?'جارٍ الحفظ':'حفظ'}</button></div><div className="catalog-finance-hint">عمولة Sellpert المعروضة تفترض طلبًا ناجحًا يحتوي هذا المنتج فقط: النسبة على سعر البيع والشحن، والمبلغ الثابت مرة واحدة للطلب. لا تُستحق العمولة على الطلب الملغي أو المرتجع.</div></section>:<div className="catalog-finance-hint">عرض ربط المنتجات عبر كل المنصات. اختر منصة من الفلتر للعودة إلى تحليل التسعير والربحية.</div>}
    {error?<div className="catalog-error">تعذر تحميل دليل المنتجات: {error}</div>:null}
    <section className={`catalog-table-wrap ${financialMode?'financial':''}`} aria-busy={loading}><table className="catalog-table"><thead>{!financialMode?<tr><th>المنتج الموحد</th><th>المعرّفات المرتبطة</th><th>حالة الربط</th><th>إجمالي المخزون</th><th></th></tr>:<tr><th>المنتج الموحد</th><th>سعر البيع</th><th>تكلفة المنتج</th><th>نسبة عمولة المنصة</th><th>قيمة عمولة المنصة<br/><small>شاملة الضريبة</small></th><th>تكلفة الشحن<br/><small>شاملة الضريبة</small></th><th>عمولة Sellpert<br/><small>للطلب الناجح فقط</small></th><th>صافي المبلغ الواصل</th><th>جدوى التسعير<br/><small>في أسوأ الأحوال</small></th><th></th></tr>}</thead><tbody>{!loading&&items.map((item,index)=>{const financial=profitabilityFor(item);return <tr key={item.id||item.mappings[0]?.id||index} className={selected===item?'selected':''} onClick={()=>setSelected(item)}><td><div className="catalog-product-cell">{item.image_url?<img src={item.image_url} alt=""/>:<span className="catalog-placeholder"><PackageSearch size={19}/></span>}<div><strong>{item.name||'منتج بلا اسم'}</strong><small>{item.sku||item.barcode||'—'}</small></div></div></td>{!financialMode?<><td><div className="catalog-mappings">{item.mappings.length?item.mappings.map(m=><span key={m.id}><b>{platformNames[m.platform]||m.platform}</b>{m.identifier_value}</span>):<span>لا توجد معرّفات</span>}</div></td><td><Status value={item.match_status}/></td><td><strong className="latin-number">{Number(item.inventory).toLocaleString('en-US')}</strong></td></>:<><MoneyCell value={financial?.salePrice}/><MoneyCell value={item.cost_price}/><td><strong className="latin-number">{financial?.commissionRate!=null?`${formatNumber(financial.commissionRate)}%`:'—'}</strong></td><MoneyCell value={financial?.commissionValue}/><MoneyCell value={financial?.shippingCost}/><MoneyCell value={financial?.sellpertCommissionValue}/><MoneyCell value={financial?.netReceived} strong tone={financial?.netReceived!=null&&financial.netReceived<0?'danger':undefined}/><td><Viability value={financial}/></td></>}<td><button className="catalog-row-action" aria-label={`عرض ${item.name}`}><ChevronLeft size={17}/></button></td></tr>})}</tbody></table>
      {loading?<div className="catalog-empty">جاري تحميل دليل المنتجات…</div>:!items.length?<div className="catalog-empty"><PackageSearch size={34}/><strong>لا توجد نتائج ضمن هذا الفلتر</strong><span>غيّر البحث أو اعرض كل المنتجات.</span></div>:null}
      <footer className="catalog-pagination"><span>عرض {items.length?((page-1)*PAGE_SIZE+1):0}–{Math.min(page*PAGE_SIZE,filteredCount)} من {Number(filteredCount).toLocaleString('en-US')}</span><div><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>السابق</button><b>{page} / {pageCount}</b><button disabled={page===pageCount} onClick={()=>setPage(p=>p+1)}>التالي</button></div></footer>
    </section>
    {selected?<aside className="catalog-drawer" aria-label="تفاصيل المنتج"><div className="catalog-drawer-head"><strong>تفاصيل المنتج</strong><button onClick={()=>setSelected(null)} aria-label="إغلاق"><X size={18}/></button></div><div className="catalog-drawer-product">{selected.image_url?<img src={selected.image_url} alt=""/>:<span className="catalog-placeholder large"><PackageSearch/></span>}<div><h2>{selected.name}</h2><p>{selected.name_en||'لا يوجد اسم إنجليزي'}</p><Status value={selected.match_status}/></div></div><Details item={selected}/><div className="catalog-linked"><h3><Link2 size={16}/> المعرّفات على المنصات</h3>{selected.mappings.map(m=><div key={m.id}><span><b>{platformNames[m.platform]||m.platform}</b><small>{m.identifier_type}</small></span><code>{m.identifier_value}</code>{selected.id?<button onClick={()=>unlinkMapping(m)} title="فصل الربط"><Unlink size={15}/></button>:null}</div>)}</div>{!selected.id?<div className="catalog-link-review"><h3>ربط بمنتج موحد</h3><p>اختر المنتج الصحيح لاعتماد اسمه في جميع التقارير.</p><select value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">اختر المنتج…</option>{linkTargets.map(product=><option key={product.id} value={product.id}>{product.name} · {product.sku||'بدون SKU'}</option>)}</select><button disabled={!targetId} onClick={linkUnknown}><Link2 size={15}/> اعتماد الربط</button></div>:null}</aside>:null}
  </div>
}

function Status({value}:{value:CatalogItem['match_status']}) { return <span className={`catalog-status ${value}`}>{statusLabel(value)}</span> }
function statusLabel(value:CatalogItem['match_status']) { return value==='linked'?'مرتبط':value==='review'?'يحتاج مراجعة':'غير معروف' }
function formatNumber(value:number) { return Number(value||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2}) }
function MoneyCell({value,strong=false,tone}:{value:number|null|undefined;strong?:boolean;tone?:'danger'}) { return <td className={tone==='danger'?'catalog-money danger':'catalog-money'}>{value==null?'—':<span className={strong?'strong':''}>{formatNumber(value)} <small>ر.س</small></span>}</td> }
function viabilityLabel(value:ProductProfitability['viability']) { return value==='profitable'?'مربح':value==='weak'?'هامش ضعيف':value==='loss'?'خسارة':'بيانات ناقصة' }
function Viability({value}:{value:ProductProfitability|null}) {
  if (!value || value.viability==='missing') return <span className="pricing-viability missing">بيانات ناقصة</span>
  return <div className="pricing-result"><span className={`pricing-viability ${value.viability}`}>{viabilityLabel(value.viability)}</span><strong className="latin-number">{formatNumber(value.netProfit||0)} ر.س</strong><small>{value.marginPercent==null?'—':`${formatNumber(value.marginPercent)}% هامش`}</small></div>
}
function Details({item}:{item:CatalogItem}) { const rows=[['الاسم بالعربية',item.name],['الاسم بالإنجليزية',item.name_en||'—'],['SKU الداخلي',item.sku||'—'],['الباركود',item.barcode||'—'],['العلامة التجارية',item.brand||'—'],['التصنيف',item.category||'—'],['التكلفة',`${Number(item.cost_price||0).toLocaleString('en-US')} ر.س`],['سعر البيع',`${Number(item.sale_price||item.target_net_price||0).toLocaleString('en-US')} ر.س`],['حالة المنتج',item.catalog_status==='active'?'نشط':'متوقف']]; return <div className="catalog-details">{rows.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> }
