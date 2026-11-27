import InventoryPoolEditor from './InventoryPoolEditor'
import { useEffect, useState } from 'react'
import { useSellingAccountClient } from './SellingAccountScope'
import { fetchAllStrict } from '../lib/db'
import { bundleSummary } from '../lib/catalogStructure'

type Variant = { id: string; name: string; sku: string; cost_price: number; family_id: string | null; variant_attributes: Record<string, string>; product_kind: string; current_bundle_version_id: string | null }
type Component = { product_id: string; units: number }
export default function CatalogStructureEditor({ merchantCode, productId, onSaved }: { merchantCode: string; productId: string; onSaved: () => void }) {
  const db = useSellingAccountClient()
  const [products, setProducts] = useState<Variant[]>([])
  const [families, setFamilies] = useState<{ id: string; name: string }[]>([])
  const [family, setFamily] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [components, setComponents] = useState<Component[]>([])
  const [bundle, setBundle] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const current = products.find(product => product.id === productId)
  useEffect(() => {
    let cancelled = false
    setBusy(true); setError('')
    Promise.all([
      fetchAllStrict<Variant>((f,t) => db.from('products').select('id,name,sku,cost_price,family_id,variant_attributes,product_kind,current_bundle_version_id').eq('merchant_code',merchantCode).order('name').order('id').range(f,t)),
      fetchAllStrict<{id:string;name:string}>((f,t) => db.from('product_families').select('id,name').eq('merchant_code',merchantCode).order('name').order('id').range(f,t)),
    ]).then(async ([variants,groups]) => {
      const product = variants.find(row => row.id === productId)
      if (!product) throw new Error('تعذر العثور على المنتج')
      let recipe: Component[] = []
      if (product.current_bundle_version_id) {
        const {data,error} = await db.from('product_bundle_components').select('component_product_id,units').eq('merchant_code',merchantCode).eq('recipe_id',product.current_bundle_version_id)
        if (error) throw error
        recipe = (data || []).map(row => ({product_id:row.component_product_id,units:row.units}))
      }
      if (cancelled) return
      setProducts(variants); setFamilies(groups); setFamily(product.family_id || ''); setColor(product.variant_attributes.color || ''); setSize(product.variant_attributes.size || '')
      setBundle(product.product_kind === 'virtual_bundle'); setComponents(recipe)
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : 'تعذر تحميل بنية المنتج') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [db, merchantCode, productId, reload])
  const summary = bundleSummary(components.map(component => ({productId:component.product_id,units:component.units,cost:products.find(p => p.id === component.product_id)?.cost_price || null,available:null})))
  async function saveVariant() {
    if (!current) return
    setBusy(true); setError('')
    try {
      let familyId = family || null
      if (family === 'new') {
        const {data,error} = await db.from('product_families').insert({merchant_code:merchantCode,name:familyName.trim()}).select('id').single()
        if (error) throw error
        familyId = data.id
      }
      const {data,error} = await db.from('products').update({family_id:familyId,variant_attributes:{...current.variant_attributes,color:color.trim(),size:size.trim()}})
        .eq('merchant_code',merchantCode).eq('id',productId).select('id').single()
      if (error || !data) throw new Error('تعذر حفظ المتغير. تحقق من الصلاحية ثم أعد المحاولة.')
      onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر حفظ المتغير') }
    finally { setBusy(false) }
  }
  async function saveBundle() {
    if (!current) return
    const question = current.product_kind === 'variant'
      ? `تحويل «${current.name}» إلى باقة افتراضية؟ سيُحسب توفرها وتكلفتها من مكوناتها، ولن يُضاف رصيدها إلى المخزون الفعلي. تبقى المبيعات السابقة محفوظة.`
      : 'حفظ نسخة جديدة من مكونات الباقة؟ تبقى المبيعات السابقة مرتبطة بنسختها ولا يتغير المخزون الفعلي.'
    if (!window.confirm(question)) return
    setBusy(true); setError('')
    try {
      const {error} = await db.rpc('save_product_bundle',{p_merchant_code:merchantCode,p_product_id:productId,p_components:components,p_expected_version_id:current.current_bundle_version_id})
      if (error) throw new Error('تعذر حفظ الباقة. تأكد من المكونات أو أعد التحميل إذا عدّلها مستخدم آخر.')
      onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر حفظ الباقة') }
    finally { setBusy(false) }
  }
  return <section className="catalog-structure-editor" style={{ borderTop:'1px solid var(--border)',paddingTop:16,marginTop:16,display:'grid',gap:12 }} aria-busy={busy}>
    <h3 style={{margin:0}}>المتغيرات والباقات</h3>
    <p style={{fontSize:12,color:'var(--text2)',margin:0}}>كل مقاس ولون متغير مستقل. العائلة تجمع المتغيرات للعرض ولا تدمج أرصدتها أو مبيعاتها.</p>
    {error ? <div role="alert">{error} <button type="button" onClick={() => setReload(n => n + 1)}>إعادة التحميل</button></div> : null}
    {current ? <>
      <label>عائلة المنتج<select value={family} disabled={busy} onChange={event => setFamily(event.target.value)}><option value="">بدون عائلة</option>{families.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}<option value="new">عائلة جديدة…</option></select></label>
      {family === 'new' ? <label>اسم العائلة<input value={familyName} maxLength={200} onChange={event => setFamilyName(event.target.value)}/></label> : null}
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}><label>اللون<input value={color} maxLength={80} onChange={event => setColor(event.target.value)}/></label><label>المقاس<input value={size} maxLength={80} onChange={event => setSize(event.target.value)}/></label></div>
      <button type="button" disabled={busy || (family === 'new' && !familyName.trim())} onClick={() => void saveVariant()}>حفظ بيانات المتغير</button>
      <details open={bundle} onToggle={event => setBundle(event.currentTarget.open)}><summary>مكونات باقة افتراضية</summary>
        <p style={{fontSize:12,color:'var(--text2)'}}>الباقة تستهلك وحدات من متغيرات فعلية. لا تُضاف كرصيد مخزون مستقل. أي تكلفة ناقصة تمنع احتساب تكلفتها الكاملة.</p>
        {components.map((component,index) => <div key={index} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 70px auto',gap:6,marginBlock:8}}>
          <select aria-label={`المكون ${index+1}`} value={component.product_id} onChange={event => setComponents(rows => rows.map((row,i) => i === index ? {...row,product_id:event.target.value} : row))}><option value="">اختر متغيرًا</option>{products.filter(p => p.id !== productId && p.product_kind === 'variant').map(p => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select>
          <input aria-label={`كمية المكون ${index+1}`} type="number" min={1} step={1} value={component.units} onChange={event => setComponents(rows => rows.map((row,i) => i === index ? {...row,units:Number(event.target.value)} : row))}/>
          <button type="button" aria-label={`إزالة المكون ${index+1}`} onClick={() => setComponents(rows => rows.filter((_,i) => i !== index))}>إزالة</button>
        </div>)}
        <button type="button" disabled={busy || components.length >= 100} onClick={() => setComponents(rows => [...rows,{product_id:'',units:1}])}>إضافة مكون</button>
        <p>تكلفة المكونات الحالية: {summary.cost == null ? 'غير مكتملة' : `${summary.cost.toLocaleString('ar-SA')} ر.س`}</p>
        <button type="button" disabled={busy || !components.length || components.some(c => !c.product_id || !Number.isInteger(c.units) || c.units < 1) || new Set(components.map(c => c.product_id)).size !== components.length} onClick={() => void saveBundle()}>{current.product_kind === 'variant' ? 'تحويل إلى باقة افتراضية' : 'حفظ نسخة جديدة للباقة'}</button>
      </details>
      <InventoryPoolEditor merchantCode={merchantCode} productId={productId} />
    </> : busy ? <p role="status">جارٍ تحميل المتغير…</p> : null}
  </section>
}
