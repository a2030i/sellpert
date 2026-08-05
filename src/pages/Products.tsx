import { useState, useEffect, useMemo } from 'react'
import { PRODUCT_SAFE_COLUMNS, supabase } from '../lib/supabase'
import { useCallback } from 'react'
import { useDeferredValue } from 'react'
import { fetchAll } from '../lib/db'
import { useMobile } from '../lib/hooks'
import type { Merchant, Product, ProductPlatformPrice, CommissionRate } from '../lib/supabase'
import { PLATFORM_MAP as PLATFORM_NAMES, PLATFORM_COLORS } from '../lib/constants'
import { Pagination } from '../components/UI'
import ProductCostImport from '../components/ProductCostImport'
import { ArrowRightLeft, Award } from 'lucide-react'
import { userErrorMessage } from '../lib/userError'
import { friendlyDeliveryError } from '../lib/productDelivery'
import { trendyolCatalogReadiness, type TrendyolCatalogReadiness } from '../lib/trendyolCatalog'
import { productDataLineage, type LineageUpload } from '../lib/dataLineage'
import { productDataQuality } from '../lib/productQuality'

const PLATFORMS = ['trendyol'] as const
const PAGE_SIZE = 30

type TrendyolInventoryRow = { sku: string; partner_sku: string | null; quantity: number }
type TrendyolListingRow = { product_id: string; delivery_status: string; delivery_error: string | null; external_batch_id: string | null }
type QualityFilter = 'all' | 'complete' | 'needs_content' | 'missing_cost' | 'unknown_source'

const LINEAGE_TONE = {
  info: { background: 'var(--info-bg)', color: 'var(--info-text)' },
  success: { background: 'var(--success-bg)', color: 'var(--success-text)' },
  warning: { background: 'var(--warning-bg)', color: 'var(--warning-text)' },
} as const

const QUALITY_TONE = {
  success: { background: 'var(--success-bg)', color: 'var(--success-text)' },
  warning: { background: 'var(--warning-bg)', color: 'var(--warning-text)' },
  danger: { background: 'var(--danger-bg)', color: 'var(--danger-text)' },
} as const

function calcSellingPrice(netTarget: number, rate: CommissionRate): number {
  if (!netTarget || netTarget <= 0) return 0
  const totalFeeRate = (rate.rate + rate.vat_rate) / 100
  return Math.ceil((netTarget + rate.shipping_fee + rate.other_fees) / (1 - totalFeeRate))
}

