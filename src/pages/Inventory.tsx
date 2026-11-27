import SellingAccountChooser from '../components/SellingAccountChooser'
import { useSellingAccountClient, useSelectedSellingAccounts } from '../components/SellingAccountScope'
import { useState, useEffect, useMemo } from 'react'
import { INVENTORY_SAFE_COLUMNS } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import { InfoIcon, Pagination, PageHeader, PageLoading } from '../components/UI'
import type { Merchant, InventoryItem } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import { ClipboardPlus, ShieldAlert } from 'lucide-react'
import { createMerchantAction, dueDateFromNow } from '../lib/merchantActions'
import { toastErr, toastInfo, toastOk } from '../components/Toast'
import { userErrorMessage } from '../lib/userError'
import PurchaseCashReadinessPanel from '../components/PurchaseCashReadinessPanel'
import { fetchAllStrict as fetchAll, withTimeout } from '../lib/db'
import { inventoryEvidence } from '../lib/inventoryEvidence'
import { inventoryDataLineage, inventoryFreshness, type InventoryDataLineage, type InventoryFreshness, type LineageUpload } from '../lib/dataLineage'

const PAGE_SIZE = 25
const LINEAGE_TONE = {
  info: { background:'var(--info-bg)', color:'var(--info-text)' },
  success: { background:'var(--success-bg)', color:'var(--success-text)' },
  warning: { background:'var(--warning-bg)', color:'var(--warning-text)' },
} as const
const FRESHNESS_TONE = {
  success: { background:'var(--success-bg)', color:'var(--success-text)' },
  warning: { background:'var(--warning-bg)', color:'var(--warning-text)' },
  danger: { background:'var(--danger-bg)', color:'var(--danger-text)' },
} as const

