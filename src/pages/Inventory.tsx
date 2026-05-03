import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import type { Merchant, InventoryItem } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export default function Inventory({ merchant }: { merchant: Merchant | null }) {
  const isMobile = useMobile()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const [editId, setEditId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState(0)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ sku:'', product_name:'', platform:'warehouse', quantity:0, low_stock_threshold:10, cost_price:0 })
  const [msg, setMsg] = useState<{ type:'ok'|'err'; text:string } | null>(null)
  const [alertSending, setAlertSending] = useState(false)

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
    return d
  }, [items, search, filter])

  // Group by SKU
  const bySku = useMemo(() => {
    const map: Record<string, InventoryItem[]> = {}
    for (const item of filtered) {
      if (!map[item.sku]) map[item.sku] = []
      map[item.sku].push(item)
    }
    return map
  }, [filtered])

  const stats = useMemo(() => ({
    total:    items.filter(i => i.is_active).length,
    low:      items.filter(i => i.is_active && i.quantity > 0 && i.quantity <= i.low_stock_threshold).length,
    out:      items.filter(i => i.is_active && i.quantity === 0).length,
    skus:     new Set(items.filter(i=>i.is_active).map(i=>i.sku)).size,
  }), [items])

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
      setMsg({ type:'ok', text:'✓ تمت إضافة المنتج' })
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
      setMsg({ type: 'ok', text: `✅ تم إرسال تنبيه مخزون لـ ${lowProducts.length} منتج` })
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

  return (
    <div style={S.wrap}>
      {/* Page Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        <button onClick={goProducts} style={{ background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -2, padding: '8px 20px', fontSize: 14, fontWeight: 500, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit' }}>
          🏷️ كتالوج المنتجات
        </button>
        <button style={{ background: 'none', border: 'none', borderBottom: '2px solid var(--accent)', marginBottom: -2, padding: '8px 20px', fontSize: 14, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
          🗃️ المخزون
        </button>
      </div>

      {/* TOPBAR */}
      <div style={{ ...S.topbar, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={S.pageTitle}>إدارة المخزون</h2>
          <p style={S.pageSub}>{stats.skus} منتج مختلف — {stats.total} سجل</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(stats.low > 0 || stats.out > 0) && (
            <button
              style={{ ...S.addBtn, background: 'rgba(255,209,102,0.15)', color: '#ffd166', border: '1px solid rgba(255,209,102,0.3)', boxShadow: 'none' }}
              onClick={sendLowStockAlert} disabled={alertSending}
            >
              {alertSending ? '⟳ جاري...' : `📲 تنبيه واتساب (${stats.low + stats.out})`}
            </button>
          )}
          <button style={S.addBtn} onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? '✕ إلغاء' : '+ إضافة منتج'}
          </button>
        </div>
      </div>

      {/* ALERT CARDS */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap:14, marginBottom:20 }}>
        {[
          { label:'إجمالي المنتجات', value:stats.total,  icon:'📦', color:'var(--accent)' },
          { label:'منتجات فريدة (SKU)', value:stats.skus, icon:'🏷️', color:'#4cc9f0'     },
          { label:'مخزون منخفض',     value:stats.low,   icon:'⚠️', color:'#ffd166',     active: filter==='low', onClick:()=>setFilter(filter==='low'?'all':'low') },
          { label:'نفذ المخزون',      value:stats.out,   icon:'🚨', color:'#ff4d6d',     active: filter==='out', onClick:()=>setFilter(filter==='out'?'all':'out') },
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
          <button style={{ background:'transparent', border:'none', color:'inherit', cursor:'pointer', marginRight:10 }} onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {/* HEALTH PANEL */}
      <InventoryHealthPanel merchant={merchant} />


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
            {saving ? '⟳ جاري...' : '✓ إضافة'}
          </button>
        </div>
      )}

      {/* FILTERS */}
      <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center' }}>
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
        <span style={S.badge}>{filtered.length} سجل</span>
      </div>

      {/* PRODUCTS GROUPED BY SKU */}
      {Object.keys(bySku).length === 0 ? (
        <div style={{ ...S.card, padding:60, textAlign:'center', color:'var(--text3)', fontSize:14 }}>
          {filter !== 'all' ? 'لا توجد منتجات في هذه الفئة' : 'لا يوجد مخزون — أضف منتجاتك'}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {Object.entries(bySku).map(([sku, skuItems]) => {
            const totalQty = skuItems.reduce((s,i) => s + i.quantity, 0)
            const isLow    = skuItems.some(i => i.quantity > 0 && i.quantity <= i.low_stock_threshold)
            const isOut    = skuItems.every(i => i.quantity === 0)
            return (
              <div key={sku} style={{ ...S.card, borderRight:isOut ? '3px solid #ff4d6d' : isLow ? '3px solid #ffd166' : '3px solid transparent' }}>
                {/* SKU Header */}
                <div style={{ padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                    <div style={{ width:44, height:44, borderRadius:10, background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>
                      📦
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:15 }}>{skuItems[0].product_name}</div>
                      <div style={{ fontSize:11, fontFamily:'monospace', color:'var(--accent)', marginTop:2 }}>{sku}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize:22, fontWeight:800, color: isOut?'#ff4d6d' : isLow?'#ffd166' : 'var(--accent2)' }}>
                        {totalQty.toLocaleString()}
                      </div>
                      <div style={{ fontSize:10, color:'var(--text3)' }}>إجمالي</div>
                    </div>
                    {(isLow || isOut) && (
                      <span style={{ fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:20, background:isOut?'rgba(255,77,109,0.15)':'rgba(255,209,102,0.15)', color:isOut?'#ff4d6d':'#ffd166' }}>
                        {isOut ? '🚨 نفذ المخزون' : '⚠️ مخزون منخفض'}
                      </span>
                    )}
                  </div>
                </div>
                {/* Platform rows */}
                <div>
                  {skuItems.map(item => (
                    <div key={item.id} style={{ padding:'12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)', background: item.quantity===0 ? 'rgba(255,77,109,0.04)' : item.quantity <= item.low_stock_threshold ? 'rgba(255,209,102,0.04)' : 'transparent' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:14, flex:1 }}>
                        <span style={{ fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:6, background:(PLATFORM_COLORS[item.platform]||'#5a5a7a')+'22', color:PLATFORM_COLORS[item.platform]||'#5a5a7a', minWidth:70, textAlign:'center' }}>
                          {PLATFORM_MAP[item.platform] || item.platform}
                        </span>
                        <div style={{ display:'flex', gap:24, fontSize:12, color:'var(--text2)' }}>
                          <span>حد التنبيه: <strong style={{ color:'var(--text)' }}>{item.low_stock_threshold}</strong></span>
                          {item.cost_price ? <span>التكلفة: <strong style={{ color:'var(--text)' }}>{item.cost_price} ر.س</strong></span> : null}
                          {item.reserved_quantity > 0 ? <span>محجوز: <strong style={{ color:'#ffd166' }}>{item.reserved_quantity}</strong></span> : null}
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
                            <button style={{ ...S.miniBtn, background:'var(--accent)', color:'#fff' }} onClick={() => updateQty(item.id)} disabled={saving}>
                              {saving ? '...' : '✓'}
                            </button>
                            <button style={S.miniBtn} onClick={() => setEditId(null)}>✕</button>
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize:20, fontWeight:800, color: item.quantity===0?'#ff4d6d':item.quantity<=item.low_stock_threshold?'#ffd166':'var(--text)', minWidth:40, textAlign:'center' }}>
                              {item.quantity.toLocaleString()}
                            </span>
                            <button
                              style={S.miniBtn}
                              onClick={() => { setEditId(item.id); setEditQty(item.quantity) }}
                            >✏️ تعديل</button>
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
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:      { padding:'28px 32px', minHeight:'100vh' },
  topbar:    { display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 },
  pageTitle: { fontSize:24, fontWeight:800, letterSpacing:'-0.5px' },
  pageSub:   { fontSize:13, color:'var(--text2)', marginTop:3 },
  addBtn:    { background:'linear-gradient(135deg,var(--accent),#a594ff)', border:'none', color:'#fff', padding:'10px 20px', borderRadius:10, fontSize:13, fontWeight:700, boxShadow:'0 4px 16px rgba(124,107,255,0.3)', cursor:'pointer' },
  statCard:  { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'18px 20px', cursor:'default', transition:'all 0.2s' },
  card:      { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' },
  label:     { display:'block', fontSize:11, fontWeight:700, color:'var(--text2)', marginBottom:5, textTransform:'uppercase' as const, letterSpacing:'0.5px' },
  input:     { width:'100%', padding:'9px 12px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:9, color:'var(--text)', fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' as const },
  saveBtn:   { background:'var(--accent)', border:'none', color:'#fff', padding:'10px 24px', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer' },
  miniBtn:   { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'5px 12px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' },
  pill:      { padding:'6px 14px', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text2)', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer' },
  pillActive:{ background:'var(--accent)', borderColor:'var(--accent)', color:'#fff' },
  badge:     { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text2)', fontSize:11, padding:'3px 10px', borderRadius:20, fontFamily:'monospace' },
  msgBox:    { borderRadius:10, padding:'12px 16px', fontSize:13, display:'flex', alignItems:'center', justifyContent:'space-between' },
  msgOk:     { background:'rgba(0,229,176,0.1)', border:'1px solid rgba(0,229,176,0.3)', color:'var(--green)' },
  msgErr:    { background:'rgba(255,77,109,0.1)', border:'1px solid rgba(255,77,109,0.3)', color:'var(--red)' },
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
    const stockoutCost = data
      .filter(r => r.health_status === 'out_of_stock' && Number(r.daily_velocity) > 0)
      .reduce((a, r) => a + (Number(r.daily_velocity) * Number(r.selling_price || 0) * 30), 0)
    return { sumCost, sumRetail, reorder, slow, out, stockoutCost }
  }, [data])

  const reorderList = useMemo(() => data.filter(r => r.health_status === 'reorder_soon')
    .sort((a, b) => Number(a.days_of_stock) - Number(b.days_of_stock)).slice(0, 6), [data])
  const slowList = useMemo(() => data.filter(r => r.health_status === 'slow_mover' && Number(r.stock_value_cost) > 0)
    .sort((a, b) => Number(b.stock_value_cost) - Number(a.stock_value_cost)).slice(0, 6), [data])

  if (loading || data.length === 0) return null
  const fmt = (v: number) => Math.round(v).toLocaleString('ar-SA') + ' ر.س'

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>📊 صحة المخزون</div>

      {/* Value KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <HKpi label="قيمة المخزون (تكلفة)" value={fmt(stats.sumCost)} sub={`${data.length} سجل`} color="#7c6bff" />
        <HKpi label="قيمة المخزون (بيع)" value={fmt(stats.sumRetail)} color="#00b894" />
        <HKpi label="هامش متوقّع" value={fmt(stats.sumRetail - stats.sumCost)} sub={stats.sumCost > 0 ? (((stats.sumRetail - stats.sumCost)/stats.sumCost)*100).toFixed(0)+'%' : '—'} color="#4cc9f0" />
        <HKpi label="خسائر النفاد المتوقّعة" value={fmt(stats.stockoutCost)} sub="30 يوم" color="#e84040" />
      </div>

      {/* Status counts */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, fontSize: 12 }}>
        <span style={pill('#e84040')}>🚨 نفد: <b>{stats.out}</b></span>
        <span style={pill('#ff9900')}>⏳ إعادة طلب قريبة: <b>{stats.reorder}</b></span>
        <span style={pill('#a598ff')}>🐌 راكد (30+ يوم): <b>{stats.slow}</b></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Reorder soon */}
        {reorderList.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9900', marginBottom: 8 }}>⏳ إعادة طلب قريبة</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {reorderList.map((r, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={r.product_name}>{r.product_name}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>{r.quantity} قطعة</span>
                    <span style={{ fontWeight: 700, color: '#ff9900' }}>{r.days_of_stock} يوم</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Slow movers */}
        {slowList.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a598ff', marginBottom: 8 }}>🐌 منتجات راكدة (رأس مال مجمّد)</div>
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
