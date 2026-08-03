import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import { InfoIcon, Pagination } from '../components/UI'
import type { Merchant, InventoryItem } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import { ClipboardPlus, ShieldAlert } from 'lucide-react'
import { createMerchantAction, dueDateFromNow } from '../lib/merchantActions'
import { toastErr, toastInfo, toastOk } from '../components/Toast'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const PAGE_SIZE = 25

export default function Inventory({ merchant }: { merchant: Merchant | null }) {
  const isMobile = useMobile()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [sort, setSort] = useState<'attention' | 'name' | 'quantity'>('attention')
  const [editId, setEditId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState(0)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ sku:'', product_name:'', platform:'warehouse', quantity:0, low_stock_threshold:10, cost_price:0 })
  const [msg, setMsg] = useState<{ type:'ok'|'err'; text:string } | null>(null)
  const [alertSending, setAlertSending] = useState(false)

  // The inventory loader is intentionally keyed by the current merchant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (merchant) loadInventory() }, [merchant])

  async function loadInventory() {
    setLoading(true)
    const { data } = await supabase
      .from('inventory')
      .select('*')
      .eq('merchant_code', merchant!.merchant_code)
      .order('product_name')
    setItems(data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let d = items.filter(i => i.is_active)
    if (search.trim()) {
      const q = search.toLowerCase()
      d = d.filter(i => i.product_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
    }
    if (filter === 'low') d = d.filter(i => i.quantity > 0 && i.quantity <= i.low_stock_threshold)
    if (filter === 'out') d = d.filter(i => i.quantity === 0)
    if (platformFilter !== 'all') d = d.filter(i => i.platform === platformFilter)
    d = [...d].sort((a, b) => {
      if (sort === 'name') return a.product_name.localeCompare(b.product_name, 'ar')
      if (sort === 'quantity') return b.quantity - a.quantity
      const priority = (item: InventoryItem) => item.quantity === 0 ? 0 : item.quantity <= item.low_stock_threshold ? 1 : 2
      return priority(a) - priority(b) || a.quantity - b.quantity
    })
    return d
  }, [items, search, filter, platformFilter, sort])

  // Group by SKU
  const bySku = useMemo(() => {
    const map: Record<string, InventoryItem[]> = {}
    for (const item of filtered) {
      if (!map[item.sku]) map[item.sku] = []
      map[item.sku].push(item)
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
    skus:     new Set(items.filter(i=>i.is_active).map(i=>i.sku)).size,
    units:    items.filter(i => i.is_active).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
  }), [items])
  const platforms = useMemo(() => [...new Set(items.filter(i => i.is_active).map(i => i.platform))], [items])

  async function updateQty(id: string) {
    setSaving(true)
    const { error } = await supabase
      .from('inventory')
      .update({ quantity: editQty, last_updated: new Date().toISOString() })
      .eq('id', id)
    setSaving(false)
    if (!error) { setEditId(null); loadInventory() }
  }

  async function addItem() {
    if (!addForm.sku.trim() || !addForm.product_name.trim()) {
      setMsg({ type:'err', text:'SKU واسم المنتج مطلوبان' }); return
    }
    setSaving(true)
    const { error } = await supabase.from('inventory').insert({
      merchant_code: merchant!.merchant_code,
      sku:              addForm.sku.trim().toUpperCase(),
      product_name:     addForm.product_name.trim(),
      platform:         addForm.platform,
      quantity:         Number(addForm.quantity),
      low_stock_threshold: Number(addForm.low_stock_threshold),
      cost_price:       Number(addForm.cost_price),
    })
    setSaving(false)
    if (error) {
      setMsg({ type:'err', text: error.message.includes('unique') ? 'هذا المنتج موجود مسبقاً على هذه المنصة' : error.message })
    } else {
      setMsg({ type:'ok', text:'تمت إضافة المنتج' })
      setAddForm({ sku:'', product_name:'', platform:'warehouse', quantity:0, low_stock_threshold:10, cost_price:0 })
      setShowAdd(false)
      loadInventory()
    }
  }

  async function sendLowStockAlert() {
    const lowProducts = items
      .filter(i => i.is_active && (i.quantity === 0 || i.quantity <= i.low_stock_threshold))
      .map(i => i.product_name)
    if (lowProducts.length === 0) return
    setAlertSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch(`${SUPABASE_URL}/functions/v1/notify-whatsapp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_code: merchant!.merchant_code, event: 'low_stock', data: { products: lowProducts } }),
      })
      setMsg({ type: 'ok', text: `تم إرسال تنبيه مخزون لـ ${lowProducts.length} منتج` })
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) }
    setAlertSending(false)
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:400 }}>
      <div style={{ width:36, height:36, border:'3px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
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

  return (
    <div style={S.wrap}>
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
      <div style={{ ...S.topbar, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={S.pageTitle}>المخزون</h2>
          <p style={S.pageSub}>راقب الكميات حسب المنصة، عالج النواقص، وحدّث عدة منتجات بسرعة.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={{ ...S.addBtn, background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--accent)', boxShadow: 'none' }} onClick={goQuickInventory}>
            تحديث كميات متعددة
          </button>
          {(stats.low > 0 || stats.out > 0) && (
            <button
              style={{ ...S.addBtn, background: 'var(--warning-bg)', color: 'var(--warning-text)', border: '1px solid var(--warning-bg)', boxShadow: 'none' }}
              onClick={sendLowStockAlert} disabled={alertSending}
            >
              {alertSending ? 'جارٍ الإرسال...' : `إرسال تنبيه واتساب (${stats.low + stats.out})`}
            </button>
          )}
          <button style={S.addBtn} onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'إلغاء' : 'إضافة منتج'}
          </button>
        </div>
      </div>

      {/* ALERT CARDS */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap:14, marginBottom:20 }}>
        {[
          { label:'المنتجات الفريدة', value:stats.skus,  icon:'', color:'var(--accent)' },
          { label:'إجمالي الوحدات المتاحة', value:stats.units, icon:'', color:'#4cc9f0'     },
          { label:'مخزون منخفض',     value:stats.low,   icon:'', color:'#ffd166',     active: filter==='low', onClick:()=>setFilter(filter==='low'?'all':'low') },
          { label:'نفد المخزون',      value:stats.out,   icon:'', color:'#ff4d6d',     active: filter==='out', onClick:()=>setFilter(filter==='out'?'all':'out') },
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
          {[['all','الكل'],['low','منخفض'],['out','نفذ']] .map(([k,l]) => (
            <button key={k} style={{ ...S.pill, ...(filter===k ? S.pillActive : {}) }} onClick={() => setFilter(k as any)}>{l}</button>
          ))}
        </div>
        <select style={{ ...S.input, width: 'auto', minWidth: 150 }} value={platformFilter} onChange={e => setPlatformFilter(e.target.value)}>
          <option value="all">كل المنصات</option>
          {platforms.map(p => <option key={p} value={p}>{PLATFORM_MAP[p] || p}</option>)}
        </select>
        <select style={{ ...S.input, width: 'auto', minWidth: 160 }} value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
          <option value="attention">الأكثر حاجة للإجراء</option>
          <option value="name">الاسم أبجديًا</option>
          <option value="quantity">الأعلى كمية</option>
        </select>
        <span style={S.badge}>{filtered.length} سجل</span>
      </div>

      {/* PRODUCTS GROUPED BY SKU */}
      {Object.keys(bySku).length === 0 ? (
        <div style={{ ...S.card, padding:60, textAlign:'center', color:'var(--text3)', fontSize:14 }}>
          {filter !== 'all' ? 'لا توجد منتجات في هذه الفئة' : 'لا يوجد مخزون — أضف منتجاتك'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {pageEntries.map(([sku, skuItems]) => {
            const totalQty = skuItems.reduce((s,i) => s + i.quantity, 0)
            const isLow    = skuItems.some(i => i.quantity > 0 && i.quantity <= i.low_stock_threshold)
            const isOut    = skuItems.every(i => i.quantity === 0)
            return (
              <div key={sku} style={{ ...S.card, borderRight:isOut ? '3px solid var(--red)' : isLow ? '3px solid var(--gold)' : '3px solid transparent' }}>
                {/* SKU Header */}
                <div style={{ padding: isMobile ? '12px' : '14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                    <div aria-hidden="true" style={{ width:44, height:44, borderRadius:10, background:'var(--surface2)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'var(--accent)', flexShrink:0 }}>
                      {skuItems[0].product_name?.trim()?.[0] || 'P'}
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:15 }}>{skuItems[0].product_name}</div>
                      <div style={{ fontSize:11, fontFamily:'monospace', color:'var(--accent)', marginTop:2 }}>{sku}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:22, fontWeight:800, color: isOut?'var(--danger-text)' : isLow?'var(--warning-text)' : 'var(--accent2)' }}>
                        {totalQty.toLocaleString()}
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
                    <div key={item.id} style={{ padding: isMobile ? '12px' : '12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap', borderBottom:'1px solid var(--border)', background: item.quantity===0 ? 'var(--danger-bg)' : item.quantity <= item.low_stock_threshold ? 'var(--warning-bg)' : 'transparent' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:14, flex:'1 1 260px', minWidth: 0, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                        <span style={{ fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:6, background:(PLATFORM_COLORS[item.platform]||'#5a5a7a')+'22', color:PLATFORM_COLORS[item.platform]||'var(--text3)', minWidth:70, textAlign:'center' }}>
                          {PLATFORM_MAP[item.platform] || item.platform}
                        </span>
                        <div style={{ display:'flex', gap: isMobile ? 8 : 24, fontSize:12, color:'var(--text2)', flexWrap: 'wrap' }}>
                          <span>حد التنبيه: <strong style={{ color:'var(--text)' }}>{item.low_stock_threshold}</strong></span>
                          {item.cost_price ? <span>التكلفة: <strong style={{ color:'var(--text)' }}>{item.cost_price} ر.س</strong></span> : null}
                          {item.reserved_quantity > 0 ? <span>محجوز: <strong style={{ color:'var(--warning-text)' }}>{item.reserved_quantity}</strong></span> : null}
                        </div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                        {editId === item.id ? (
                          <>
                            <input
                              style={{ ...S.input, width:80, textAlign:'center', padding:'6px 8px' }}
                              type="number"
                              value={editQty}
                              onChange={e => setEditQty(Number(e.target.value))}
                              min={0}
                            />
                            <button style={{ ...S.miniBtn, background:'var(--accent-strong)', color:'#fff' }} onClick={() => updateQty(item.id)} disabled={saving}>
                              {saving ? '...' : 'حفظ'}
                            </button>
                            <button style={S.miniBtn} onClick={() => setEditId(null)}>إلغاء</button>
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize:20, fontWeight:800, color: item.quantity===0?'var(--danger-text)':item.quantity<=item.low_stock_threshold?'var(--warning-text)':'var(--text)', minWidth:40, textAlign:'center' }}>
                              {item.quantity.toLocaleString()}
                            </span>
                            <button
                              style={S.miniBtn}
                              onClick={() => { setEditId(item.id); setEditQty(item.quantity) }}
                            >تعديل</button>
                          </>
                        )}
                      </div>
                    </div>
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
        <ReorderRecommendationsPanel merchant={merchant} />
        <InventoryHealthPanel merchant={merchant} />
        {merchant && <InventoryAgeingSection merchantCode={merchant.merchant_code} />}
        {merchant && <InventoryPipelinePanel merchantCode={merchant.merchant_code} />}
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

function ReorderRecommendationsPanel({ merchant }: { merchant: Merchant | null }) {
  const [rows, setRows] = useState<ReorderRecommendation[]>([])
  const [gate, setGate] = useState<'ready' | 'stale' | 'costs' | 'empty'>('empty')
  const [tracking, setTracking] = useState<string | null>(null)

  useEffect(() => {
    if (!merchant?.merchant_code) return
    let alive = true
    Promise.all([
      supabase.from('inventory_reorder_recommendations').select('*').eq('merchant_code', merchant.merchant_code).order('urgency').order('days_of_stock').limit(20),
      supabase.from('inventory_health').select('data_age_days,cost_price,daily_velocity').eq('merchant_code', merchant.merchant_code),
    ]).then(([recommendations, health]) => {
      if (!alive) return
      const nextRows = (recommendations.data || []) as ReorderRecommendation[]
      const healthRows = health.data || []
      setRows(nextRows)
      if (nextRows.length) setGate('ready')
      else if (healthRows.some(item => item.data_age_days != null && Number(item.data_age_days) > 2)) setGate('stale')
      else if (healthRows.some(item => Number(item.daily_velocity) > 0 && Number(item.cost_price) <= 0)) setGate('costs')
      else setGate('empty')
    })
    return () => { alive = false }
  }, [merchant?.merchant_code])

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

  if (!merchant) return null
  if (!rows.length) {
    const content = gate === 'stale'
      ? ['توصيات الشراء متوقفة مؤقتًا', 'بيانات حركة البيع أقدم من يومين. حدّث الطلبات والمخزون قبل إصدار قرار شراء.']
      : gate === 'costs'
        ? ['التكلفة مطلوبة قبل التوصية', 'أكمل تكاليف المنتجات حتى نحسب كمية الشراء والالتزام النقدي بدقة.']
        : ['لا توجد حاجة شراء عاجلة', 'لا توجد أصناف ببيانات حديثة تقل تغطيتها عن 14 يومًا.']
    return <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 38, height: 38, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: gate === 'stale' || gate === 'costs' ? 'var(--warning-bg)' : 'var(--success-bg)', color: gate === 'stale' || gate === 'costs' ? 'var(--warning-text)' : 'var(--success-text)' }}><ShieldAlert size={19} /></span><div><strong style={{ fontSize: 13 }}>{content[0]}</strong><p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--text3)' }}>{content[1]}</p></div></section>
  }

  return <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 13, flexWrap: 'wrap' }}><div><strong style={{ fontSize: 14 }}>توصيات إعادة الشراء</strong><p style={{ fontSize: 10, color: 'var(--text3)', margin: '4px 0 0' }}>كمية تغطي 30 يومًا، محسوبة فقط من بيانات لا يتجاوز عمرها يومين ومن تكلفة منتج معروفة.</p></div><div style={{ textAlign: 'left' }}><small style={{ display: 'block', fontSize: 9, color: 'var(--text3)' }}>الالتزام النقدي التقديري</small><strong style={{ fontSize: 17 }}>{totalCost.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</strong></div></div>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['المنتج', 'المنصة', 'المخزون', 'تغطية', 'الكمية المقترحة', 'التكلفة التقديرية', 'الإجراء'].map(label => <th key={label} style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--text3)', fontSize: 9, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.inventory_id} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '10px', minWidth: 170 }}><strong>{row.product_name || row.sku}</strong><small style={{ display: 'block', color: 'var(--text3)', marginTop: 2 }}>{row.sku}</small></td><td style={{ padding: '10px' }}>{PLATFORM_MAP[row.platform] || row.platform}</td><td style={{ padding: '10px' }}>{row.current_quantity}</td><td style={{ padding: '10px', color: row.urgency === 'critical' ? 'var(--danger-text)' : 'var(--warning-text)', fontWeight: 750 }}>{row.days_of_stock ?? 0} يوم</td><td style={{ padding: '10px', fontWeight: 800 }}>{row.recommended_quantity}</td><td style={{ padding: '10px' }}>{Number(row.estimated_cost).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</td><td style={{ padding: '10px' }}><button disabled={tracking === row.inventory_id} onClick={() => void track(row)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', padding: '7px 9px', borderRadius: 6, fontFamily: 'inherit', fontSize: 9, fontWeight: 750, cursor: 'pointer', whiteSpace: 'nowrap' }}><ClipboardPlus size={13} />{tracking === row.inventory_id ? 'جارٍ الإضافة' : 'إضافة للخطة'}</button></td></tr>)}</tbody></table></div>
  </section>
}

const S: Record<string, React.CSSProperties> = {
  wrap:      { padding:'clamp(14px, 3vw, 32px)', minHeight:'100vh', maxWidth: '100%', overflowX: 'hidden' },
  topbar:    { display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 },
  pageTitle: { fontSize:24, fontWeight:800, letterSpacing:'-0.5px' },
  pageSub:   { fontSize:13, color:'var(--text2)', marginTop:3 },
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
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])
  async function load() {
    if (!merchant) return
    setLoading(true)
    const { data: rows } = await supabase.from('inventory_health').select('*').eq('merchant_code', merchant.merchant_code)
    setData(rows || [])
    setLoading(false)
  }

  const stats = useMemo(() => {
    const sumCost   = data.reduce((a, r) => a + (Number(r.stock_value_cost) || 0), 0)
    const sumRetail = data.reduce((a, r) => a + (Number(r.stock_value_retail) || 0), 0)
    const reorder   = data.filter(r => r.health_status === 'reorder_soon').length
    const slow      = data.filter(r => r.health_status === 'slow_mover').length
    const out       = data.filter(r => r.health_status === 'out_of_stock').length
    const velocityRows = data.filter(r => Number(r.sold_30d) > 0).length
    const velocityCoverage = data.length ? velocityRows / data.length * 100 : 0
    const dataAgeDays = data.reduce((oldest, row) => row.data_age_days == null ? oldest : Math.max(oldest, Number(row.data_age_days)), 0)
    const stockoutCost = data
      .filter(r => r.health_status === 'out_of_stock' && Number(r.daily_velocity) > 0)
      .reduce((a, r) => a + (Number(r.daily_velocity) * Number(r.selling_price || 0) * 30), 0)
    return { sumCost, sumRetail, reorder, slow, out, stockoutCost, velocityRows, velocityCoverage, dataAgeDays }
  }, [data])

  const reorderList = useMemo(() => data.filter(r => r.health_status === 'reorder_soon')
    .sort((a, b) => Number(a.days_of_stock) - Number(b.days_of_stock)).slice(0, 6), [data])
  const slowList = useMemo(() => data.filter(r => r.health_status === 'slow_mover' && Number(r.stock_value_cost) > 0)
    .sort((a, b) => Number(b.stock_value_cost) - Number(a.stock_value_cost)).slice(0, 6), [data])

  if (loading || data.length === 0) return null
  const fmt = (v: number) => Math.round(v).toLocaleString('ar-SA') + ' ر.س'

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}><div><div style={{ fontSize: 14, fontWeight: 800 }}>صحة المخزون</div><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>سرعة البيع محسوبة من آخر نافذة طلبات متاحة لكل منصة.</div></div><div style={{ fontSize: 11, fontWeight: 700, color: stats.dataAgeDays > 2 ? 'var(--warning-text)' : 'var(--accent)', background: stats.dataAgeDays > 2 ? 'var(--warning-bg)' : 'var(--success-bg)', padding: '5px 10px', borderRadius: 7 }}>{stats.dataAgeDays > 2 ? `البيانات متأخرة ${stats.dataAgeDays} يومًا` : 'البيانات حديثة'}</div></div>

      {stats.dataAgeDays > 2 ? <div style={{ padding: '10px 12px', marginBottom: 14, borderRadius: 9, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 11, lineHeight: 1.8 }}>مؤشرات السرعة وإعادة الطلب تاريخية حتى تتم مزامنة الطلبات والمخزون من صفحة الربط ورفع الملفات. لا تعتمد أمر شراء جديد قبل التحديث.</div> : null}

      {/* Value KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <HKpi label="قيمة المخزون (تكلفة)" value={fmt(stats.sumCost)} sub={`${data.length} سجل`} color="#0f958c" />
        <HKpi label="قيمة المخزون (بيع)" value={fmt(stats.sumRetail)} color="var(--green)" />
        <HKpi label="تغطية حركة البيع" value={stats.velocityCoverage.toFixed(0) + '%'} sub={`${stats.velocityRows} من ${data.length} صنف`} color="var(--info-text)" />
        <HKpi label="مبيعات معرضة بسبب النفاد" value={fmt(stats.stockoutCost)} sub={stats.dataAgeDays > 2 ? 'تقدير تاريخي · حدّث البيانات' : 'تقدير 30 يومًا'} color="var(--red)" />
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
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
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
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchantCode) return
    supabase.from('inventory_ageing').select('*').eq('merchant_code', merchantCode).then(({ data }) => setData(data || []))
  }, [merchantCode])

  const stats = useMemo(() => {
    const counts: any = { fresh: 0, slow: 0, aging: 0, dead_stock: 0, never_sold: 0 }
    const capital: any = { fresh: 0, slow: 0, aging: 0, dead_stock: 0, never_sold: 0 }
    for (const d of data) {
      counts[d.ageing_class]++
      capital[d.ageing_class] += Number(d.tied_capital) || 0
    }
    return { counts, capital, totalCapital: Object.values(capital).reduce((a: any, b: any) => a + b, 0) }
  }, [data])

  if (data.length === 0) return null
  const labels: any = { fresh: 'حديث', slow: 'بطيء (>30 يوم)', aging: 'متقادم (>60 يوم)', dead_stock: 'راكد (>90 يوم)', never_sold: 'لم يُبَع أبداً' }
  const colors: any = { fresh: 'var(--green)', slow: 'var(--info-text)', aging: 'var(--warning-text)', dead_stock: 'var(--red)', never_sold: '#a598ff' }
  const fmt = (v: number) => Math.round(v).toLocaleString('ar-SA') + ' ر.س'

  const dead = data.filter(d => d.ageing_class === 'dead_stock' || d.ageing_class === 'never_sold')
    .sort((a, b) => Number(b.tied_capital) - Number(a.tied_capital)).slice(0, 6)

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>تقادم المخزون</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14 }}>عمر كل منتج منذ آخر بيعة — لكشف رأس المال المجمّد</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
        {Object.keys(labels).map(cls => (
          <div key={cls} style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, borderTop: `3px solid ${colors[cls]}` }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>{labels[cls]}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: colors[cls] }}>{stats.counts[cls]}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{fmt(stats.capital[cls])}</div>
          </div>
        ))}
      </div>
      {dead.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger-text)', marginBottom: 8 }}>أكبر رأس مال مجمّد</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dead.map((d, i) => (
              <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={d.product_name}>{d.product_name}</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ color: 'var(--text3)' }}>{d.age_days || '—'} يوم</span>
                  <span style={{ fontWeight: 700, color: 'var(--danger-text)' }}>{fmt(Number(d.tied_capital))}</span>
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
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    if (!merchantCode) return
    supabase.from('inventory_pipeline').select('*').eq('merchant_code', merchantCode).order('asn_sent_at', { ascending: false }).limit(10).then(({ data }) => setData(data || []))
  }, [merchantCode])
  if (data.length === 0) return null

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4, display: 'inline-flex', alignItems: 'center' }}>
        رحلة البضاعة: الإرسال ← الاستلام ← البيع
        <InfoIcon text="الإرسالية (ASN) = ما أرسلته لمستودع المنصة. تقرير الاستلام (GRN) = ما استلمه المستودع فعلياً. الفحص (QC) = الكمية المرفوضة لعيب أو تلف." />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>تتبّع كل إرسالية من الإرسال حتى البيع</div>
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
                <td style={{ padding: '8px 10px', fontSize: 10, color: 'var(--text3)' }}>{new Date(r.asn_sent_at).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short' })}</td>
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
                <td style={{ padding: '8px 10px', color: 'var(--success-text)', fontFamily: 'monospace' }}>{r.revenue_after_receive ? Math.round(Number(r.revenue_after_receive)).toLocaleString('ar-SA') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