export default function Inventory({ merchant }: { merchant: Merchant | null }) {
  const supabase = useSellingAccountClient()
  const selectedAccounts=useSelectedSellingAccounts()

  const linkedFilters = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const stock = params.get('stock')
    return {
      stock: ['all','low','out','stale'].includes(stock || '') ? stock as 'all'|'low'|'out'|'stale' : 'all',
      platform: params.get('platform') || 'all',
      platforms: (params.get('platforms') || '').split(',').filter(Boolean),
    }
  }, [])
  const isMobile = useMobile()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [sourceUploads, setSourceUploads] = useState<Map<string, LineageUpload>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'all' | 'low' | 'out' | 'stale'>(linkedFilters.stock)
  const [platformFilter, setPlatformFilter] = useState(linkedFilters.platform)
  const [sort, setSort] = useState<'attention' | 'name' | 'quantity'>('attention')
  const [editId, setEditId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState(0)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addAccountId,setAddAccountId]=useState('')
  const [addForm, setAddForm] = useState({ sku:'', product_name:'', platform:'warehouse', quantity:0, low_stock_threshold:10, cost_price:0 })
  const [msg, setMsg] = useState<{ type:'ok'|'err'; text:string } | null>(null)

  // The inventory loader is intentionally keyed by the current merchant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (merchant) loadInventory() }, [merchant])

  async function loadInventory() {
    setLoading(true)
    setLoadError('')
    try {
      const [inventoryRows, uploads] = await Promise.all([
        fetchAll<InventoryItem>((from, to) => supabase.from('inventory').select(INVENTORY_SAFE_COLUMNS).eq('merchant_code', merchant!.merchant_code).order('product_name').order('id').range(from, to), 'المخزون'),
        fetchAll<LineageUpload>((from, to) => supabase.from('platform_file_uploads').select('id,platform,file_name,file_type,uploaded_at').eq('merchant_code', merchant!.merchant_code).order('uploaded_at', { ascending:false }).order('id').range(from, to), 'ملفات المخزون'),
      ])
      setItems(inventoryRows)
      setSourceUploads(new Map(uploads.map(upload => [upload.id, upload])))
    } catch (error) {
      console.error('load inventory', error)
      setLoadError(userErrorMessage(error, 'تعذّر تحميل المخزون الآن.'))
    } finally { setLoading(false) }
  }

  const lineageById = useMemo(() => new Map(items.map(item => [item.id, inventoryDataLineage(item, item.upload_id ? sourceUploads.get(item.upload_id) : null)])), [items, sourceUploads])
  const freshnessById = useMemo(() => new Map(items.map(item => [item.id, inventoryFreshness(item.last_updated)])), [items])

  const filtered = useMemo(() => {
    let d = items.filter(i => i.is_active)
    if (search.trim()) {
      const q = search.toLowerCase()
      d = d.filter(i => i.product_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
    }
    if (filter === 'low') d = d.filter(i => i.quantity > 0 && i.quantity <= i.low_stock_threshold)
    if (filter === 'out') d = d.filter(i => Number(i.quantity) - Number(i.reserved_quantity || 0) <= 0)
    if (filter === 'stale') d = d.filter(i => freshnessById.get(i.id)?.status === 'stale' || freshnessById.get(i.id)?.status === 'unknown')
    if (platformFilter !== 'all') d = d.filter(i => i.platform === platformFilter)
    else if (linkedFilters.platforms.length) d = d.filter(i => linkedFilters.platforms.includes(i.platform))
    d = [...d].sort((a, b) => {
      if (sort === 'name') return a.product_name.localeCompare(b.product_name, 'ar')
      if (sort === 'quantity') return b.quantity - a.quantity
      const priority = (item: InventoryItem) => item.quantity === 0 ? 0 : item.quantity <= item.low_stock_threshold ? 1 : 2
      return priority(a) - priority(b) || a.quantity - b.quantity
    })
    return d
  }, [items, search, filter, platformFilter, sort, freshnessById, linkedFilters.platforms])

  // A source SKU is meaningful only within its selling account.
  const bySku = useMemo(() => {
    const map: Record<string, InventoryItem[]> = {}
    for (const item of filtered) {
      const key=JSON.stringify([item.marketplace_account_id,item.platform,item.sku])
      if (!map[key]) map[key] = []
      map[key].push(item)
    }
    return map
  }, [filtered])
  const skuEntries = useMemo(() => Object.entries(bySku), [bySku])
  const pageEntries = useMemo(() => skuEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [skuEntries, page])

  useEffect(() => { setPage(1) }, [search, filter, platformFilter, sort])
  useEffect(() => {
    const last = Math.max(1, Math.ceil(skuEntries.length / PAGE_SIZE))
    if (page > last) setPage(last)
  }, [skuEntries.length, page])

  const stats = useMemo(() => ({
    total:    items.filter(i => i.is_active).length,
    low:      items.filter(i => i.is_active && i.quantity > 0 && i.quantity <= i.low_stock_threshold).length,
    out:      items.filter(i => i.is_active && i.quantity === 0).length,
    skus:     new Set(items.filter(i=>i.is_active).map(i=>JSON.stringify([i.marketplace_account_id,i.sku]))).size,
    units:    items.filter(i => i.is_active).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    stale:    items.filter(i => i.is_active && ['stale','unknown'].includes(freshnessById.get(i.id)?.status || '')).length,
  }), [items, freshnessById])
  const platforms = useMemo(() => [...new Set(items.filter(i => i.is_active).map(i => i.platform))], [items])

  async function updateQty(id: string) {
    if (!merchant) return
    setSaving(true)
    const { error } = await supabase
      .from('inventory')
      .update({ quantity: editQty, last_updated: new Date().toISOString(), platform_source: 'manual_override' })
      .eq('id', id)
      .eq('merchant_code', merchant.merchant_code)
    setSaving(false)
    if (error) {
      console.error('update inventory quantity', error)
      setMsg({ type:'err', text:userErrorMessage(error, 'تعذّر حفظ الكمية. لم يتم تغيير المخزون.') })
      return
    }
    setMsg({ type:'ok', text:'تم حفظ الكمية وتسجيلها كتعديل يدوي.' })
    setEditId(null)
    void loadInventory()
  }

  async function addItem() {
    if (!addForm.sku.trim() || !addForm.product_name.trim()) {
      setMsg({ type:'err', text:'SKU واسم المنتج مطلوبان' }); return
    }
    if(!selectedAccounts.some(account=>account.id===addAccountId)){setMsg({type:'err',text:'اختر الحساب الذي يخصه هذا الرصيد'});return}
    setSaving(true)
    const { error } = await supabase.from('inventory').insert({
      merchant_code: merchant!.merchant_code,
      marketplace_account_id:addAccountId,
      sku:              addForm.sku.trim(),
      product_name:     addForm.product_name.trim(),
      platform:         addForm.platform,
      quantity:         Number(addForm.quantity),
      low_stock_threshold: Number(addForm.low_stock_threshold),
      cost_price:       Number(addForm.cost_price),
      platform_source:  'manual',
    })
    setSaving(false)
    if (error) {
      console.error('create inventory item', error)
      setMsg({ type:'err', text: error.message.includes('unique') ? 'هذا المنتج موجود مسبقاً على هذه المنصة' : userErrorMessage(error, 'تعذّر إضافة المنتج إلى المخزون.') })
    } else {
      setMsg({ type:'ok', text:'تمت إضافة المنتج' })
      setAddForm({ sku:'', product_name:'', platform:'warehouse', quantity:0, low_stock_threshold:10, cost_price:0 })
      setShowAdd(false)
      loadInventory()
    }
  }

  if (loading) return <PageLoading title="المخزون" />

  if (loadError) return (
    <div className="merchant-page">
      <PageHeader title="المخزون" />
      <div style={{ maxWidth:520, margin:'70px auto', padding:24, textAlign:'center', border:'1px solid var(--border)', borderRadius:12, background:'var(--surface)' }}>
        <h2 style={{ margin:'0 0 8px', fontSize:18 }}>تعذّر تحميل المخزون</h2>
        <p style={{ margin:'0 0 18px', color:'var(--text2)', fontSize:13, lineHeight:1.8 }}>{loadError}</p>
        <button onClick={() => void loadInventory()} style={S.addBtn}>إعادة المحاولة</button>
      </div>
    </div>
  )

  function goProducts() {
    window.history.pushState(null, '', '/products')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  function goQuickInventory() {
    window.history.pushState(null, '', '/quick-inventory')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  function goIntegrations() {
    window.history.pushState(null, '', '/integrations')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <div className="merchant-page">
      {/* Page Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        <button onClick={goProducts} style={{ background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -2, padding: '8px 20px', fontSize: 14, fontWeight: 500, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit' }}>
          كتالوج المنتجات
        </button>
        <button style={{ background: 'none', border: 'none', borderBottom: '2px solid var(--accent)', marginBottom: -2, padding: '8px 20px', fontSize: 14, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
          المخزون
        </button>
      </div>

      {/* TOPBAR */}
      <PageHeader title="المخزون" description="راقب الكميات حسب المنصة، عالج النواقص، وحدّث عدة منتجات بسرعة."
        action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...S.addBtn, background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--accent)', boxShadow: 'none' }} onClick={goQuickInventory}>
            تحديث كميات متعددة
          </button>
          <button style={S.addBtn} onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'إلغاء' : 'إضافة منتج'}
          </button>
        </div>} />

      {/* ALERT CARDS */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap:14, marginBottom:20 }}>
        {[
          { label:'المنتجات الفريدة', value:stats.skus,  icon:'', color:'var(--accent)' },
          { label:'الأرصدة المسجلة في القنوات', value:stats.units, icon:'', color:'#4cc9f0'     },
          { label:'مخزون منخفض',     value:stats.low,   icon:'', color:'#ffd166',     active: filter==='low', onClick:()=>setFilter(filter==='low'?'all':'low') },
          { label:'نفد المخزون',      value:stats.out,   icon:'', color:'#ff4d6d',     active: filter==='out', onClick:()=>setFilter(filter==='out'?'all':'out') },
          { label:'بيانات كمية قديمة', value:stats.stale, icon:'', color:'var(--danger-text)', active:filter==='stale', onClick:()=>setFilter(filter==='stale'?'all':'stale') },
        ].map((k,i) => (
          <div
            key={i}
            style={{ ...S.statCard, ...(k.active ? { borderColor:k.color, background:k.color+'11' } : {}), cursor:k.onClick?'pointer':'default' }}
            onClick={k.onClick}
          >
            <div style={{ fontSize:22, marginBottom:8 }}>{k.icon}</div>
            <div style={{ fontSize:24, fontWeight:800, color:k.color }}>{k.value}</div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {stats.stale > 0 ? <section role="status" style={{ background:'var(--danger-bg)', border:'1px solid color-mix(in srgb,var(--danger-text) 22%,transparent)', borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div><strong style={{ display:'block', fontSize:13 }}>لا تعتمد قرار شراء على {stats.stale.toLocaleString('ar-SA-u-nu-latn')} سجل قديم</strong><span style={{ fontSize:11, color:'var(--text2)', lineHeight:1.7 }}>حدّث الربط أو ارفع أحدث ملف مخزون أولًا، ثم راجع توصيات إعادة الشراء.</span></div>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}><button type="button" onClick={() => setFilter('stale')} style={S.miniBtn}>عرض السجلات القديمة</button><button type="button" onClick={goIntegrations} style={{ ...S.miniBtn, background:'var(--accent-strong)', color:'#fff' }}>تحديث مصادر البيانات</button></div>
      </section> : null}

      {/* MESSAGE */}
      {msg && (
        <div style={{ ...S.msgBox, ...(msg.type==='err' ? S.msgErr : S.msgOk), marginBottom:16 }}>
          {msg.text}
          <button style={{ background:'transparent', border:'none', color:'inherit', cursor:'pointer', marginRight:10 }} onClick={() => setMsg(null)} aria-label="إغلاق">×</button>
        </div>
      )}

      {/* ADD FORM */}
      {showAdd && (
        <div style={{ ...S.card, padding:24, marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>إضافة منتج للمخزون</div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(3,1fr)', gap:12, marginBottom:14 }}>
            {[
              { key:'sku',           label:'SKU',           placeholder:'PROD-001',    type:'text'   },
              { key:'product_name',  label:'اسم المنتج',    placeholder:'قميص قطن أبيض',type:'text'  },
              { key:'quantity',      label:'الكمية',        placeholder:'0',           type:'number' },
              { key:'low_stock_threshold', label:'حد التنبيه', placeholder:'10',      type:'number' },
              { key:'cost_price',    label:'سعر التكلفة',   placeholder:'0.00',        type:'number' },
            ].map(f => (
              <div key={f.key}>
                <label style={S.label}>{f.label}</label>
                <input
                  style={S.input}
                  type={f.type}
                  placeholder={f.placeholder}
                  value={(addForm as any)[f.key]}
                  onChange={e => setAddForm({ ...addForm, [f.key]: e.target.value })}
                />
              </div>
            ))}
            <div>
              <label style={S.label}>المنصة</label>
              <select style={S.input} value={addForm.platform} onChange={e => setAddForm({ ...addForm, platform:e.target.value })}>
                {Object.entries(PLATFORM_MAP).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          {merchant && <SellingAccountChooser key={addForm.platform} merchantCode={merchant.merchant_code} platform={addForm.platform} includeLegacy value={addAccountId} onChange={account=>setAddAccountId(account?.id||'')} helpText="اختر الحساب الذي يخصه هذا الرصيد. لإدارة مخزون مشترك استخدم مصادر المخزون في دليل المنتجات."/>}
          <button style={S.saveBtn} onClick={addItem} disabled={saving}>
            {saving ? 'جارٍ الحفظ...' : 'إضافة'}
          </button>
        </div>
      )}

      {/* FILTERS */}
      <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center', flexWrap: 'wrap' }}>
        <input
          style={{ ...S.input, flex:1, maxWidth:320 }}
          placeholder="ابحث بالاسم أو SKU..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display:'flex', gap:6 }}>
          {[['all','الكل'],['low','منخفض'],['out','نفذ'],['stale','بيانات قديمة']] .map(([k,l]) => (
            <button key={k} style={{ ...S.pill, ...(filter===k ? S.pillActive : {}) }} onClick={() => setFilter(k as any)}>{l}</button>
          ))}
        </div>
        <select aria-label="تصفية المخزون حسب المنصة" style={{ ...S.input, width: 'auto', minWidth: 150 }} value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}>
          <option value="all">كل المنصات</option>
          {platforms.map(p => <option key={p} value={p}>{PLATFORM_MAP[p] || p}</option>)}
        </select>
        <select aria-label="ترتيب قائمة المخزون" style={{ ...S.input, width: 'auto', minWidth: 160 }} value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
          <option value="attention">الأكثر حاجة للإجراء</option>
          <option value="name">الاسم أبجديًا</option>
          <option value="quantity">الأعلى كمية</option>
        </select>
        <span style={S.badge}>{filtered.length} سجل</span>
      </div>

      <p style={{fontSize:12,color:"var(--text2)",lineHeight:1.8}}>هذه أرصدة القنوات النشطة، وقد تعرض قناتان الوحدات الفعلية نفسها. الإجمالي الفعلي بعد توحيد المصادر متاح في دليل المنتجات؛ لا تستخدم جمع أرصدة القنوات كتوصية شراء.</p>
      {/* PRODUCTS GROUPED BY SKU */}
      {Object.keys(bySku).length === 0 ? (
        <div style={{ ...S.card, padding:60, textAlign:'center', color:'var(--text3)', fontSize:14 }}>
          {filter !== 'all' ? 'لا توجد منتجات في هذه الفئة' : 'لا يوجد مخزون — أضف منتجاتك'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {pageEntries.map(([sourceKey, skuItems]) => {
            const sku=skuItems[0].sku
            const totalQty = skuItems.reduce((s,i) => s + i.quantity, 0)
            const isLow    = skuItems.some(i => i.quantity > 0 && i.quantity <= i.low_stock_threshold)
            const isOut    = skuItems.every(i => i.quantity === 0)
            return (
              <div key={sourceKey} style={{ ...S.card, borderRight:isOut ? '3px solid var(--red)' : isLow ? '3px solid var(--gold)' : '3px solid transparent' }}>
                {/* SKU Header */}
                <div style={{ padding: isMobile ? '12px' : '14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                    <div aria-hidden="true" style={{ width:44, height:44, borderRadius:10, background:'var(--surface2)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'var(--accent)', flexShrink:0 }}>
                      {skuItems[0].product_name?.trim()?.[0] || 'P'}
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:15 }}>{skuItems[0].product_name}</div>
                      <div style={{ fontSize:11, fontFamily:'monospace', color:'var(--accent)', marginTop:2 }}>{sku} · {selectedAccounts.find(account=>account.id===skuItems[0].marketplace_account_id)?.label}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:22, fontWeight:800, color: isOut?'var(--danger-text)' : isLow?'var(--warning-text)' : 'var(--accent2)' }}>
                        {totalQty.toLocaleString('ar-SA-u-nu-latn')}
                      </div>
                      <div style={{ fontSize:10, color:'var(--text3)' }}>إجمالي</div>
                    </div>
                    {(isLow || isOut) && (
                      <span style={{ fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:20, background:isOut?'var(--danger-bg)':'var(--warning-bg)', color:isOut?'var(--danger-text)':'var(--warning-text)' }}>
                        {isOut ? 'نفد المخزون' : 'مخزون منخفض'}
                      </span>
                    )}
                  </div>
                </div>
                {/* Platform rows */}
                <div>
                  {skuItems.map(item => (
                    <InventoryPlatformRow key={item.id} item={item} isMobile={isMobile} editId={editId} editQty={editQty} saving={saving} lineage={lineageById.get(item.id)!} freshness={freshnessById.get(item.id)!} onEditQty={setEditQty} onStartEdit={() => { setEditId(item.id); setEditQty(item.quantity) }} onCancelEdit={() => setEditId(null)} onSave={() => void updateQty(item.id)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={skuEntries.length} onPage={setPage} />

      {/* لوحات تحليلية أسفل القائمة (كانت تدفن مهمة الصفحة الأساسية: عرض/تعديل الكميات) */}
      <div style={{ marginTop: 28 }}>
        <PurchaseCashReadinessPanel />
        <ReorderRecommendationsPanel merchant={merchant} />
        <InventoryHealthPanel merchant={merchant} />
        {merchant && <InventoryAgeingSection merchantCode={merchant.merchant_code} />}
        {merchant && <InventoryPipelinePanel merchantCode={merchant.merchant_code} />}
      </div>
    </div>
  )
}

function InventoryPlatformRow({
  item, isMobile, editId, editQty, saving, lineage, freshness,
  onEditQty, onStartEdit, onCancelEdit, onSave,
}: {
  item: InventoryItem
  isMobile: boolean
  editId: string | null
  editQty: number
  saving: boolean
  lineage: InventoryDataLineage
  freshness: InventoryFreshness
  onEditQty: (quantity: number) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
}) {
  const sourceTone = LINEAGE_TONE[lineage.tone]
  const freshnessTone = FRESHNESS_TONE[freshness.tone]
  return (
    <div style={{ padding:isMobile ? '12px' : '12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:isMobile ? 'wrap' : 'nowrap', borderBottom:'1px solid var(--border)', background:item.quantity === 0 ? 'var(--danger-bg)' : item.quantity <= item.low_stock_threshold ? 'var(--warning-bg)' : 'transparent' }}>
      <div style={{ display:'flex', alignItems:'center', gap:14, flex:'1 1 300px', minWidth:0, flexWrap:isMobile ? 'wrap' : 'nowrap' }}>
        <span style={{ fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:6, background:(PLATFORM_COLORS[item.platform] || '#5a5a7a') + '22', color:PLATFORM_COLORS[item.platform] || 'var(--text3)', minWidth:70, textAlign:'center' }}>{PLATFORM_MAP[item.platform] || item.platform}</span>
        <div style={{ minWidth:0 }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:5 }}>
            <span title={lineage.title} style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:14, ...sourceTone }}>{lineage.label}</span>
            <span title={item.last_updated ? new Date(item.last_updated).toLocaleString('ar-SA-u-ca-gregory-nu-latn') : undefined} style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:14, ...freshnessTone }}>{freshness.label}</span>
          </div>
          <div style={{ display:'flex', gap:isMobile ? 8 : 24, fontSize:12, color:'var(--text2)', flexWrap:'wrap' }}>
            <span>حد التنبيه: <strong style={{ color:'var(--text)' }}>{item.low_stock_threshold}</strong></span>
            {item.cost_price ? <span>التكلفة: <strong style={{ color:'var(--text)' }}>{item.cost_price} ر.س</strong></span> : null}
            {item.reserved_quantity > 0 ? <span>محجوز: <strong style={{ color:'var(--warning-text)' }}>{item.reserved_quantity}</strong></span> : null}
            {lineage.fileName ? <span title={lineage.fileName}>الملف: <strong dir="ltr" style={{ color:'var(--text)' }}>{lineage.fileName}</strong></span> : null}
          </div>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        {editId === item.id ? <>
          <input aria-label={`الكمية الجديدة لـ ${item.product_name}`} style={{ ...S.input, width:80, textAlign:'center', padding:'6px 8px' }} type="number" value={editQty} onChange={event => onEditQty(Number(event.target.value))} min={0} />
          <button style={{ ...S.miniBtn, background:'var(--accent-strong)', color:'#fff' }} onClick={onSave} disabled={saving}>{saving ? '...' : 'حفظ'}</button>
          <button style={S.miniBtn} onClick={onCancelEdit}>إلغاء</button>
        </> : <>
          <span style={{ fontSize:20, fontWeight:800, color:item.quantity === 0 ? 'var(--danger-text)' : item.quantity <= item.low_stock_threshold ? 'var(--warning-text)' : 'var(--text)', minWidth:40, textAlign:'center' }}>{item.quantity.toLocaleString('ar-SA-u-nu-latn')}</span>
          <button style={S.miniBtn} onClick={onStartEdit}>تعديل</button>
        </>}
      </div>
    </div>
  )
}

type ReorderRecommendation = {
  inventory_id: string; platform: string; sku: string; product_name: string | null
  current_quantity: number; daily_velocity: number; days_of_stock: number | null
  recommended_quantity: number; estimated_cost: number; urgency: 'critical' | 'high' | 'medium'
  data_as_of: string; data_age_days: number
}

function ReorderRecommendationsPanel({merchant}:{merchant:Merchant|null}) {
  const accounts=useSelectedSellingAccounts()
  if(accounts.length!==1)return <p role="status" style={{fontSize:12,lineHeight:1.8,color:'var(--text2)'}}>اختر حساب بيع واحدًا لمراجعة احتياجه. توصيات القنوات لا تُجمع تلقائيًا؛ فقد تشترك في المخزون نفسه.</p>
  return <SingleAccountReorderRecommendations merchant={merchant}/>
}
function SingleAccountReorderRecommendations({ merchant }: { merchant: Merchant | null }) {
  const supabase = useSellingAccountClient()

  const [rows, setRows] = useState<ReorderRecommendation[]>([])
  const [gate,setGate]=useState<'ready'|'stale'|'costs'|'insufficient'|'empty'|'loading'|'error'>('loading')
  const [reload,setReload]=useState(0)
  const [coverage,setCoverage]=useState({observed:0,total:0})
  const [tracking, setTracking] = useState<string | null>(null)

  useEffect(() => {
    if (!merchant?.merchant_code) return
    let alive = true
    const controller=new AbortController()
    setGate('loading')
    withTimeout(Promise.all([
      supabase.from('inventory_reorder_recommendations').select('*').eq('merchant_code', merchant.merchant_code).order('urgency').order('days_of_stock').limit(20).abortSignal(controller.signal),
      fetchAll<any>((f,t)=>supabase.from('inventory_health').select('data_age_days,cost_price,daily_velocity,quantity').eq('merchant_code',merchant.merchant_code).order('id').range(f,t).abortSignal(controller.signal)),
    ]),20_000).then(([recommendations, health]) => {
      if (!alive) return
      if(recommendations.error)throw recommendations.error
      const nextRows=(recommendations.data||[]) as ReorderRecommendation[]
      const healthRows=health
      setRows(nextRows)
      const evidence=inventoryEvidence(healthRows)
      setCoverage({observed:evidence.observed,total:evidence.total})
      setGate(nextRows.length ? 'ready' : evidence.purchaseGate)
    }).catch(()=>{if(alive){setRows([]);setGate('error')}}).finally(()=>controller.abort())
    return () => { alive = false;controller.abort() }
  }, [merchant?.merchant_code,supabase,reload])

  const totalCost = useMemo(() => rows.reduce((sum, row) => sum + Number(row.estimated_cost || 0), 0), [rows])

  async function track(row: ReorderRecommendation) {
    setTracking(row.inventory_id)
    try {
      const result = await createMerchantAction({
        sourceKey: `reorder:${row.inventory_id}:${row.data_as_of}`,
        title: `مراجعة شراء ${row.recommended_quantity} وحدة من ${row.product_name || row.sku}`,
        category: 'inventory', priority: row.urgency === 'critical' ? 'urgent' : 'high',
        note: `المخزون الحالي ${row.current_quantity} وحدة، والتغطية ${row.days_of_stock ?? 0} يومًا وفق آخر حركة بيع متاحة.`,
        expectedImpact: 'تغطية مبيعات 30 يومًا',
        details: { source: 'reorder_recommendation', inventory_id: row.inventory_id, platform: row.platform, sku: row.sku, recommended_quantity: row.recommended_quantity, estimated_cost: row.estimated_cost, data_as_of: row.data_as_of },
        dueDate: dueDateFromNow(row.urgency === 'critical' ? 2 : 4),
      })
      if (result.created) toastOk('أُضيفت توصية الشراء إلى خطة العمل')
      else toastInfo('توصية الشراء موجودة بالفعل في خطة العمل')
    } catch {
      toastErr('تعذر إضافة توصية الشراء إلى خطة العمل')
    } finally {
      setTracking(null)
    }
  }

  if(!merchant)return null
  if(gate==='loading')return <p role="status">جارٍ فحص اكتمال بيانات الشراء…</p>
  if(gate==='error')return <p role="alert">تعذر تحميل توصيات الشراء <button onClick={()=>setReload(n=>n+1)}>إعادة المحاولة</button></p>
  if (!rows.length) {
    const content = gate === 'insufficient'
      ? ['بيانات البيع غير كافية لتوصية شراء', `تغطية حركة البيع ${coverage.observed} من ${coverage.total} صنف. غياب الحركة لا يعني عدم الحاجة للشراء؛ استكمل بيانات الحساب قبل القرار.`]
      : gate === 'stale'
      ? ['توصيات الشراء متوقفة مؤقتًا', 'بيانات حركة البيع أقدم من يومين. حدّث الطلبات والمخزون قبل إصدار قرار شراء.']
      : gate === 'costs'
        ? ['التكلفة مطلوبة قبل التوصية', 'أكمل تكاليف المنتجات حتى نحسب كمية الشراء والالتزام النقدي بدقة.']
        : ['لا توجد حاجة شراء عاجلة', 'لا توجد أصناف ببيانات حديثة تقل تغطيتها عن 14 يومًا.']
    return <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 38, height: 38, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: gate !== 'empty' ? 'var(--warning-bg)' : 'var(--success-bg)', color: gate !== 'empty' ? 'var(--warning-text)' : 'var(--success-text)' }}><ShieldAlert size={19} /></span><div><strong style={{ fontSize: 13 }}>{content[0]}</strong><p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--text3)' }}>{content[1]}</p></div></section>
  }

  return <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 13, flexWrap: 'wrap' }}><div><strong style={{ fontSize: 14 }}>توصيات إعادة الشراء</strong><p style={{ fontSize: 10, color: 'var(--text3)', margin: '4px 0 0' }}>كمية تغطي 30 يومًا، محسوبة فقط من بيانات لا يتجاوز عمرها يومين ومن تكلفة منتج معروفة. تغطية حركة البيع {coverage.observed} من {coverage.total} صنف؛ التوصيات لا تحسم احتياج الأصناف غير المغطاة.</p></div><div style={{ textAlign: 'left' }}><small style={{ display: 'block', fontSize: 9, color: 'var(--text3)' }}>الالتزام النقدي التقديري</small><strong style={{ fontSize: 17 }}>{totalCost.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</strong></div></div>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['المنتج', 'المنصة', 'المخزون', 'تغطية', 'الكمية المقترحة', 'التكلفة التقديرية', 'الإجراء'].map(label => <th key={label} style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--text3)', fontSize: 9, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.inventory_id} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '10px', minWidth: 170 }}><strong>{row.product_name || row.sku}</strong><small style={{ display: 'block', color: 'var(--text3)', marginTop: 2 }}>{row.sku}</small></td><td style={{ padding: '10px' }}>{PLATFORM_MAP[row.platform] || row.platform}</td><td style={{ padding: '10px' }}>{row.current_quantity}</td><td style={{ padding: '10px', color: row.urgency === 'critical' ? 'var(--danger-text)' : 'var(--warning-text)', fontWeight: 750 }}>{row.days_of_stock ?? 0} يوم</td><td style={{ padding: '10px', fontWeight: 800 }}>{row.recommended_quantity}</td><td style={{ padding: '10px' }}>{Number(row.estimated_cost).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</td><td style={{ padding: '10px' }}><button disabled={tracking === row.inventory_id} onClick={() => void track(row)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', padding: '7px 9px', borderRadius: 6, fontFamily: 'inherit', fontSize: 9, fontWeight: 750, cursor: 'pointer', whiteSpace: 'nowrap' }}><ClipboardPlus size={13} />{tracking === row.inventory_id ? 'جارٍ الإضافة' : 'إضافة للخطة'}</button></td></tr>)}</tbody></table></div>
  </section>
}