export default function Products({ merchant }: { merchant: Merchant | null }) {
  const [products, setProducts]         = useState<Product[]>([])
  const [prices, setPrices]             = useState<ProductPlatformPrice[]>([])
  const [rates, setRates]               = useState<CommissionRate[]>([])
  const [trendyolInventory, setTrendyolInventory] = useState<TrendyolInventoryRow[]>([])
  const [trendyolListings, setTrendyolListings] = useState<TrendyolListingRow[]>([])
  const [sourceUploads, setSourceUploads] = useState<Map<string, LineageUpload>>(() => new Map())
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState('')
  const [search, setSearch]             = useState('')
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [page, setPage]                 = useState(1)
  const [showAdd, setShowAdd]           = useState(false)
  const [showCostImport, setShowCostImport] = useState(() => new URLSearchParams(window.location.search).get('costs') === 'import')
  // ?tab=analytics يفتح تبويب التحليلات مباشرة (روابط «منتج يبيع بخسارة» من اللوحة)
  const [tab, setTab]                   = useState<'catalog' | 'analytics'>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'analytics' ? 'analytics' : 'catalog')
  const [editProduct, setEditProduct]   = useState<Product | null>(null)
  const [editForm, setEditForm]         = useState({ cost_price: '', target_net_price: '' })
  const [editSaving, setEditSaving]     = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkRefreshing, setBulkRefreshing] = useState(false)
  const [msg, setMsg]                   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const isMobile = useMobile()

  // Add form state
  const [form, setForm] = useState({ name: '', sku: '', category: '', cost_price: '', target_net_price: '' })
  const [saving, setSaving] = useState(false)

  // The loader is intentionally keyed by the current merchant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (merchant) loadData() }, [merchant])

  async function loadData(options: { background?: boolean } = {}) {
    if (!options.background) setLoading(true)
    setLoadError('')
    try {
      const [productResult, priceResult, rateResult, inventoryResult, listingResult, uploadRows] = await Promise.all([
        supabase.from('products').select(PRODUCT_SAFE_COLUMNS).eq('merchant_code', merchant!.merchant_code).order('created_at', { ascending: false }),
        supabase.from('product_platform_prices').select('*').eq('merchant_code', merchant!.merchant_code),
        supabase.from('platform_commission_rates').select('*'),
        supabase.from('inventory').select('sku,partner_sku,quantity').eq('merchant_code', merchant!.merchant_code).eq('platform', 'trendyol'),
        supabase.from('product_platform_listings').select('product_id,delivery_status,delivery_error,external_batch_id').eq('merchant_code', merchant!.merchant_code).eq('platform', 'trendyol'),
        fetchAll<LineageUpload>((from, to) =>
          supabase.from('platform_file_uploads').select('id,platform,file_name,file_type,uploaded_at')
            .eq('merchant_code', merchant!.merchant_code).order('uploaded_at', { ascending: false }).range(from, to), 'سجل ملفات المنتجات'),
      ])
      const error = productResult.error || priceResult.error || rateResult.error || inventoryResult.error || listingResult.error
      if (error) throw error
      setProducts(productResult.data || [])
      setPrices(priceResult.data || [])
      setRates(rateResult.data || [])
      setTrendyolInventory((inventoryResult.data || []) as TrendyolInventoryRow[])
      setTrendyolListings((listingResult.data || []) as TrendyolListingRow[])
      setSourceUploads(new Map(uploadRows.map(upload => [upload.id, upload])))
    } catch (error) {
      console.error('load products', error)
      setLoadError(userErrorMessage(error, 'تعذّر تحميل المنتجات الآن.'))
    } finally {
      if (!options.background) setLoading(false)
    }
  }

  function openProduct(productId: string) {
    window.history.pushState(null, '', `/product-detail?id=${productId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const getRate = useCallback((platform: string, category?: string): CommissionRate | undefined => {
    if (category) {
      const specific = rates.find(r => r.platform === platform && r.category.toLowerCase() === category.toLowerCase())
      if (specific) return specific
    }
    return rates.find(r => r.platform === platform && r.category === 'default')
  }, [rates])

  function getPrices(productId: string): Record<string, number> {
    const result: Record<string, number> = {}
    const prod = productById.get(productId)
    for (const p of PLATFORMS) {
      const existing = priceByProductPlatform.get(`${productId}:${p}`)
      if (existing) {
        result[p] = existing.override_price ?? existing.selling_price
      } else {
        const rate = getRate(p, prod?.category)
        if (prod && rate) result[p] = calcSellingPrice(prod.target_net_price, rate)
      }
    }
    return result
  }

  async function addProduct() {
    if (!form.name.trim() || !form.target_net_price) { setMsg({ type: 'err', text: 'الاسم والسعر المستهدف مطلوبان' }); return }
    setSaving(true); setMsg(null)
    const { data: prod, error } = await supabase.from('products').insert({
      merchant_code: merchant!.merchant_code,
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category: form.category.trim() || null,
      cost_price: parseFloat(form.cost_price) || 0,
      target_net_price: parseFloat(form.target_net_price),
      platform_source: 'manual',
    }).select(PRODUCT_SAFE_COLUMNS).maybeSingle()
    if (error || !prod) { console.error('create product', error); setMsg({ type: 'err', text: userErrorMessage(error, 'تعذّر إضافة المنتج.') }); setSaving(false); return }

    // Auto-calculate and insert prices for each platform
    const priceInserts = PLATFORMS.map(p => {
      const rate = getRate(p)
      if (!rate) return null
      return {
        product_id: prod.id,
        merchant_code: merchant!.merchant_code,
        platform: p,
        selling_price: calcSellingPrice(parseFloat(form.target_net_price), rate),
        commission_rate: rate.rate,
      }
    }).filter((row): row is NonNullable<typeof row> => row !== null)
    if (priceInserts.length) await supabase.from('product_platform_prices').insert(priceInserts)

    setMsg({ type: 'ok', text: 'تمت إضافة المنتج وحساب الأسعار' })
    setForm({ name: '', sku: '', category: '', cost_price: '', target_net_price: '' })
    setShowAdd(false)
    loadData()
    setSaving(false)
  }

  function openEdit(prod: Product) {
    setEditProduct(prod)
    setEditForm({ cost_price: prod.cost_price > 0 ? String(prod.cost_price) : '', target_net_price: prod.target_net_price > 0 ? String(prod.target_net_price) : '' })
  }

  async function saveEditProduct() {
    if (!editProduct) return
    if (!editForm.target_net_price) { setMsg({ type: 'err', text: 'السعر الصافي المستهدف مطلوب' }); return }
    setEditSaving(true)
    const netPrice = parseFloat(editForm.target_net_price)
    const costPrice = editForm.cost_price.trim() ? parseFloat(editForm.cost_price) : 0
    if (!Number.isFinite(netPrice) || netPrice <= 0 || !Number.isFinite(costPrice) || costPrice < 0) {
      setMsg({ type:'err', text:'تحقق من التكلفة والسعر المستهدف.' }); setEditSaving(false); return
    }
    const { error } = await supabase.from('products').update({ cost_price: costPrice, target_net_price: netPrice })
      .eq('id', editProduct.id).eq('merchant_code', merchant!.merchant_code)
    if (error) { console.error('update product', error); setMsg({ type: 'err', text: userErrorMessage(error, 'تعذّر حفظ تعديلات المنتج.') }); setEditSaving(false); return }

    // Recalculate platform prices
    const priceUpserts = PLATFORMS.map(p => {
      const rate = getRate(p, editProduct.category || undefined)
      if (!rate) return null
      return { product_id: editProduct.id, merchant_code: merchant!.merchant_code, platform: p, selling_price: calcSellingPrice(netPrice, rate), commission_rate: rate.rate }
    }).filter((row): row is NonNullable<typeof row> => row !== null)
    if (priceUpserts.length) {
      const { error: priceError } = await supabase.from('product_platform_prices').upsert(priceUpserts, { onConflict: 'product_id,platform' })
      if (priceError) {
        console.error('recalculate platform prices', priceError)
        setMsg({ type:'err', text:'حُفظت تكلفة المنتج، لكن تعذرت إعادة حساب أسعار المنصة. حاول مرة أخرى.' })
        setEditProduct(null); setEditSaving(false); await loadData(); return
      }
    }

    setMsg({ type: 'ok', text: 'تم تحديث الأسعار وإعادة الحساب' })
    setEditProduct(null)
    setEditSaving(false)
    loadData()
  }

  const productQualityById = useMemo(() => new Map(products.map(product => [product.id, productDataQuality(product)])), [products])
  const productLineageById = useMemo(() => new Map(products.map(product => [
    product.id,
    productDataLineage(
      { ...product, platform: '' },
      product.upload_id ? sourceUploads.get(product.upload_id) : null,
    ),
  ])), [products, sourceUploads])
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products])
  const priceByProductPlatform = useMemo(() => new Map(prices.map(price => [`${price.product_id}:${price.platform}`, price])), [prices])

  const deferredSearch = useDeferredValue(search)
  const filtered = useMemo(() => {
    const query = deferredSearch.toLowerCase()
    return products.filter(product => {
      const matchesSearch = !query || product.name.toLowerCase().includes(query) || product.sku?.toLowerCase().includes(query)
      if (!matchesSearch) return false
      const quality = productQualityById.get(product.id)!
      const lineage = productLineageById.get(product.id)!
      if (qualityFilter === 'complete') return quality.complete
      if (qualityFilter === 'needs_content') return quality.missingContent
      if (qualityFilter === 'missing_cost') return Number(product.cost_price || 0) <= 0
      if (qualityFilter === 'unknown_source') return lineage.kind === 'unknown'
      return true
    })
  }, [products, deferredSearch, qualityFilter, productQualityById, productLineageById])
  const pageProducts = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])
  const costedProducts = useMemo(() => products.filter(product => Number(product.cost_price || 0) > 0).length, [products])
  const missingCosts = products.length - costedProducts
  const catalogQuality = useMemo(() => {
    const qualities = [...productQualityById.values()]
    return {
      score: qualities.length ? Math.round(qualities.reduce((sum, quality) => sum + quality.score, 0) / qualities.length) : 0,
      complete: qualities.filter(quality => quality.complete).length,
      needsContent: qualities.filter(quality => quality.missingContent).length,
      unknownSource: [...productLineageById.values()].filter(lineage => lineage.kind === 'unknown').length,
    }
  }, [productQualityById, productLineageById])

  const trendyolStateByProduct = useMemo(() => {
    const inventory = new Map<string, TrendyolInventoryRow>()
    for (const row of trendyolInventory) {
      if (row.sku) inventory.set(row.sku, row)
      if (row.partner_sku) inventory.set(row.partner_sku, row)
    }
    const listings = new Map(trendyolListings.map(row => [row.product_id, row]))
    const result = new Map<string, TrendyolCatalogReadiness>()
    for (const product of products) {
      const platformPrice = priceByProductPlatform.get(`${product.id}:trendyol`)
      const rate = getRate('trendyol', product.category)
      const calculatedPrice = platformPrice?.override_price ?? platformPrice?.selling_price ?? (rate ? calcSellingPrice(product.target_net_price, rate) : null)
      const stock = inventory.get(String(product.sku || '')) || inventory.get(String(product.supplier_sku || '')) || inventory.get(String(product.barcode || ''))
      result.set(product.id, trendyolCatalogReadiness(product, stock, listings.get(product.id), calculatedPrice))
    }
    return result
  }, [products, priceByProductPlatform, trendyolInventory, trendyolListings, getRate])

  const trendyolSummary = useMemo(() => {
    const values = [...trendyolStateByProduct.values()]
    return {
      linked: values.filter(value => value.linked).length,
      ready: values.filter(value => value.ready).length,
      pending: values.filter(value => value.pending).length,
      needsWork: values.filter(value => value.linked && !value.ready && !value.pending).length,
    }
  }, [trendyolStateByProduct])

  useEffect(() => { setPage(1) }, [deferredSearch])
  useEffect(() => {
    setSelectedProducts(current => new Set([...current].filter(id => products.some(product => product.id === id))))
  }, [products])
  useEffect(() => {
    const last = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    if (page > last) setPage(last)
  }, [filtered.length, page])

  const preview = useMemo(() => {
    const net = parseFloat(form.target_net_price) || 0
    if (!net || !form.category.trim()) return null
    return PLATFORMS.map(p => {
      const rate = getRate(p, form.category)
      return { p, price: rate ? calcSellingPrice(net, rate) : 0, ratePct: rate?.rate }
    })
  }, [form.target_net_price, form.category, getRate])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (loadError) return (
    <div style={S.wrap}>
      <div style={{ maxWidth:520, margin:'70px auto', padding:24, textAlign:'center', border:'1px solid var(--border)', borderRadius:12, background:'var(--surface)' }}>
        <h2 style={{ margin:'0 0 8px', fontSize:18 }}>تعذّر تحميل المنتجات</h2>
        <p style={{ margin:'0 0 18px', color:'var(--text2)', fontSize:13, lineHeight:1.8 }}>{loadError}</p>
        <button onClick={() => void loadData()} style={S.addBtn}>إعادة المحاولة</button>
      </div>
    </div>
  )

  function goInventory() {
    window.history.pushState(null, '', '/inventory')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  function toggleSelected(productId: string) {
    setSelectedProducts(current => {
      const next = new Set(current)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function selectReadyProducts() {
    const ids = filtered.filter(product => trendyolStateByProduct.get(product.id)?.ready).slice(0, 1000).map(product => product.id)
    setSelectedProducts(new Set(ids))
    if (!ids.length) setMsg({ type:'err', text:'لا توجد منتجات جاهزة الآن. افتح المنتج لمعرفة البيانات الناقصة.' })
  }

  function toggleReadyPage(checked: boolean) {
    setSelectedProducts(current => {
      const next = new Set(current)
      for (const product of pageProducts) {
        if (!trendyolStateByProduct.get(product.id)?.ready) continue
        if (checked) next.add(product.id)
        else next.delete(product.id)
      }
      return next
    })
  }

  async function callTrendyol(action: string, body: Record<string, unknown>) {
    const { data:{ session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
      method:'POST',
      headers:{ Authorization:`Bearer ${session.access_token}`, apikey:import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type':'application/json', 'idempotency-key':crypto.randomUUID() },
      body:JSON.stringify({ merchant_code:merchant!.merchant_code, action, ...body }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.error) throw new Error(result.error || 'رفض Trendyol العملية')
    return result
  }

  async function submitBulkPriceInventory() {
    const selected = products.filter(product => selectedProducts.has(product.id))
    const blocked = selected.filter(product => !trendyolStateByProduct.get(product.id)?.ready)
    const items = selected.map(product => trendyolStateByProduct.get(product.id)?.item).filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (!selected.length || blocked.length || items.length !== selected.length) {
      setMsg({ type:'err', text:'بعض المنتجات المحددة غير جاهزة. أزلها أو استكمل بياناتها قبل الإرسال.' })
      setShowBulkConfirm(false)
      return
    }
    setBulkSaving(true); setMsg(null)
    try {
      const result = await callTrendyol('products.price_inventory', { confirm:true, storefront:'SA', payload:{ items } })
      setMsg({ type:'ok', text:result.batchRequestId ? `تم إرسال ${items.length.toLocaleString('ar-SA-u-nu-latn')} منتج إلى Trendyol، وتتم متابعة الدفعة الآن.` : `تم تحديث ${items.length.toLocaleString('ar-SA-u-nu-latn')} منتج في Trendyol.` })
      setSelectedProducts(new Set()); setShowBulkConfirm(false)
      await loadData()
    } catch (error) {
      setMsg({ type:'err', text:friendlyDeliveryError(error instanceof Error ? error.message : '') || 'تعذر إرسال الأسعار والمخزون إلى Trendyol.' })
    } finally { setBulkSaving(false) }
  }

  async function refreshPendingBatches() {
    const batches = [...new Set(trendyolListings.filter(row => ['accepted','processing'].includes(row.delivery_status) && row.external_batch_id).map(row => row.external_batch_id!))].slice(0, 20)
    if (!batches.length) return
    setBulkRefreshing(true); setMsg(null)
    try {
      await Promise.all(batches.map(batchRequestId => callTrendyol('products.batch_result', { path:{ batchRequestId } })))
      await loadData()
      setMsg({ type:'ok', text:'تم تحديث حالات دفعات Trendyol.' })
    } catch (error) {
      setMsg({ type:'err', text:friendlyDeliveryError(error instanceof Error ? error.message : '') || 'تعذر تحديث حالات Trendyol الآن.' })
    } finally { setBulkRefreshing(false) }
  }

  const selectedRows = products.filter(product => selectedProducts.has(product.id))
  const selectedBlocked = selectedRows.filter(product => !trendyolStateByProduct.get(product.id)?.ready)

  return (
    <div style={S.wrap}>
      {/* Page Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)', paddingBottom: 0, overflowX: 'auto' }}>
        {([['catalog', 'الكتالوج'], ['analytics', 'الربحية والتحليلات']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{ background: 'none', border: 'none', borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`, marginBottom: -2, padding: '8px 18px', fontSize: 14, fontWeight: tab === k ? 800 : 500, color: tab === k ? 'var(--accent)' : 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {lbl}
          </button>
        ))}
        <button onClick={goInventory} style={{ background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -2, padding: '8px 18px', fontSize: 14, fontWeight: 500, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          المخزون
        </button>
      </div>

      {/* Header */}
      <div style={{ ...S.topbar, gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h2 style={S.title}>المنتجات</h2>
          <p style={S.sub}>{products.length} منتج مسجّل — الأسعار محسوبة تلقائياً لكل منصة</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...S.addBtn, background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--accent)' }} onClick={() => setShowCostImport(true)}>استيراد التكاليف</button>
          <button style={S.addBtn} onClick={() => { setTab('catalog'); setShowAdd(v => !v) }}>{showAdd ? 'إلغاء' : 'إضافة منتج'}</button>
        </div>
      </div>

      {missingCosts > 0 ? <section style={{ background: 'var(--warning-bg)', border: '1px solid color-mix(in srgb,var(--warning-text) 22%,transparent)', borderRadius: 13, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div><strong style={{ display: 'block', fontSize: 13, color: 'var(--text)' }}>الربحية غير مكتملة لـ {missingCosts.toLocaleString('ar-SA-u-nu-latn')} منتج</strong><span style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.7 }}>أدخل تكلفة الشراء جماعيًا لاحتساب تكلفة البضاعة وصافي الربح والمخزون بالقيمة.</span></div>
        <div style={{ minWidth: 190, flex: '0 1 240px' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginBottom: 5 }}><span>اكتمال التكاليف</span><strong>{products.length ? Math.round(costedProducts / products.length * 100) : 0}%</strong></div><div style={{ height: 6, borderRadius: 6, background: 'var(--border)', overflow: 'hidden' }}><i style={{ display: 'block', width: `${products.length ? costedProducts / products.length * 100 : 0}%`, height: '100%', background: 'var(--accent)' }} /></div></div>
        <button style={{ ...S.addBtn, padding: '8px 15px' }} onClick={() => setShowCostImport(true)}>استكمال التكاليف</button>
      </section> : null}

      {products.length ? <section aria-label="جودة بيانات الكتالوج" style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'15px 17px', marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:14, fontWeight:800 }}>جودة بيانات الكتالوج</div>
            <div style={{ color:'var(--text3)', fontSize:11, marginTop:4, lineHeight:1.7 }}>يعتمد القياس على هوية المنتج ومحتواه وتكلفته وسعره، ويوضح مصدر كل سجل دون تخمين.</div>
          </div>
          <div style={{ minWidth:190, flex:'0 1 260px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:6 }}><span style={{ color:'var(--text3)' }}>متوسط الاكتمال</span><strong>{catalogQuality.score}%</strong></div>
            <div role="progressbar" aria-label="متوسط اكتمال بيانات المنتجات" aria-valuemin={0} aria-valuemax={100} aria-valuenow={catalogQuality.score} style={{ height:7, borderRadius:8, background:'var(--border)', overflow:'hidden' }}><i style={{ display:'block', width:`${catalogQuality.score}%`, height:'100%', background:catalogQuality.score >= 85 ? 'var(--success-text)' : catalogQuality.score >= 60 ? 'var(--warning-text)' : 'var(--danger-text)' }} /></div>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr 1fr' : 'repeat(5,minmax(120px,1fr))', gap:8, marginTop:13 }}>
          {([
            ['all', 'كل المنتجات', products.length],
            ['complete', 'مكتملة', catalogQuality.complete],
            ['needs_content', 'تحتاج محتوى', catalogQuality.needsContent],
            ['missing_cost', 'بلا تكلفة', missingCosts],
            ['unknown_source', 'مصدر غير موثق', catalogQuality.unknownSource],
          ] as Array<[QualityFilter, string, number]>).map(([key, label, value]) => (
            <button key={key} type="button" aria-pressed={qualityFilter === key} onClick={() => setQualityFilter(key)} style={{ textAlign:'right', padding:'9px 11px', borderRadius:9, border:`1px solid ${qualityFilter === key ? 'var(--accent)' : 'var(--border)'}`, background:qualityFilter === key ? 'color-mix(in srgb,var(--accent) 8%,var(--surface))' : 'var(--surface2)', color:'var(--text)', cursor:'pointer', fontFamily:'inherit' }}>
              <span style={{ display:'block', fontSize:10, color:'var(--text3)' }}>{label}</span><strong style={{ display:'block', fontSize:17, marginTop:2 }}>{value.toLocaleString('ar-SA-u-nu-latn')}</strong>
            </button>
          ))}
        </div>
      </section> : null}

      {/* Notification */}
      {msg && (
        <div style={{ ...S.alert, background: msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)', border: `1px solid ${msg.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)'}` }}>
          {msg.text}
          <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setMsg(null)} aria-label="إغلاق">×</button>
        </div>
      )}

      {/* تبويب الربحية والتحليلات */}
      {tab === 'analytics' && (<>
      <AmazonBusinessFunnelPanel merchant={merchant} />
      <ProfitabilityPanel merchant={merchant} />
      <InventoryTurnoverCard merchant={merchant} />
      <BuyBoxWarningsPanel merchant={merchant} />
      <CrossPlatformPanel merchant={merchant} />
      <VariantPerformancePanel merchant={merchant} />
      <BrandPerformancePanel merchant={merchant} />
      <SkuLifecyclePanel merchant={merchant} />
      </>)}

      {/* تبويب الكتالوج (نموذج الإضافة + قائمة المنتجات) */}
      {tab === 'catalog' && (<>
      {/* Add Product Form */}
      {showAdd && (
        <div style={S.formCard}>
          <div style={S.formTitle}>إضافة منتج جديد</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div style={S.field}>
              <label style={S.label}>اسم المنتج *</label>
              <input style={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: حذاء رياضي نايك" />
            </div>
            <div style={S.field}>
              <label style={S.label}>SKU</label>
              <input style={S.input} value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="NK-001" dir="ltr" />
            </div>
            <div style={S.field}>
              <label style={S.label}>التصنيف</label>
              <input style={S.input} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="أحذية، ملابس، إلكترونيات..." />
            </div>
            <div style={S.field}>
              <label style={S.label}>تكلفة المنتج (ر.س)</label>
              <input style={S.input} type="number" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))} placeholder="0" />
            </div>
            <div style={{ ...S.field, gridColumn: isMobile ? '1' : '1 / -1' }}>
              <label style={S.label}>السعر الصافي المستهدف (ما تريد تستلمه) *</label>
              <input style={{ ...S.input, fontSize: 16, fontWeight: 700 }} type="number" value={form.target_net_price} onChange={e => setForm(f => ({ ...f, target_net_price: e.target.value }))} placeholder="مثال: 200" />
            </div>
          </div>

          {/* Guide: fill category first */}
          {form.target_net_price && !form.category.trim() && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--warning-bg)', border: '1px solid var(--warning-bg)', borderRadius: 10, fontSize: 12, color: 'var(--warning-text)', fontWeight: 600 }}>
              اختر تصنيف المنتج لمعاينة الأسعار — نسبة العمولة تختلف حسب القسم.
            </div>
          )}

          {/* Live price preview — only after category is chosen */}
          {preview && (
            <div style={S.preview}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={S.previewTitle}>معاينة الأسعار على المنصات</div>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>قسم: {form.category}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
                {preview.map(({ p, price, ratePct }) => (
                  <div key={p} style={{ ...S.previewCard, borderColor: PLATFORM_COLORS[p] + '55' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>{PLATFORM_NAMES[p]}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: PLATFORM_COLORS[p] }}>{price.toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>ر.س</div>
                    {ratePct !== undefined && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>عمولة {ratePct}%</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
            <button style={S.saveBtn} onClick={addProduct} disabled={saving}>{saving ? 'جارٍ الحفظ...' : 'حفظ المنتج'}</button>
            <button style={S.cancelBtn} onClick={() => setShowAdd(false)}>إلغاء</button>
          </div>
        </div>
      )}

      <section aria-label="تشغيل كتالوج Trendyol" style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px', marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:14, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:14, fontWeight:800 }}>تشغيل كتالوج Trendyol</div>
            <div style={{ color:'var(--text3)', fontSize:11, marginTop:4, lineHeight:1.7 }}>حدّد المنتجات المرتبطة لإرسال السعر والمخزون في دفعة واحدة. لن تُرسل المنتجات الناقصة أو التي لديها تحديث قيد المعالجة.</div>
          </div>
          <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
            <button style={{ ...S.reqBtn, padding:'8px 13px' }} onClick={selectReadyProducts}>تحديد الجاهز ({trendyolSummary.ready.toLocaleString('ar-SA-u-nu-latn')})</button>
            {selectedProducts.size ? <button style={{ ...S.reqBtn, padding:'8px 13px' }} onClick={() => setSelectedProducts(new Set())}>إلغاء التحديد</button> : null}
            {trendyolSummary.pending ? <button disabled={bulkRefreshing} style={{ ...S.reqBtn, padding:'8px 13px', opacity:bulkRefreshing ? .6 : 1 }} onClick={() => void refreshPendingBatches()}>{bulkRefreshing ? 'جارٍ التحديث…' : 'تحديث الحالات'}</button> : null}
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr 1fr' : 'repeat(4,minmax(110px,1fr))', gap:8, marginTop:14 }}>
          {[
            ['مرتبط', trendyolSummary.linked, 'var(--text)'],
            ['جاهز للإرسال', trendyolSummary.ready, 'var(--success-text)'],
            ['قيد المعالجة', trendyolSummary.pending, 'var(--warning-text)'],
            ['يحتاج استكمال', trendyolSummary.needsWork, 'var(--danger-text)'],
          ].map(([label,value,color]) => <div key={String(label)} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'9px 11px' }}><div style={{ fontSize:10, color:'var(--text3)' }}>{label}</div><div style={{ fontSize:18, fontWeight:800, color:String(color), marginTop:2 }}>{Number(value).toLocaleString('ar-SA-u-nu-latn')}</div></div>)}
        </div>
        {selectedProducts.size ? <div role="status" style={{ marginTop:12, padding:'11px 13px', borderRadius:10, border:`1px solid ${selectedBlocked.length ? 'color-mix(in srgb,var(--danger-text) 25%,transparent)' : 'color-mix(in srgb,var(--accent) 25%,transparent)'}`, background:selectedBlocked.length ? 'var(--danger-bg)' : 'color-mix(in srgb,var(--accent) 7%,var(--surface))', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div><strong style={{ fontSize:12 }}>{selectedProducts.size.toLocaleString('ar-SA-u-nu-latn')} منتج محدد</strong><div style={{ fontSize:11, color:'var(--text2)', marginTop:3 }}>{selectedBlocked.length ? `${selectedBlocked.length.toLocaleString('ar-SA-u-nu-latn')} منتج غير جاهز — راجع الحالة بجانب كل منتج.` : 'جميع المنتجات المحددة جاهزة لتحديث السعر والمخزون.'}</div></div>
          <button disabled={Boolean(selectedBlocked.length)} onClick={() => setShowBulkConfirm(true)} style={{ ...S.addBtn, padding:'8px 15px', opacity:selectedBlocked.length ? .5 : 1, cursor:selectedBlocked.length ? 'not-allowed' : 'pointer' }}>مراجعة وإرسال إلى Trendyol</button>
        </div> : null}
      </section>

      {/* Search */}
      <input style={S.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث باسم المنتج أو SKU..." />

      {/* Products table */}
      {filtered.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>{products.length ? 'لا توجد نتائج مطابقة' : 'لا توجد منتجات'}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>{products.length ? 'لا توجد منتجات ضمن هذا الفلتر' : 'لا توجد منتجات بعد'}</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{products.length ? 'غيّر البحث أو اعرض كل المنتجات.' : 'أضف منتجك الأول وسيحسب النظام أسعاره تلقائياً'}</div>
          {products.length ? <button type="button" onClick={() => { setSearch(''); setQualityFilter('all') }} style={{ ...S.reqBtn, marginTop:14 }}>عرض كل المنتجات</button> : null}
        </div>
      ) : (
        <div style={S.tableCard}>
          {isMobile ? (
            // Mobile: card list
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
              {pageProducts.map(prod => {
                const ps = getPrices(prod.id)
                const profit = prod.target_net_price - prod.cost_price
                const readiness = trendyolStateByProduct.get(prod.id)
                const quality = productQualityById.get(prod.id)!
                const lineage = productLineageById.get(prod.id)!
                const lineageTone = LINEAGE_TONE[lineage.tone]
                const qualityTone = QUALITY_TONE[quality.tone]
                return (
                  <div key={prod.id} role="link" tabIndex={0} aria-label={`فتح المنتج ${prod.name}`} style={{ ...S.mobileCard, cursor: 'pointer' }} onClick={() => openProduct(prod.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openProduct(prod.id) } }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display:'flex', alignItems:'flex-start', gap:9 }}>
                        <input type="checkbox" aria-label={`تحديد ${prod.name}`} checked={selectedProducts.has(prod.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSelected(prod.id)} style={{ width:24, height:24, margin:0, flexShrink:0 }} />
                        <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{prod.name}</div>
                        {prod.sku && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'monospace' }}>{prod.sku}</div>}
                        </div>
                      </div>
                      <span style={{ ...S.statusBadge, ...(prod.status === 'active' ? S.badgeActive : S.badgeOff) }}>
                        {prod.status === 'active' ? 'نشط' : prod.status === 'out_of_stock' ? 'نفد' : 'موقوف'}
                      </span>
                    </div>
                    <div style={{ marginBottom:10, fontSize:11, color:readiness?.ready ? 'var(--accent2)' : readiness?.pending ? 'var(--warning-text)' : 'var(--text3)', fontWeight:700 }}>
                      Trendyol: {readiness?.ready ? 'جاهز لتحديث السعر والمخزون' : readiness?.pending ? 'تحديث قيد المعالجة' : readiness?.reason || 'يحتاج استكمال الربط'}
                    </div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
                      <span title={lineage.title} style={{ ...S.statusBadge, ...lineageTone }}>{lineage.label}</span>
                      <span title={quality.missing.length ? `البيانات الناقصة: ${quality.missing.join('، ')}` : 'بيانات المنتج مكتملة'} style={{ ...S.statusBadge, ...qualityTone }}>{quality.label} · {quality.score}%</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                      {PLATFORMS.map(p => (
                        <div key={p} style={{ textAlign: 'center', background: 'var(--bg)', borderRadius: 8, padding: '6px 4px', border: `1px solid ${PLATFORM_COLORS[p]}33` }}>
                          <div style={{ fontSize: 10, color: PLATFORM_COLORS[p], fontWeight: 700 }}>{PLATFORM_NAMES[p]}</div>
                          <div style={{ fontSize: 14, fontWeight: 800 }}>{ps[p]?.toLocaleString() || '—'}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: prod.cost_price > 0 ? (profit > 0 ? 'var(--accent2)' : 'var(--danger-text)') : 'var(--warning-text)' }}>
                        {prod.cost_price > 0 ? `هامش: ${profit > 0 ? '+' : ''}${profit.toLocaleString()} ر.س` : 'الربحية غير مكتملة'}
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ ...S.reqBtn, background: 'rgba(15,149,140,0.1)', color: 'var(--accent)', borderColor: 'rgba(15,149,140,0.25)' }} onClick={e => { e.stopPropagation(); openEdit(prod) }}>تعديل</button>
                        <button style={S.reqBtn} onClick={e => { e.stopPropagation(); openProduct(prod.id) }}>إدارة المنتج</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, width:38 }}><input type="checkbox" aria-label="تحديد المنتجات الجاهزة في الصفحة" checked={pageProducts.some(product => trendyolStateByProduct.get(product.id)?.ready) && pageProducts.filter(product => trendyolStateByProduct.get(product.id)?.ready).every(product => selectedProducts.has(product.id))} onChange={event => toggleReadyPage(event.target.checked)} style={{ width:24, height:24 }} /></th>
                    {['المنتج', 'SKU', 'المصدر', 'اكتمال البيانات', 'التكلفة', 'الصافي المستهدف', ...PLATFORMS.map(p => PLATFORM_NAMES[p]), 'الهامش', 'جاهزية Trendyol', 'الحالة', ''].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageProducts.map(prod => {
                    const ps = getPrices(prod.id)
                    const profit = prod.target_net_price - prod.cost_price
                    const readiness = trendyolStateByProduct.get(prod.id)
                    const quality = productQualityById.get(prod.id)!
                    const lineage = productLineageById.get(prod.id)!
                    const lineageTone = LINEAGE_TONE[lineage.tone]
                    const qualityTone = QUALITY_TONE[quality.tone]
                    return (
                      <tr key={prod.id} tabIndex={0} aria-label={`فتح المنتج ${prod.name}`} style={{ ...S.tr, cursor: 'pointer' }} onClick={() => openProduct(prod.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openProduct(prod.id) } }}>
                        <td style={{ ...S.td, width:38 }}><input type="checkbox" aria-label={`تحديد ${prod.name}`} checked={selectedProducts.has(prod.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSelected(prod.id)} style={{ width:24, height:24 }} /></td>
                        <td style={S.td}>
                          <div style={{ fontWeight: 600 }}>{prod.name}</div>
                          {prod.category && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{prod.category}</div>}
                        </td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>{prod.sku || '—'}</td>
                        <td style={S.td}><span title={lineage.title} style={{ ...S.statusBadge, ...lineageTone, whiteSpace:'nowrap' }}>{lineage.label}</span></td>
                        <td style={S.td}><span title={quality.missing.length ? `البيانات الناقصة: ${quality.missing.join('، ')}` : 'بيانات المنتج مكتملة'} style={{ ...S.statusBadge, ...qualityTone, whiteSpace:'nowrap' }}>{quality.label} · {quality.score}%</span></td>
                        <td style={S.td}>{prod.cost_price > 0 ? prod.cost_price.toLocaleString() + ' ر.س' : '—'}</td>
                        <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent)' }}>{prod.target_net_price.toLocaleString()} ر.س</td>
                        {PLATFORMS.map(p => (
                          <td key={p} style={{ ...S.td, fontWeight: 700, color: PLATFORM_COLORS[p] }}>
                            {ps[p] ? ps[p].toLocaleString() + ' ر.س' : '—'}
                          </td>
                        ))}
                        <td style={{ ...S.td, color: prod.cost_price > 0 ? (profit > 0 ? 'var(--accent2)' : 'var(--red)') : 'var(--warning-text)', fontWeight: 700 }}>
                          {prod.cost_price > 0 ? `${profit > 0 ? '+' : ''}${profit.toLocaleString()} ر.س` : 'غير مكتملة'}
                        </td>
                        <td style={S.td}><span title={readiness?.reason || undefined} style={{ ...S.statusBadge, background:readiness?.ready ? 'var(--success-bg)' : readiness?.pending ? 'var(--warning-bg)' : 'var(--surface2)', color:readiness?.ready ? 'var(--accent2)' : readiness?.pending ? 'var(--warning-text)' : 'var(--text3)', whiteSpace:'nowrap' }}>{readiness?.ready ? 'جاهز' : readiness?.pending ? 'قيد المعالجة' : readiness?.reason || 'غير جاهز'}</span></td>
                        <td style={S.td}>
                          <span style={{ ...S.statusBadge, ...(prod.status === 'active' ? S.badgeActive : S.badgeOff) }}>
                            {prod.status === 'active' ? 'نشط' : prod.status === 'out_of_stock' ? 'نفد' : 'موقوف'}
                          </span>
                        </td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={{ ...S.reqBtn, background: 'rgba(15,149,140,0.1)', color: 'var(--accent)', borderColor: 'rgba(15,149,140,0.25)' }} onClick={e => { e.stopPropagation(); openEdit(prod) }}>تعديل السعر</button>
                            <button style={S.reqBtn} onClick={e => { e.stopPropagation(); openProduct(prod.id) }}>إدارة المنتج</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
        </div>
      )}

      {/* Commission rates info — filtered by category if form is open */}
      {rates.length > 0 && (() => {
        const activeCategory = showAdd && form.category.trim() ? form.category.trim().toLowerCase() : null
        const categoryRates = activeCategory
          ? rates.filter(r => r.category.toLowerCase() === activeCategory)
          : []
        const defaultRates = rates.filter(r => r.category === 'default')
        const displayRates = categoryRates.length > 0 ? categoryRates : defaultRates
        const label = categoryRates.length > 0
          ? `نسب عمولات قسم "${form.category}"`
          : 'نسب العمولات الافتراضية (محدّثة من الفريق)'

        return (
          <div style={S.ratesCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={S.ratesTitle}>{label}</div>
              {categoryRates.length === 0 && showAdd && form.category.trim() && (
                <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '3px 9px', borderRadius: 20 }}>
                  لا يوجد نسب خاصة بهذا القسم — يُستخدم الافتراضي
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
              {displayRates.map(r => (
                <div key={`${r.platform}-${r.category}`} style={{ ...S.rateChip, borderColor: (PLATFORM_COLORS[r.platform] || '#5a5a7a') + '44' }}>
                  <span style={{ fontWeight: 700, color: PLATFORM_COLORS[r.platform] || 'var(--text)' }}>{PLATFORM_NAMES[r.platform] || r.platform}</span>
                  <span style={{ color: 'var(--text2)' }}>{r.rate}% + ضريبة {r.vat_rate}%</span>
                  {r.shipping_fee > 0 && <span style={{ color: 'var(--text3)', fontSize: 11 }}>شحن: {r.shipping_fee} ر.س</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Edit Price Modal */}
      {editProduct && (
        <div style={S.overlay} onClick={() => setEditProduct(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>تعديل أسعار — {editProduct.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: -8 }}>
              {editProduct.category && <span>القسم: {editProduct.category} · </span>}
              SKU: {editProduct.sku || '—'}
            </div>
            <div style={S.field}>
              <label style={S.label}>تكلفة المنتج (ر.س)</label>
              <input style={S.input} type="number" value={editForm.cost_price} onChange={e => setEditForm(f => ({ ...f, cost_price: e.target.value }))} placeholder="سعر الشراء / التصنيع" />
            </div>
            <div style={S.field}>
              <label style={S.label}>السعر الصافي المستهدف * (ما تريد تستلمه بعد رسوم المنصة)</label>
              <input style={{ ...S.input, fontSize: 16, fontWeight: 700 }} type="number" value={editForm.target_net_price} onChange={e => setEditForm(f => ({ ...f, target_net_price: e.target.value }))} placeholder="مثال: 200" />
            </div>
            {editForm.target_net_price && (
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>معاينة الأسعار بعد الحفظ</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {PLATFORMS.map(p => {
                    const rate = getRate(p, editProduct.category || undefined)
                    const price = rate ? calcSellingPrice(parseFloat(editForm.target_net_price) || 0, rate) : 0
                    return (
                      <div key={p} style={{ flex: 1, textAlign: 'center', background: 'var(--surface)', borderRadius: 8, padding: '8px 4px', border: `1px solid ${PLATFORM_COLORS[p]}33` }}>
                        <div style={{ fontSize: 10, color: PLATFORM_COLORS[p], fontWeight: 700 }}>{PLATFORM_NAMES[p]}</div>
                        <div style={{ fontSize: 16, fontWeight: 800 }}>{price.toLocaleString()}</div>
                        <div style={{ fontSize: 9, color: 'var(--text3)' }}>ر.س</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button style={S.saveBtn} onClick={saveEditProduct} disabled={editSaving}>{editSaving ? 'جارٍ الحفظ...' : 'حفظ وإعادة الحساب'}</button>
              <button style={S.cancelBtn} onClick={() => setEditProduct(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {showBulkConfirm && (
        <div style={S.overlay} onClick={() => !bulkSaving && setShowBulkConfirm(false)}>
          <div role="dialog" aria-modal="true" aria-label="مراجعة تحديث منتجات Trendyol" style={{ ...S.modal, maxWidth:620 }} onClick={event => event.stopPropagation()}>
            <div style={S.modalTitle}>مراجعة تحديث Trendyol</div>
            <p style={{ margin:'-5px 0 0', fontSize:12, lineHeight:1.8, color:'var(--text2)' }}>سيتم إرسال سعر البيع والسعر قبل الخصم وكمية المخزون الحالية لـ {selectedRows.length.toLocaleString('ar-SA-u-nu-latn')} منتج. لا يتم تعديل اسم المنتج أو صوره في هذه العملية.</p>
            <div style={{ maxHeight:260, overflowY:'auto', border:'1px solid var(--border)', borderRadius:10 }}>
              {selectedRows.slice(0, 50).map(product => {
                const item = trendyolStateByProduct.get(product.id)?.item
                return <div key={product.id} style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(0,1fr) 90px 110px', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--border)', fontSize:11 }}><strong style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{product.name}</strong><span>المخزون: {item?.quantity.toLocaleString('ar-SA-u-nu-latn')}</span><span>السعر: {item?.salePrice.toFixed(2)} ر.س</span></div>
              })}
              {selectedRows.length > 50 ? <div style={{ padding:10, color:'var(--text3)', fontSize:11 }}>و{(selectedRows.length - 50).toLocaleString('ar-SA-u-nu-latn')} منتج إضافي ضمن الدفعة.</div> : null}
            </div>
            <div style={{ padding:'10px 12px', borderRadius:9, background:'var(--warning-bg)', color:'var(--warning-text)', fontSize:11, lineHeight:1.7 }}>تأكيدك يرسل البيانات مباشرة إلى Trendyol. ستظهر حالة الدفعة في صفحة المنتجات ويمكن تحديثها دون إعادة الإرسال.</div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}><button disabled={bulkSaving} style={S.cancelBtn} onClick={() => setShowBulkConfirm(false)}>العودة</button><button disabled={bulkSaving} style={S.addBtn} onClick={() => void submitBulkPriceInventory()}>{bulkSaving ? 'جارٍ الإرسال…' : 'تأكيد وإرسال الدفعة'}</button></div>
          </div>
        </div>
      )}

      </>)}
      {showCostImport && merchant ? <ProductCostImport merchantCode={merchant.merchant_code} products={products} onClose={() => setShowCostImport(false)} onComplete={() => void loadData({ background: true })} /> : null}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:       { padding: '28px 32px', minHeight: '100vh', maxWidth: 1100, margin: '0 auto' },
  topbar:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  title:      { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  sub:        { fontSize: 13, color: 'var(--text2)', marginTop: 3 },
  addBtn:     { background: 'var(--accent-strong)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  alert:      { padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  formCard:   { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 20 },
  card:       { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px' },
  formTitle:  { fontSize: 15, fontWeight: 700, marginBottom: 16 },
  field:      { display: 'flex', flexDirection: 'column', gap: 6 },
  label:      { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px' },
  input:      { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', width: '100%', fontFamily: 'inherit' },
  preview:    { marginTop: 16, background: 'var(--bg)', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--border)' },
  previewTitle: { fontSize: 12, fontWeight: 700, color: 'var(--text3)' },
  previewCard:  { flex: 1, minWidth: 80, background: 'var(--surface)', border: '1px solid', borderRadius: 10, padding: '10px 14px', textAlign: 'center' },
  saveBtn:    { background: 'var(--accent2)', color: '#111', border: 'none', padding: '10px 22px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  cancelBtn:  { background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 10, fontSize: 13, cursor: 'pointer' },
  search:     { width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', color: 'var(--text)', fontSize: 13, outline: 'none', marginBottom: 16, boxSizing: 'border-box' },
  empty:      { textAlign: 'center', padding: '80px 20px', color: 'var(--text3)' },
  tableCard:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', marginBottom: 20 },
  table:      { width: '100%', borderCollapse: 'collapse' },
  th:         { padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  tr:         { borderBottom: '1px solid var(--border)' },
  td:         { padding: '12px 16px', fontSize: 13, color: 'var(--text)' },
  statusBadge: { padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
  badgeActive: { background: 'var(--success-bg)', color: 'var(--accent2)' },
  badgeOff:    { background: 'var(--surface2)', color: 'var(--text3)' },
  reqBtn:     { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  mobileCard: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  ratesCard:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px' },
  ratesTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text2)' },
  rateChip:   { background: 'var(--bg)', border: '1px solid', borderRadius: 10, padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 },
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal:      { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '24px 28px', width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 },
  modalTitle: { fontSize: 16, fontWeight: 800 },
}


// ─── Profitability Panel ──────────────────────────────────────────────────────
type AmazonBusinessRow = {
  asin: string | null
  product_name: string | null
  snapshot_date: string
  sessions: number | null
  page_views: number | null
  buy_box_percentage: number | null
  unit_session_percentage: number | null
  sold: number | null
  gross_sales: number | null
}
type AmazonInventoryRow = { asin: string | null; quantity: number | null }

function AmazonBusinessFunnelPanel({ merchant }: { merchant: Merchant | null }) {
  const [rows, setRows] = useState<AmazonBusinessRow[]>([])
  const [inventory, setInventory] = useState<AmazonInventoryRow[]>([])
  const [latestDate, setLatestDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      if (!merchant) { setLoading(false); return }
      setLoading(true)
      const { data: latest } = await supabase
        .from('product_performance_snapshots')
        .select('snapshot_date')
        .eq('merchant_code', merchant.merchant_code)
        .eq('platform', 'amazon')
        .not('sessions', 'is', null)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      const date = latest?.snapshot_date || null
      if (!date) {
        if (alive) { setLatestDate(null); setRows([]); setInventory([]); setLoading(false) }
        return
      }
      const [data, inventoryData] = await Promise.all([
        fetchAll<AmazonBusinessRow>((from, to) =>
          supabase.from('product_performance_snapshots')
            .select('asin,product_name,snapshot_date,sessions,page_views,buy_box_percentage,unit_session_percentage,sold,gross_sales')
            .eq('merchant_code', merchant.merchant_code)
            .eq('platform', 'amazon')
            .eq('snapshot_date', date)
            .order('sessions', { ascending: false })
            .range(from, to), 'تقرير أعمال أمازون'),
        fetchAll<AmazonInventoryRow>((from, to) =>
          supabase.from('inventory').select('asin,quantity')
            .eq('merchant_code', merchant.merchant_code)
            .eq('platform', 'amazon')
            .order('sku').range(from, to), 'مخزون أمازون'),
      ])
      if (alive) { setLatestDate(date); setRows(data); setInventory(inventoryData); setLoading(false) }
    }
    load()
    return () => { alive = false }
  }, [merchant])

  const metrics = useMemo(() => {
    const sessions = rows.reduce((a, r) => a + (Number(r.sessions) || 0), 0)
    const pageViews = rows.reduce((a, r) => a + (Number(r.page_views) || 0), 0)
    const units = rows.reduce((a, r) => a + (Number(r.sold) || 0), 0)
    const sales = rows.reduce((a, r) => a + (Number(r.gross_sales) || 0), 0)
    const conversion = sessions > 0 ? units / sessions * 100 : 0
    const buyBox = pageViews > 0
      ? rows.reduce((a, r) => a + (Number(r.buy_box_percentage) || 0) * (Number(r.page_views) || 0), 0) / pageViews
      : 0
    const avgSessions = rows.length ? sessions / rows.length : 0
    const inventoryByAsin = new Map(inventory.filter(row => row.asin).map(row => [row.asin!, Number(row.quantity) || 0]))
    const opportunities = rows.map(row => {
      const rowSessions = Number(row.sessions) || 0
      const rowConversion = Number(row.unit_session_percentage) || 0
      const rowBuyBox = Number(row.buy_box_percentage) || 0
      const stock = row.asin && inventoryByAsin.has(row.asin) ? inventoryByAsin.get(row.asin)! : null
      const missedUnits = Math.max(0, Math.round(rowSessions * Math.max(0, conversion - rowConversion) / 100))
      let action = 'راقب الأداء'
      let score = missedUnits * 8
      if (stock === 0 && rowSessions > 0) { action = 'عاجل: المنتج بلا مخزون ويستقبل زيارات'; score += rowSessions * 3 }
      else if (stock !== null && stock <= 5 && (Number(row.sold) || 0) > 0) { action = 'أعد التوريد قبل نفاد المخزون'; score += rowSessions * 2 }
      else if (rowBuyBox < 95 && rowSessions >= avgSessions) { action = 'استعد Buy Box: راجع السعر والتوفر'; score += (95 - rowBuyBox) * rowSessions / 10 }
      else if (rowSessions >= avgSessions && rowConversion < conversion * 0.7) { action = 'حسّن صفحة المنتج والسعر والتحويل'; score += rowSessions * (conversion - rowConversion) / 10 }
      else if (rowSessions < avgSessions && rowConversion > conversion * 1.25) { action = 'زد الظهور والإعلانات لهذا المنتج'; score += rowConversion * 2 }
      return { ...row, stock, missedUnits, action, score }
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
    return { sessions, pageViews, units, sales, conversion, buyBox, opportunities }
  }, [rows, inventory])

  if (loading) return <div style={{ ...S.card, marginBottom: 16, color: 'var(--text3)', fontSize: 12 }}>جاري تحليل قمع أمازون…</div>

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>قمع أمازون وفرص النمو</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>من الزيارة إلى الوحدة على مستوى ASIN — آخر لقطة {latestDate || 'غير متاحة'}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#ff9900', background: 'rgba(255,153,0,.12)', padding: '5px 10px', borderRadius: 20 }}>Amazon Business Report</span>
      </div>

      {!latestDate ? (
        <div style={{ padding: '18px 16px', borderRadius: 12, background: 'var(--surface2)', color: 'var(--text2)', fontSize: 12, lineHeight: 1.8 }}>
          ارفع «تقرير الأعمال — المبيعات والزيارات حسب المنتج» من Seller Central لإظهار التحويل وBuy Box وفرص المنتجات هنا.
        </div>
      ) : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 16 }}>
          {[
            ['الجلسات', metrics.sessions.toLocaleString(), '#ff9900'],
            ['مشاهدات الصفحة', metrics.pageViews.toLocaleString(), '#0f958c'],
            ['معدل التحويل', `${metrics.conversion.toFixed(2)}%`, '#28c76f'],
            ['Buy Box المرجّح', `${metrics.buyBox.toFixed(2)}%`, '#00b8d9'],
            ['المبيعات', `${metrics.sales.toLocaleString(undefined, { maximumFractionDigits: 2 })} ر.س`, '#f25f5c'],
          ].map(([label, value, color]) => (
            <div key={label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 11, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 5 }}>{label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>أولوية العمل</div>
        {metrics.opportunities.length === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>لا توجد فرص حرجة في اللقطة الحالية.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead><tr>{['المنتج', 'الجلسات', 'التحويل', 'Buy Box', 'الوحدات', 'المخزون', 'المبيعات', 'الإجراء المقترح'].map(h => <th key={h} style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
              <tbody>{metrics.opportunities.map((row, i) => (
                <tr key={row.asin || i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '9px 10px', fontSize: 11, maxWidth: 240 }}><div style={{ fontWeight: 700 }}>{row.product_name || row.asin}</div><div style={{ color: 'var(--text3)', fontFamily: 'monospace', marginTop: 2 }}>{row.asin}</div></td>
                  <td style={{ padding: '9px 10px', fontSize: 11 }}>{(Number(row.sessions) || 0).toLocaleString()}</td>
                  <td style={{ padding: '9px 10px', fontSize: 11 }}>{(Number(row.unit_session_percentage) || 0).toFixed(2)}%</td>
                  <td style={{ padding: '9px 10px', fontSize: 11 }}>{(Number(row.buy_box_percentage) || 0).toFixed(2)}%</td>
                  <td style={{ padding: '9px 10px', fontSize: 11 }}>{Number(row.sold) || 0}</td>
                  <td style={{ padding: '9px 10px', fontSize: 11, color: row.stock === 0 ? 'var(--red)' : 'var(--text)' }}>{row.stock ?? 'غير مربوط'}</td>
                  <td style={{ padding: '9px 10px', fontSize: 11 }}>{(Number(row.gross_sales) || 0).toLocaleString()} ر.س</td>
                  <td style={{ padding: '9px 10px', fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{row.action}{row.missedUnits > 0 ? ` · فرصة تقديرية ${row.missedUnits} وحدة` : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </>)}
    </div>
  )
}

function ProfitabilityPanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])
  async function load() {
    if (!merchant) return
    setLoading(true)
    const { data: rows } = await supabase.from('product_profitability').select('*').eq('merchant_code', merchant.merchant_code)
    setData(rows || [])
    setLoading(false)
  }

  const stats = useMemo(() => {
    const sold = data.filter(r => r.units_sold > 0)
    const totalProfit = sold.reduce((a, r) => a + (Number(r.net_profit) || 0), 0)
    const totalRevenue = sold.reduce((a, r) => a + (Number(r.revenue) || 0), 0)
    const losing = sold.filter(r => Number(r.net_profit) < 0)
    const star = [...sold].filter(r => Number(r.profit_margin_pct) > 30).sort((a, b) => Number(b.net_profit) - Number(a.net_profit)).slice(0, 5)
    const worst = [...sold].sort((a, b) => Number(a.net_profit) - Number(b.net_profit)).slice(0, 5)
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    return { sold, totalProfit, totalRevenue, losing, star, worst, margin }
  }, [data])

  if (loading || stats.sold.length === 0) return null
  const fmt = (v: number) => Math.round(v).toLocaleString('ar-SA') + ' ر.س'
  // إن كانت تكاليف الشراء غير مسجلة فالأرقام «قبل تكلفة البضاعة» — ننبّه بدل عرضها كصافٍ نهائي
  const withCost = data.filter(r => Number(r.cost_price) > 0).length
  const costMissing = data.length > 0 && withCost / data.length < 0.2

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      {costMissing && (
        <div style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)', border: '1px solid var(--warning-bg)', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
          الأرقام أدناه قبل خصم تكلفة البضاعة — أدخل تكلفة الشراء لمنتجاتك ليظهر الصافي الحقيقي.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>ربحية المنتجات</div>
        <button onClick={() => setShow(v => !v)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {show ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
        <PKpi label="منتجات مبيعة" value={stats.sold.length.toString()} sub={`من ${data.length}`} color="#0f958c" />
        <PKpi label="إجمالي الإيرادات" value={fmt(stats.totalRevenue)} color="var(--green)" />
        <PKpi label="صافي الربح" value={fmt(stats.totalProfit)} sub={stats.margin.toFixed(1) + '% هامش'} color={stats.totalProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
        <PKpi label="منتجات خاسرة" value={stats.losing.length.toString()} sub={stats.losing.length > 0 ? 'يحتاج مراجعة' : 'كل المنتجات رابحة'} color={stats.losing.length > 0 ? 'var(--red)' : 'var(--green)'} />
      </div>

      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {/* Star products */}
          {stats.star.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success-text)', marginBottom: 8 }}>منتجات عالية الهامش (&gt; 30%)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.star.map((p, i) => (
                  <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={p.product_name}>{p.product_name}</span>
                    <span style={{ fontWeight: 700, color: 'var(--success-text)' }}>{fmt(Number(p.net_profit))} · {Number(p.profit_margin_pct).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Worst products */}
          {stats.worst.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger-text)', marginBottom: 8 }}>أقل المنتجات ربحًا</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.worst.map((p, i) => (
                  <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={p.product_name}>{p.product_name}</span>
                    <span style={{ fontWeight: 700, color: Number(p.net_profit) < 0 ? 'var(--danger-text)' : 'var(--warning-text)' }}>
                      {fmt(Number(p.net_profit))}{p.profit_margin_pct !== null && ' · ' + Number(p.profit_margin_pct).toFixed(0) + '%'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PKpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ─── Inventory Turnover Card ─────────────────────────────────────────────────
function InventoryTurnoverCard({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    if (!merchant) return
    supabase.rpc('inventory_turnover', { p_merchant_code: merchant.merchant_code, p_days: 90 })
      .then(({ data }) => setData(data))
  }, [merchant])
  if (!data || !data.turnover_ratio) return null
  const fmt = (v: number) => Math.round(v).toLocaleString('ar-SA') + ' ر.س'
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>معدّل دوران المخزون</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div style={kpiBox('#0f958c')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>دوران سنوي</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0f958c' }}>{Number(data.turnover_ratio).toFixed(1)}×</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{Number(data.turnover_ratio) >= 4 ? 'سرعة جيدة' : Number(data.turnover_ratio) >= 2 ? 'متوسط' : 'بطيء'}</div>
        </div>
        <div style={kpiBox('var(--green)')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>الإيرادات (90 يوم)</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--success-text)' }}>{fmt(Number(data.revenue))}</div>
        </div>
        <div style={kpiBox('var(--gold)')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>تكلفة المباع (COGS)</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--warning-text)' }}>{fmt(Number(data.cogs))}</div>
        </div>
        <div style={kpiBox('var(--info-text)')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>قيمة المخزون</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--info-text)' }}>{fmt(Number(data.avg_inv_value))}</div>
        </div>
        <div style={kpiBox('#a598ff')}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>أيام لبيع المخزون</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#a598ff' }}>{data.days_to_sell_all || '—'} يوم</div>
        </div>
      </div>
    </div>
  )
}

// (حُذفت لوحة «اقتراحات التسعير»: كانت تستعلم جدول pricing_suggestions غير الموجود أصلاً
//  فتفشل بصمت ولا تظهر أبداً — تُعاد متى بُني مصدر البيانات فعلياً)

function kpiBox(color: string): React.CSSProperties {
  return { background: 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${color}` }
}

// ─── Brand Performance ────────────────────────────────────────────────────────
function BrandPerformancePanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('brand_performance').select('*').eq('merchant_code', merchant.merchant_code).order('revenue', { ascending: false }).limit(15).then(({ data }) => setData(data || []))
  }, [merchant])
  if (data.length === 0) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>أداء الماركات</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>أداء كل ماركة عبر المنصات</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['الماركة','المنصة','الوحدات المباعة','الإيراد','صافي الإيراد','نسبة الإرجاع'].map(h => (
            <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {data.map((b, i) => {
              const ret = Number(b.return_rate_pct) || 0
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>{b.brand}</td>
                  <td style={{ padding: '8px 12px', color: PLATFORM_COLORS[b.platform] || 'var(--text3)', fontWeight: 600 }}>{PLATFORM_NAMES[b.platform] || b.platform}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--success-text)' }}>{b.units_sold}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{Math.round(Number(b.revenue)).toLocaleString('ar-SA')}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text2)' }}>{Math.round(Number(b.net_revenue)).toLocaleString('ar-SA')}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: ret > 15 ? 'var(--danger-text)' : ret > 5 ? 'var(--warning-text)' : 'var(--text3)' }}>{ret > 0 ? ret + '%' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── SKU Lifecycle ────────────────────────────────────────────────────────────
function SkuLifecyclePanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('sku_lifecycle').select('*').eq('merchant_code', merchant.merchant_code).then(({ data }) => setData(data || []))
  }, [merchant])
  if (data.length === 0) return null
  const counts: any = { launching: 0, new_no_sales: 0, growing: 0, mature: 0, dormant: 0, unknown: 0 }
  for (const d of data) counts[d.lifecycle_stage]++
  const labels: any = { launching: 'إطلاق ناجح', new_no_sales: 'جديد بدون بيع', growing: 'نامي', mature: 'مُنضج', dormant: 'خامل', unknown: 'غير محدّد' }
  const colors: any = { launching: 'var(--green)', new_no_sales: 'var(--warning-text)', growing: '#0f958c', mature: 'var(--info-text)', dormant: 'var(--red)', unknown: '#a598ff' }
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>دورة حياة المنتجات</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>تصنيف منتجاتك حسب العمر والأداء</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {Object.keys(labels).filter(k => counts[k] > 0).map(k => (
          <div key={k} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderTop: `3px solid ${colors[k]}` }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>{labels[k]}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: colors[k] }}>{counts[k]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Variant Performance ──────────────────────────────────────────────────────
function VariantPerformancePanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('variant_performance').select('*').eq('merchant_code', merchant.merchant_code).order('units_sold', { ascending: false }).limit(20).then(({ data }) => setData(data || []))
  }, [merchant])
  if (data.length === 0) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>أداء التشكيلات (لون × مقاس)</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>أيّ تشكيلات تبيع أحسن وأيّها أعلى مرتجعات</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['الماركة','اللون','المقاس','مباع','مرتجع','نسبة الإرجاع','الإيراد'].map(h => (
            <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {data.map((v, i) => {
              const ret = Number(v.return_rate_pct) || 0
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{v.brand}</td>
                  <td style={{ padding: '8px 12px' }}>{v.color}</td>
                  <td style={{ padding: '8px 12px' }}>{v.size}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--success-text)' }}>{v.units_sold}</td>
                  <td style={{ padding: '8px 12px', color: v.units_returned > 0 ? 'var(--danger-text)' : 'var(--text3)' }}>{v.units_returned}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: ret > 15 ? 'var(--danger-text)' : ret > 5 ? 'var(--warning-text)' : 'var(--text3)' }}>{ret > 0 ? ret + '%' : '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{Math.round(Number(v.revenue)).toLocaleString('ar-SA')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Buy Box Warnings ─────────────────────────────────────────────────────────
function BuyBoxWarningsPanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('buybox_warnings').select('*').eq('merchant_code', merchant.merchant_code).order('overprice_pct', { ascending: false }).then(({ data }) => setData(data || []))
  }, [merchant])
  if (data.length === 0) return null
  const losing = data.filter(d => d.buybox_status === 'losing')
  const atRisk = data.filter(d => d.buybox_status === 'at_risk')
  if (losing.length === 0 && atRisk.length === 0) return null

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>تنبيه Buy Box</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>منتجاتك اللي سعرها أعلى من سعر باي بوكس — تخسر الصندوق</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
        <div style={{ background: 'var(--danger-bg)', borderRadius: 10, padding: 12, borderTop: '3px solid var(--red)' }}>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>تخسر الصندوق</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger-text)' }}>{losing.length}</div>
        </div>
        <div style={{ background: 'var(--warning-bg)', borderRadius: 10, padding: 12, borderTop: '3px solid var(--gold)' }}>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>على وشك الخسارة</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning-text)' }}>{atRisk.length}</div>
        </div>
        <div style={{ background: 'var(--success-bg)', borderRadius: 10, padding: 12, borderTop: '3px solid var(--green)' }}>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>تربح الصندوق</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--success-text)' }}>{data.length - losing.length - atRisk.length}</div>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['المنتج','سعرك','سعر باي بوكس','الفرق','الحالة'].map(h => (
            <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {[...losing, ...atRisk].slice(0, 10).map((p, i) => {
              const c = p.buybox_status === 'losing' ? '#e84040' : '#ff9900'
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{Number(p.my_price).toFixed(0)}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text3)' }}>{Number(p.buybox_price).toFixed(0)}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: c }}>+{Number(p.overprice_pct).toFixed(1)}%</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 12, background: c + '20', color: c }}>
                      {p.buybox_status === 'losing' ? 'خاسر' : 'معرض للخطر'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Cross-Platform Performance ───────────────────────────────────────────────
function CrossPlatformPanel({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchant) return
    supabase.from('cross_platform_product_perf').select('*').eq('merchant_code', merchant.merchant_code).order('total_revenue', { ascending: false }).limit(15).then(({ data }) => setData(data || []))
  }, [merchant])
  if (data.length === 0) return null

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}><ArrowRightLeft size={16} color="var(--accent)" /> أين يربح كل منتج؟</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>المنتج على أكثر من منصة — الرابح بالربح لا بالإيراد (رسوم أمازون أعلى من نون)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map((p, i) => {
          const platforms = p.by_platform as Record<string, any>
          const ents = Object.entries(platforms) as [string, any][]
          const bestNet = ents.reduce((a, [k, v]) => (Number(v.net) > a.net ? { platform: k, net: Number(v.net) } : a), { platform: '', net: -Infinity })
          const bestRev = ents.reduce((a, [k, v]) => (Number(v.revenue) > a.rev ? { platform: k, rev: Number(v.revenue) } : a), { platform: '', rev: -Infinity })
          // الإشارة الذهبية: تبيع أكثر على منصة لكن ربحك أعلى على أخرى
          const conflict = bestRev.platform && bestNet.platform && bestRev.platform !== bestNet.platform
          return (
            <div key={i} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 8, alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.product_name}</div>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: (PLATFORM_COLORS[bestNet.platform] || '#0f958c') + '20', color: PLATFORM_COLORS[bestNet.platform] || '#0f958c', fontWeight: 800, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Award size={12} /> أربح على {PLATFORM_NAMES[bestNet.platform] || bestNet.platform}
                </span>
              </div>
              {conflict && (
                <div style={{ fontSize: 11, color: 'var(--warning-text)', background: 'var(--warning-bg)', borderRadius: 7, padding: '5px 9px', marginBottom: 8 }}>
                  تبيع أكثر على {PLATFORM_NAMES[bestRev.platform] || bestRev.platform} لكن ربحك أعلى على {PLATFORM_NAMES[bestNet.platform] || bestNet.platform}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ents.map(([plat, v]) => (
                  <div key={plat} style={{ flex: 1, minWidth: 130, background: 'var(--surface)', borderRadius: 8, padding: 8, borderTop: `2px solid ${PLATFORM_COLORS[plat] || '#0f958c'}` }}>
                    <div style={{ fontSize: 10, color: PLATFORM_COLORS[plat] || 'var(--text3)', fontWeight: 700 }}>{PLATFORM_NAMES[plat] || plat}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3, color: Number(v.net) >= 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>{Math.round(v.net).toLocaleString('ar-SA')} <span style={{ fontSize: 10, color: 'var(--text3)' }}>ربح</span></div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{Math.round(v.revenue).toLocaleString('ar-SA')} مبيعات · {v.margin != null ? v.margin + '% هامش' : v.units + ' وحدة'}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
