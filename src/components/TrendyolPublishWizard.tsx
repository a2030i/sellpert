import { useDeferredValue, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  flattenTrendyolCategories,
  parseTrendyolAddresses,
  parseTrendyolAttributes,
  parseTrendyolAttributeValues,
  parseTrendyolBrands,
  type TrendyolAddress,
  type TrendyolAttribute,
  type TrendyolCategoryOption,
  type TrendyolOption,
} from '../lib/trendyolCatalog'
import { userErrorMessage } from '../lib/userError'

type Props = {
  product: any
  merchantCode: string
  onSubmitted: (listing: any) => void
  mode?: 'create' | 'repair'
}

const fieldStyle: React.CSSProperties = { width:'100%', boxSizing:'border-box', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', borderRadius:8, padding:'9px 11px', fontFamily:'inherit', fontSize:12, outline:'none' }
const labelStyle: React.CSSProperties = { display:'block', fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:5 }

function productImages(product: any) {
  const images = Array.isArray(product?.images) ? product.images : []
  return [...images.map((value: any) => typeof value === 'string' ? value : value?.url), product?.image_url]
    .map(value => String(value || '').trim()).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 8)
}

function resultData(result: any) {
  return result?.data ?? result
}

export default function TrendyolPublishWizard({ product, merchantCode, onSubmitted, mode = 'create' }: Props) {
  const repairing = mode === 'repair'
  const [opened, setOpened] = useState(false)
  const [loadingReferences, setLoadingReferences] = useState(false)
  const [categories, setCategories] = useState<TrendyolCategoryOption[]>([])
  const [addresses, setAddresses] = useState<TrendyolAddress[]>([])
  const [brandQuery, setBrandQuery] = useState(String(product.brand || ''))
  const [brands, setBrands] = useState<TrendyolOption[]>([])
  const [brand, setBrand] = useState<TrendyolOption | null>(null)
  const [categoryQuery, setCategoryQuery] = useState(String(product.category || ''))
  const deferredCategoryQuery = useDeferredValue(categoryQuery)
  const [category, setCategory] = useState<TrendyolCategoryOption | null>(null)
  const [attributes, setAttributes] = useState<TrendyolAttribute[]>([])
  const [attributeValues, setAttributeValues] = useState<Record<number, TrendyolOption[]>>({})
  const [selectedAttributes, setSelectedAttributes] = useState<Record<number, string[]>>({})
  const [customAttributes, setCustomAttributes] = useState<Record<number, string>>({})
  const [loadingAttribute, setLoadingAttribute] = useState<number | null>(null)
  const [showOptional, setShowOptional] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type:'ok' | 'err'; text:string } | null>(null)
  const [form, setForm] = useState(() => ({
    title:String(product.name || '').slice(0, 100),
    description:String(product.description || ''),
    barcode:String(product.barcode || '').trim(),
    productMainId:String(product.model_code || product.supplier_sku || product.sku || '').slice(0, 40),
    stockCode:String(product.supplier_sku || product.sku || '').slice(0, 100),
    quantity:String(product.raw?.quantity ?? product.raw?.stock ?? 0),
    salePrice:String(product.sale_price ?? product.target_net_price ?? ''),
    listPrice:String(product.msrp ?? product.sale_price ?? product.target_net_price ?? ''),
    vatRate:String([0, 1, 10, 20].includes(Number(product.vat_rate)) ? Number(product.vat_rate) : 20),
    origin:'SA',
    dimensionalWeight:'',
    shipmentAddressId:'',
    returningAddressId:'',
    deliveryDuration:'',
    fastDeliveryType:'',
    images:productImages(product).join('\n'),
  }))

  async function callTrendyol(action: string, options: Record<string, unknown> = {}, write = false) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
      method:'POST',
      headers:{
        Authorization:`Bearer ${session.access_token}`,
        apikey:import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type':'application/json',
        ...(write ? { 'idempotency-key':crypto.randomUUID() } : {}),
      },
      body:JSON.stringify({ merchant_code:merchantCode, action, storefront:'SA', language:'ar', ...(write ? { confirm:true } : {}), ...options }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result?.error) throw new Error(result?.error || 'تعذر الاتصال بـ Trendyol')
    return result
  }

  async function openWizard() {
    setOpened(true)
    if (categories.length || loadingReferences) return
    setLoadingReferences(true)
    setMessage(null)
    try {
      const [categoryResult, addressResult] = await Promise.all([
        callTrendyol('categories.list'),
        callTrendyol('seller.addresses'),
      ])
      setCategories(flattenTrendyolCategories(resultData(categoryResult)))
      setAddresses(parseTrendyolAddresses(resultData(addressResult)))
    } catch (error) {
      setMessage({ type:'err', text:userErrorMessage(error, 'تعذر تحميل فئات وعناوين Trendyol.') })
    } finally { setLoadingReferences(false) }
  }

  async function searchBrands() {
    setMessage(null)
    if (brandQuery.trim().length < 2) return setMessage({ type:'err', text:'اكتب حرفين على الأقل من اسم العلامة التجارية.' })
    try {
      const result = await callTrendyol('brands.search', { query:{ name:brandQuery.trim() } })
      const parsed = parseTrendyolBrands(resultData(result))
      setBrands(parsed)
      if (!parsed.length) setMessage({ type:'err', text:'لم نجد علامة بهذا الاسم في Trendyol. جرّب الاسم الرسمي للعلامة.' })
    } catch (error) { setMessage({ type:'err', text:userErrorMessage(error, 'تعذر البحث عن العلامة التجارية.') }) }
  }

  async function chooseCategory(value: TrendyolCategoryOption) {
    setCategory(value)
    setCategoryQuery(value.path)
    setAttributes([])
    setSelectedAttributes({})
    setCustomAttributes({})
    setMessage(null)
    try {
      const result = await callTrendyol('categories.v2_attributes', { path:{ categoryId:value.id } })
      const parsed = parseTrendyolAttributes(resultData(result))
      setAttributes(parsed)
      const requiredWithoutValues = parsed.filter(attribute => attribute.required && !attribute.allowCustom && attribute.values.length === 0)
      const loaded = await Promise.all(requiredWithoutValues.map(async attribute => {
        const valuesResult = await callTrendyol('categories.v2_values', { path:{ categoryId:value.id, attributeId:attribute.id }, query:{ page:0, size:1000 } })
        return [attribute.id, parseTrendyolAttributeValues(resultData(valuesResult))] as const
      }))
      setAttributeValues(Object.fromEntries(loaded))
    } catch (error) { setMessage({ type:'err', text:userErrorMessage(error, 'تعذر تحميل خصائص هذه الفئة.') }) }
  }

  async function ensureAttributeValues(attribute: TrendyolAttribute) {
    if (!category || attribute.allowCustom || attribute.values.length || attributeValues[attribute.id]) return
    setLoadingAttribute(attribute.id)
    try {
      const result = await callTrendyol('categories.v2_values', { path:{ categoryId:category.id, attributeId:attribute.id }, query:{ page:0, size:1000 } })
      setAttributeValues(current => ({ ...current, [attribute.id]:parseTrendyolAttributeValues(resultData(result)) }))
    } catch (error) { setMessage({ type:'err', text:userErrorMessage(error, 'تعذر تحميل قيم الخاصية.') }) }
    finally { setLoadingAttribute(null) }
  }

  const categoryMatches = useMemo(() => {
    const query = deferredCategoryQuery.trim().toLocaleLowerCase('ar')
    if (category && query === category.path.toLocaleLowerCase('ar')) return []
    if (query.length < 2) return []
    return categories.filter(value => value.path.toLocaleLowerCase('ar').includes(query)).slice(0, 40)
  }, [categories, category, deferredCategoryQuery])
  const visibleAttributes = showOptional ? attributes : attributes.filter(attribute => attribute.required)
  const imageUrls = form.images.split('\n').map(value => value.trim()).filter(Boolean)
  const validationError = () => {
    if (!brand) return 'اختر العلامة التجارية من نتائج Trendyol.'
    if (!category) return 'اختر الفئة النهائية المناسبة.'
    if (!form.title.trim() || !form.description.trim() || !form.barcode.trim() || !form.stockCode.trim() || !form.productMainId.trim()) return 'أكمل اسم المنتج والوصف والباركود ورمز المخزون والموديل.'
    if (!imageUrls.length) return 'أضف صورة واحدة على الأقل للمنتج.'
    if (attributes.some(attribute => attribute.required && !(selectedAttributes[attribute.id]?.length || customAttributes[attribute.id]?.trim()))) return 'أكمل جميع خصائص الفئة الإلزامية.'
    if (!repairing) {
      const quantity = Number(form.quantity), salePrice = Number(form.salePrice), listPrice = Number(form.listPrice)
      if (!Number.isInteger(quantity) || quantity < 0 || !Number.isFinite(salePrice) || salePrice < 0 || !Number.isFinite(listPrice) || listPrice < salePrice) return 'تحقق من المخزون والأسعار؛ السعر قبل الخصم لا يقل عن سعر البيع.'
    }
    return ''
  }

  function startReview() {
    setMessage(null)
    const error = validationError()
    if (error) return setMessage({ type:'err', text:error })
    setReviewing(true)
  }

  async function submit() {
    if (!brand || !category || submitting) return
    setSubmitting(true)
    setMessage(null)
    try {
      const payload: Record<string, any> = {
        barcode:form.barcode, title:form.title, productMainId:form.productMainId, brandId:brand.id, categoryId:category.id,
        stockCode:form.stockCode, description:form.description, vatRate:Number(form.vatRate), origin:form.origin,
        images:imageUrls.map(url => ({ url })),
        attributes:attributes.flatMap<Record<string, unknown>>(attribute => {
          const ids = selectedAttributes[attribute.id] || []
          const custom = customAttributes[attribute.id]?.trim()
          return ids.length ? [{ attributeId:attribute.id, attributeValueIds:ids.map(Number) }] : custom ? [{ attributeId:attribute.id, attributeValue:custom }] : []
        }),
      }
      if (!repairing) Object.assign(payload, { quantity:Number(form.quantity), listPrice:Number(form.listPrice), salePrice:Number(form.salePrice) })
      if (form.dimensionalWeight) payload.dimensionalWeight = Number(form.dimensionalWeight)
      if (form.shipmentAddressId) payload.shipmentAddressId = Number(form.shipmentAddressId)
      if (form.returningAddressId) payload.returningAddressId = Number(form.returningAddressId)
      if (form.deliveryDuration !== '') payload.deliveryOption = { deliveryDuration:Number(form.deliveryDuration), ...(form.fastDeliveryType ? { fastDeliveryType:form.fastDeliveryType } : {}) }
      const result = await callTrendyol(repairing ? 'products.v2_update_unapproved' : 'products.v2_create', { product_id:product.id, payload:{ items:[payload] } }, true)
      const now = new Date().toISOString()
      const listing = {
        merchant_code:merchantCode, product_id:product.id, platform:'trendyol', title:form.title.trim(), description:form.description.trim(),
        images:imageUrls, delivery_status:result.status || (result.batchRequestId ? 'accepted' : 'success'), external_batch_id:result.batchRequestId || null,
        notes:'trendyol_product_create',
        last_submitted_at:now, last_verified_at:now, delivery_error:null, updated_at:now,
      }
      onSubmitted(listing)
      setReviewing(false)
      setMessage({ type:'ok', text:repairing ? 'تم إرسال التصحيحات إلى Trendyol وإعادة المنتج للمراجعة.' : 'تم إرسال المنتج إلى Trendyol. بدأت المنصة المراجعة وسنحدّث النتيجة تلقائيًا هنا.' })
    } catch (error) { setMessage({ type:'err', text:userErrorMessage(error, repairing ? 'تعذر إرسال تصحيح المنتج إلى Trendyol.' : 'تعذر إرسال المنتج إلى Trendyol.') }) }
    finally { setSubmitting(false) }
  }

  if (!opened) return <div style={{ padding:18, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
    <div style={{ fontSize:15, fontWeight:750 }}>{repairing ? 'تصحيح المنتج وإعادة المراجعة' : 'نشر المنتج في Trendyol'}</div>
    <p style={{ margin:'6px 0 14px', color:'var(--text3)', fontSize:12, lineHeight:1.7 }}>{repairing ? 'راجع سبب الرفض أعلاه، ثم صحح بيانات المنتج كاملة. سنعيد إرساله مباشرة إلى مراجعة Trendyol.' : 'هذا المنتج غير منشور في Trendyol بعد. سنستخدم بياناته الحالية ونطلب منك فقط اختيار معلومات المنصة اللازمة.'}</p>
    <button onClick={() => void openWizard()} style={{ border:'none', borderRadius:8, background:'#9a3f00', color:'#fff', padding:'9px 16px', fontFamily:'inherit', fontWeight:700, cursor:'pointer' }}>{repairing ? 'بدء تصحيح المنتج' : 'بدء تجهيز المنتج'}</button>
  </div>

  return <div style={{ padding:16, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'start', marginBottom:14 }}>
      <div><div style={{ fontSize:15, fontWeight:750 }}>{repairing ? 'تصحيح بيانات المنتج المرفوض' : 'تجهيز المنتج للنشر في Trendyol'}</div><div style={{ color:'var(--text3)', fontSize:11, marginTop:4 }}>لن تظهر المعرفات التقنية للتاجر؛ الاختيارات تُرسل داخليًا إلى المنصة.</div></div>
      <button onClick={() => setOpened(false)} style={{ border:'1px solid var(--border)', background:'var(--surface)', borderRadius:7, padding:'6px 9px', fontFamily:'inherit', cursor:'pointer' }}>إغلاق</button>
    </div>
    {loadingReferences ? <div role="status" style={{ padding:16, color:'var(--text3)', fontSize:12 }}>جارٍ تجهيز الفئات والعناوين من Trendyol…</div> : null}
    {!reviewing ? <>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))', gap:10 }}>
        <Field label="اسم المنتج"><input value={form.title} maxLength={100} onChange={event => setForm(current => ({ ...current, title:event.target.value }))} style={fieldStyle}/></Field>
        <Field label="الباركود"><input value={form.barcode} maxLength={40} onChange={event => setForm(current => ({ ...current, barcode:event.target.value }))} style={fieldStyle}/></Field>
        <Field label="رمز المخزون"><input value={form.stockCode} maxLength={100} onChange={event => setForm(current => ({ ...current, stockCode:event.target.value }))} style={fieldStyle}/></Field>
        <Field label="رمز الموديل"><input value={form.productMainId} maxLength={40} onChange={event => setForm(current => ({ ...current, productMainId:event.target.value }))} style={fieldStyle}/></Field>
      </div>
      <Field label="وصف المنتج"><textarea value={form.description} maxLength={30000} rows={4} onChange={event => setForm(current => ({ ...current, description:event.target.value }))} style={{ ...fieldStyle, resize:'vertical' }}/></Field>
      {!repairing ? <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
        <Field label="المخزون"><input type="number" min="0" max="20000" value={form.quantity} onChange={event => setForm(current => ({ ...current, quantity:event.target.value }))} style={fieldStyle}/></Field>
        <Field label="سعر البيع (ر.س)"><input type="number" min="0" step="0.01" value={form.salePrice} onChange={event => setForm(current => ({ ...current, salePrice:event.target.value }))} style={fieldStyle}/></Field>
        <Field label="السعر قبل الخصم (ر.س)"><input type="number" min="0" step="0.01" value={form.listPrice} onChange={event => setForm(current => ({ ...current, listPrice:event.target.value }))} style={fieldStyle}/></Field>
        <Field label="ضريبة القيمة المضافة"><select value={form.vatRate} onChange={event => setForm(current => ({ ...current, vatRate:event.target.value }))} style={fieldStyle}>{[0,1,10,20].map(value => <option key={value} value={value}>{value}%</option>)}</select></Field>
      </div> : <Field label="ضريبة القيمة المضافة"><select value={form.vatRate} onChange={event => setForm(current => ({ ...current, vatRate:event.target.value }))} style={fieldStyle}>{[0,1,10,20].map(value => <option key={value} value={value}>{value}%</option>)}</select></Field>}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:10 }}>
        <Field label="العلامة التجارية">
          <div style={{ display:'flex', gap:6 }}><input value={brandQuery} onChange={event => { setBrandQuery(event.target.value); setBrand(null) }} style={fieldStyle}/><button onClick={() => void searchBrands()} style={secondaryButton}>بحث</button></div>
          {brand ? <Selected text={brand.name} /> : brands.length ? <OptionList>{brands.slice(0,20).map(value => <button key={value.id} onClick={() => { setBrand(value); setBrandQuery(value.name); setBrands([]) }} style={optionButton}>{value.name}</button>)}</OptionList> : null}
        </Field>
        <Field label="فئة Trendyol النهائية">
          <input value={categoryQuery} onChange={event => { setCategoryQuery(event.target.value); setCategory(null) }} placeholder="ابحث باسم الفئة" style={fieldStyle}/>
          {category ? <Selected text={category.path} /> : categoryMatches.length ? <OptionList>{categoryMatches.map(value => <button key={value.id} onClick={() => void chooseCategory(value)} style={optionButton}>{value.path}</button>)}</OptionList> : null}
        </Field>
      </div>
      {category && attributes.length ? <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid var(--border)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center' }}><div><div style={{ fontSize:13, fontWeight:700 }}>خصائص الفئة</div><div style={{ fontSize:11, color:'var(--text3)', marginTop:3 }}>أكمل الخصائص الإلزامية أولًا.</div></div><button onClick={() => setShowOptional(value => !value)} style={secondaryButton}>{showOptional ? 'إخفاء الاختيارية' : 'إظهار الاختيارية'}</button></div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:10 }}>
          {visibleAttributes.map(attribute => <Field key={attribute.id} label={`${attribute.name}${attribute.required ? ' — إلزامي' : ''}`}>
            {attribute.allowCustom ? <input value={customAttributes[attribute.id] || ''} onChange={event => setCustomAttributes(current => ({ ...current, [attribute.id]:event.target.value }))} style={fieldStyle}/>
              : <select multiple={attribute.allowMultiple} value={attribute.allowMultiple ? (selectedAttributes[attribute.id] || []) : (selectedAttributes[attribute.id]?.[0] || '')} onFocus={() => void ensureAttributeValues(attribute)} onChange={event => setSelectedAttributes(current => ({ ...current, [attribute.id]:Array.from(event.target.selectedOptions).map(option => option.value) }))} style={{ ...fieldStyle, minHeight:attribute.allowMultiple ? 90 : undefined }}>
                {!attribute.allowMultiple ? <option value="">اختر</option> : null}
                {(attribute.values.length ? attribute.values : attributeValues[attribute.id] || []).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
              </select>}
            {loadingAttribute === attribute.id ? <span style={{ fontSize:10, color:'var(--text3)' }}>جارٍ تحميل الخيارات…</span> : null}
          </Field>)}
        </div>
      </div> : null}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:10, marginTop:10 }}>
        <Field label="مستودع الشحن"><select value={form.shipmentAddressId} onChange={event => setForm(current => ({ ...current, shipmentAddressId:event.target.value }))} style={fieldStyle}><option value="">استخدام الافتراضي</option>{addresses.filter(value => value.type === 'shipment').map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></Field>
        <Field label="عنوان الإرجاع"><select value={form.returningAddressId} onChange={event => setForm(current => ({ ...current, returningAddressId:event.target.value }))} style={fieldStyle}><option value="">استخدام الافتراضي</option>{addresses.filter(value => value.type === 'return').map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></Field>
        <Field label="مدة التجهيز بالأيام"><input type="number" min="0" max="30" value={form.deliveryDuration} onChange={event => setForm(current => ({ ...current, deliveryDuration:event.target.value }))} placeholder="الافتراضي" style={fieldStyle}/></Field>
        <Field label="سرعة التوصيل"><select value={form.fastDeliveryType} onChange={event => setForm(current => ({ ...current, fastDeliveryType:event.target.value, deliveryDuration:event.target.value ? '1' : current.deliveryDuration }))} style={fieldStyle}><option value="">قياسي</option><option value="FAST_DELIVERY">توصيل سريع</option><option value="SAME_DAY_SHIPPING">شحن في اليوم نفسه</option></select></Field>
      </div>
      <Field label="روابط الصور — رابط HTTPS في كل سطر"><textarea value={form.images} rows={4} onChange={event => setForm(current => ({ ...current, images:event.target.value }))} style={{ ...fieldStyle, direction:'ltr', textAlign:'left' }}/></Field>
      <div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}><button onClick={startReview} style={primaryButton}>مراجعة المنتج قبل النشر</button></div>
    </> : <div>
      <div style={{ fontSize:14, fontWeight:750, marginBottom:10 }}>راجع المنتج قبل إرساله</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:8 }}>
        {([['المنتج',form.title],['العلامة',brand?.name],['الفئة',category?.path],...(!repairing ? [['المخزون',form.quantity],['سعر البيع',`${Number(form.salePrice).toFixed(2)} ر.س`]] : []),['الصور',`${imageUrls.length} صورة`],['الخصائص',`${attributes.filter(value => selectedAttributes[value.id]?.length || customAttributes[value.id]?.trim()).length} خاصية`]] as Array<[string,any]>).map(([label,value]) => <div key={label} style={{ padding:10, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8 }}><div style={{ fontSize:10, color:'var(--text3)' }}>{label}</div><div style={{ fontSize:12, fontWeight:650, marginTop:4 }}>{value}</div></div>)}
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}><button disabled={submitting} onClick={() => setReviewing(false)} style={secondaryButton}>العودة للتعديل</button><button disabled={submitting} onClick={() => void submit()} style={primaryButton}>{submitting ? 'جارٍ الإرسال…' : repairing ? 'تأكيد وإعادة المراجعة' : 'تأكيد ونشر في Trendyol'}</button></div>
    </div>}
    {message ? <div role={message.type === 'err' ? 'alert' : 'status'} style={{ marginTop:12, padding:'10px 12px', borderRadius:8, background:message.type === 'err' ? 'var(--danger-bg)' : 'var(--success-bg)', color:message.type === 'err' ? 'var(--danger-text)' : 'var(--success-text)', fontSize:12, lineHeight:1.7 }}>{message.text}</div> : null}
  </div>
}

function Field({ label, children }: { label:string; children:React.ReactNode }) {
  return <label style={{ display:'block', marginTop:10 }}><span style={labelStyle}>{label}</span>{children}</label>
}
function OptionList({ children }: { children:React.ReactNode }) { return <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', background:'var(--surface)', borderRadius:8, marginTop:5, display:'grid' }}>{children}</div> }
function Selected({ text }: { text:string }) { return <div role="status" style={{ fontSize:11, color:'var(--success-text)', marginTop:5 }}>تم الاختيار: {text}</div> }
const optionButton: React.CSSProperties = { border:'none', borderBottom:'1px solid var(--border)', background:'transparent', color:'var(--text)', textAlign:'right', padding:'8px 10px', fontFamily:'inherit', cursor:'pointer', fontSize:11 }
const secondaryButton: React.CSSProperties = { border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', borderRadius:8, padding:'8px 11px', fontFamily:'inherit', fontSize:11, fontWeight:650, cursor:'pointer', whiteSpace:'nowrap' }
const primaryButton: React.CSSProperties = { border:'none', background:'#9a3f00', color:'#fff', borderRadius:8, padding:'9px 14px', fontFamily:'inherit', fontSize:12, fontWeight:750, cursor:'pointer' }