const S: Record<string, React.CSSProperties> = {
  addBtn:    { background:'linear-gradient(135deg,var(--accent),#55bdb5)', border:'none', color:'#fff', padding:'10px 20px', borderRadius:10, fontSize:13, fontWeight:700, boxShadow:'0 4px 16px rgba(15,149,140,0.3)', cursor:'pointer' },
  statCard:  { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'18px 20px', cursor:'default', transition:'all 0.2s' },
  card:      { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' },
  label:     { display:'block', fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:5, textTransform:'uppercase' as const, letterSpacing:'0.5px' },
  input:     { width:'100%', padding:'9px 12px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:9, color:'var(--text)', fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' as const },
  saveBtn:   { background:'var(--accent-strong)', border:'none', color:'#fff', padding:'10px 24px', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer' },
  miniBtn:   { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'5px 12px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' },
  pill:      { padding:'6px 14px', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text2)', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer' },
  pillActive:{ background:'var(--accent-strong)', borderColor:'var(--accent)', color:'#fff' },
  badge:     { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text2)', fontSize:11, padding:'3px 10px', borderRadius:20, fontFamily:'monospace' },
  msgBox:    { borderRadius:10, padding:'12px 16px', fontSize:13, display:'flex', alignItems:'center', justifyContent:'space-between' },
  msgOk:     { background:'var(--success-bg)', border:'1px solid var(--success-bg)', color:'var(--green)' },
  msgErr:    { background:'var(--danger-bg)', border:'1px solid var(--danger-bg)', color:'var(--red)' },
}

// ─── Inventory Health Panel ──────────────────────────────────────────────────
function InventoryHealthPanel({ merchant }: { merchant: Merchant | null }) {
  const {data,loading,error,retry}=useInventoryAnalysisRows('inventory_health',merchant?.merchant_code)

  const stats = useMemo(() => {
    const evidence=inventoryEvidence(data)
    const sumCost=evidence.costValue
    const sumRetail=evidence.retailValue
    const reorder   = data.filter(r => r.health_status === 'reorder_soon').length
    const slow      = data.filter(r => r.health_status === 'slow_mover').length
    const out       = data.filter(r => r.health_status === 'out_of_stock').length
    const velocityRows = data.filter(r => Number(r.sold_30d) > 0).length
    const velocityCoverage = data.length ? velocityRows / data.length * 100 : 0
    const dataAgeDays = data.reduce((oldest, row) => row.data_age_days == null ? oldest : Math.max(oldest, Number(row.data_age_days)), 0)
    const stockoutCost = data
      .filter(r => r.health_status === 'out_of_stock' && Number(r.daily_velocity) > 0)
      .reduce((a, r) => a + (Number(r.daily_velocity) * Number(r.selling_price || 0) * 30), 0)
    return { sumCost, sumRetail, reorder, slow, out, stockoutCost:evidence.observed<data.length?null:stockoutCost, velocityRows, velocityCoverage, dataAgeDays,costed:evidence.costed,costCoverage:evidence.costCoverage,observed:evidence.observed }
  }, [data])

  const reorderList = useMemo(() => data.filter(r => r.health_status === 'reorder_soon')
    .sort((a, b) => Number(a.days_of_stock) - Number(b.days_of_stock)).slice(0, 6), [data])
  const slowList = useMemo(() => data.filter(r => r.health_status === 'slow_mover' && Number(r.stock_value_cost) > 0)
    .sort((a, b) => Number(b.stock_value_cost) - Number(a.stock_value_cost)).slice(0, 6), [data])

  if(loading)return <p role="status">جارٍ تحميل صحة المخزون…</p>
  if(error)return <p role="alert">تعذر تحميل صحة المخزون <button onClick={retry}>إعادة المحاولة</button></p>
  if(!data.length)return null
  const fmt = (v: number|null) => v===null?'غير متاح':Math.round(v).toLocaleString('ar-SA-u-nu-latn') + ' ر.س'

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}><div><div style={{ fontSize: 14, fontWeight: 800 }}>صحة المخزون</div><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>سرعة البيع محسوبة من آخر نافذة طلبات متاحة لكل منصة.</div></div><div style={{ fontSize: 11, fontWeight: 700, color: stats.observed<data.length || stats.dataAgeDays > 2 ? 'var(--warning-text)' : 'var(--accent)', background: stats.observed<data.length || stats.dataAgeDays > 2 ? 'var(--warning-bg)' : 'var(--success-bg)', padding: '5px 10px', borderRadius: 7 }}>{stats.observed<data.length ? 'تغطية حركة البيع غير مكتملة' : stats.dataAgeDays > 2 ? `البيانات متأخرة ${stats.dataAgeDays} يومًا` : 'البيانات حديثة'}</div></div>

      {stats.dataAgeDays > 2 ? <div style={{ padding: '10px 12px', marginBottom: 14, borderRadius: 9, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 11, lineHeight: 1.8 }}>مؤشرات السرعة وإعادة الطلب تاريخية حتى تتم مزامنة الطلبات والمخزون من صفحة الربط ورفع الملفات. لا تعتمد أمر شراء جديد قبل التحديث.</div> : null}

      {/* Value KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <HKpi label="قيمة المخزون (تكلفة)" value={fmt(stats.sumCost)} sub={`تغطية التكلفة ${stats.costCoverage.toFixed(0)}% · ${stats.costed} من ${data.length} سجل`} color="#0f958c" />
        <HKpi label="قيمة المخزون (بيع)" value={fmt(stats.sumRetail)} color="var(--green)" />
        <HKpi label="تغطية حركة البيع" value={stats.velocityCoverage.toFixed(0) + '%'} sub={`${stats.velocityRows} من ${data.length} صنف`} color="var(--info-text)" />
        <HKpi label="مبيعات معرضة بسبب النفاد" value={fmt(stats.stockoutCost)} sub={stats.observed<data.length ? 'حركة البيع غير كافية للتقدير' : stats.dataAgeDays > 2 ? 'تقدير تاريخي · حدّث البيانات' : 'تقدير 30 يومًا'} color="var(--red)" />
      </div>

      {/* Status counts */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, fontSize: 12 }}>
        <span style={pill('#e84040')}>نفد: <b>{stats.out}</b></span>
        <span style={pill('#ff9900')}>إعادة طلب قريبة: <b>{stats.reorder}</b></span>
        <span style={pill('#a598ff')}>بطيء الحركة (30+ يوم): <b>{stats.slow}</b></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Reorder soon */}
        {reorderList.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning-text)', marginBottom: 8 }}>إعادة طلب قريبة</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {reorderList.map((r, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={r.product_name}>{r.product_name}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>{r.quantity} قطعة</span>
                    <span style={{ fontWeight: 700, color: 'var(--warning-text)' }}>{r.days_of_stock} يوم</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Slow movers */}
        {slowList.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a598ff', marginBottom: 8 }}>منتجات بطيئة الحركة (رأس مال مجمّد)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {slowList.map((r, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={r.product_name}>{r.product_name}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>{r.quantity}×</span>
                    <span style={{ fontWeight: 700, color: '#a598ff' }}>{fmt(Number(r.stock_value_cost))}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function HKpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  const displayColor=value==='غير متاح'?'var(--text2)':color
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${displayColor}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color:displayColor }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function pill(color: string): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 20,
    background: color + '15', color, border: `1px solid ${color}30`,
    fontWeight: 600,
  }
}

// ─── Inventory Ageing Section ─────────────────────────────────────────────────
function InventoryAgeingSection({ merchantCode }: { merchantCode: string }) {
  const {data,loading,error,retry}=useInventoryAnalysisRows('inventory_ageing',merchantCode)

  const stats = useMemo(() => {
    const classes=['fresh','slow','aging','dead_stock','never_sold']
    return Object.fromEntries(classes.map(cls=>[cls,inventoryEvidence(data.filter(row=>row.ageing_class===cls))]))
  },[data])
  const evidence=inventoryEvidence(data)
  if(loading)return <p role="status">جارٍ تحميل تقادم المخزون…</p>
  if(error)return <p role="alert">تعذر تحميل تقادم المخزون <button onClick={retry}>إعادة المحاولة</button></p>
  if (data.length === 0) return null
  const labels: any = { fresh: 'حديث', slow: 'بطيء (>30 يوم)', aging: 'متقادم (>60 يوم)', dead_stock: 'راكد (>90 يوم)', never_sold: 'لا توجد حركة بيع مسجلة' }
  const colors: any = { fresh: 'var(--green)', slow: 'var(--info-text)', aging: 'var(--warning-text)', dead_stock: 'var(--red)', never_sold: '#a598ff' }
  const fmt = (v: number|null) => v===null?'غير متاح':Math.round(v).toLocaleString('ar-SA-u-nu-latn') + ' ر.س'

  const dead = data.filter(d => d.ageing_class === 'dead_stock' || d.ageing_class === 'never_sold')
    .sort((a, b) => Number(b.tied_capital) - Number(a.tied_capital)).slice(0, 6)

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>تقادم المخزون</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>آخر حركة بيع مسجلة ضمن الحساب المختار — عدم وجود حركة لا يثبت عدم البيع. تغطية التكلفة {evidence.costCoverage.toFixed(0)}% ({evidence.costed} من {evidence.total})</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
        {Object.keys(labels).map(cls => (
          <div key={cls} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderTop: `3px solid ${colors[cls]}` }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>{labels[cls]}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: colors[cls] }}>{stats[cls].total}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{fmt(stats[cls].total?stats[cls].costValue:0)}</div>
          </div>
        ))}
      </div>
      {dead.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>أصناف تحتاج مراجعة حركة البيع</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dead.map((d, i) => (
              <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={d.product_name}>{d.product_name}</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ color: 'var(--text3)' }}>{d.last_sold ? `${d.age_days ?? '—'} يوم` : 'لا يوجد سجل بيع'}</span>
                  <span style={{ fontWeight: 700, color: 'var(--danger-text)' }}>{fmt(Number(d.cost_price)>0 ? Number(d.tied_capital):null)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Inventory Pipeline (ASN → GRN → Sales) ───────────────────────────────────
function InventoryPipelinePanel({ merchantCode }: { merchantCode?: string }) {
  const {data,loading,error,retry}=useInventoryAnalysisRows('inventory_pipeline',merchantCode,10)
  if(loading)return <p role="status">جارٍ تحميل الإرساليات…</p>
  if(error)return <p role="alert">تعذر تحميل الإرساليات <button onClick={retry}>إعادة المحاولة</button></p>
  if (data.length === 0) return null

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4, display: 'inline-flex', alignItems: 'center' }}>
        رحلة البضاعة: الإرسال ← الاستلام ← البيع
        <InfoIcon text="الإرسالية (ASN) = ما أرسلته لمستودع المنصة. تقرير الاستلام (GRN) = ما استلمه المستودع فعلياً. الفحص (QC) = الكمية المرفوضة لعيب أو تلف." />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>الإرساليات ضمن حساب البيع المختار. المبيعات التالية تخص الحساب بعد تاريخ الاستلام، وليست إسنادًا لهذه الإرسالية ولا تُجمع بين الإرساليات.</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['الإرسالية','المنصة','سُجلت','مدة الاستلام','متوقع','مُستلم','فرق الكمية','مرفوض بالفحص','بيع بعد','إيراد بعد'].map(h => (
            <th key={h} style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700 }}>{r.asn_number}</td>
                <td style={{ padding: '8px 10px' }}>{r.platform}</td>
                <td style={{ padding: '8px 10px', fontSize: 10, color: 'var(--text3)' }}>{new Date(r.asn_sent_at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' })}</td>
                <td style={{ padding: '8px 10px' }}>
                  {r.days_to_receive != null && Number(r.days_to_receive) >= 0
                    ? `${r.days_to_receive} يوم`
                    : r.delivery_date ? 'غير متاح' : 'بانتظار الاستلام'}
                </td>
                <td style={{ padding: '8px 10px' }}>{r.expected_qty}</td>
                <td style={{ padding: '8px 10px', color: 'var(--success-text)' }}>{r.delivered_qty}</td>
                <td style={{ padding: '8px 10px', color: r.lost_qty > 0 ? 'var(--danger-text)' : r.lost_qty < 0 ? 'var(--success-text)' : 'var(--text3)', fontWeight: r.lost_qty !== 0 ? 700 : 400 }}>
                  {r.lost_qty > 0 ? `ناقص ${r.lost_qty}` : r.lost_qty < 0 ? `زائد ${Math.abs(r.lost_qty)}` : '—'}
                </td>
                <td style={{ padding: '8px 10px', color: r.qc_failed_qty > 0 ? 'var(--warning-text)' : 'var(--text3)' }}>{r.qc_failed_qty || '—'}</td>
                <td style={{ padding: '8px 10px', fontWeight: 700 }}>{r.units_sold_after_receive || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--success-text)', fontFamily: 'monospace' }}>{r.revenue_after_receive ? Math.round(Number(r.revenue_after_receive)).toLocaleString('ar-SA-u-nu-latn') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


function useInventoryAnalysisRows(table: string, merchantCode?: string, firstRows=0) {
  const supabase=useSellingAccountClient()
  const [data,setData]=useState<any[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState(false)
  const [reload,setReload]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    setData([]);setError(false);setLoading(true)
    if(!merchantCode){setLoading(false);return ()=>controller.abort()}
    const page=(f:number,t:number)=>{
      const q=supabase.from(table).select('*').eq('merchant_code',merchantCode)
      return (table==='inventory_pipeline'?q.order('asn_sent_at',{ascending:false}):q).order('id').range(f,t).abortSignal(controller.signal)
    }
    const rows=firstRows?Promise.resolve(page(0,firstRows-1)).then(r=>{if(r.error)throw r.error;return r.data||[]}):fetchAll<any>(page)
    withTimeout(rows,20_000).then(r=>{if(!controller.signal.aborted)setData(r)})
      .catch(()=>{if(!controller.signal.aborted)setError(true)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);controller.abort()})
    return ()=>controller.abort()
  },[merchantCode,supabase,table,firstRows,reload])
  return {data,loading,error,retry:()=>setReload(n=>n+1)}
}
