import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant, InventoryItem } from '../lib/supabase'
import { Search, Save, Plus, Minus, Check, AlertCircle, Zap } from 'lucide-react'
import { toastOk, toastErr } from '../components/Toast'
import { PLATFORM_MAP } from '../lib/constants'

interface PendingChange { qty: number; original: number }

export default function QuickInventory({ merchant }: { merchant: Merchant | null }) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<Record<string, PendingChange>>({})
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all')
  const [saving, setSaving] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (merchant) loadInventory() }, [merchant])

  // Focus search on mount and on '/'
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 80)
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function loadInventory() {
    if (!merchant) return
    setLoading(true)
    const { data } = await supabase.from('inventory').select('*')
      .eq('merchant_code', merchant.merchant_code).eq('is_active', true)
      .order('product_name').limit(500)
    setItems(data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let d = items
    if (search.trim()) {
      const q = search.toLowerCase()
      d = d.filter(i => i.product_name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
    }
    if (filter === 'low') d = d.filter(i => i.quantity > 0 && i.quantity <= i.low_stock_threshold)
    if (filter === 'out') d = d.filter(i => i.quantity === 0)
    return d
  }, [items, search, filter])

  function setQty(id: string, currentQty: number, newQty: number) {
    if (newQty < 0) newQty = 0
    setPending(p => {
      const orig = p[id]?.original ?? currentQty
      if (newQty === orig) {
        const { [id]: _, ...rest } = p
        return rest
      }
      return { ...p, [id]: { qty: newQty, original: orig } }
    })
  }

  function getQty(item: InventoryItem) {
    return pending[item.id]?.qty ?? item.quantity
  }

  async function saveAll() {
    const changes = Object.entries(pending)
    if (changes.length === 0) return
    setSaving(true)

    let succeeded = 0
    for (const [id, p] of changes) {
      const { error } = await supabase.from('inventory')
        .update({ quantity: p.qty, last_updated: new Date().toISOString() })
        .eq('id', id)
      if (!error) succeeded++
    }
    setSaving(false)
    if (succeeded === changes.length) {
      toastOk(`تم حفظ ${succeeded} تعديلات`)
      setPending({})
      loadInventory()
    } else {
      toastErr(`فشل حفظ ${changes.length - succeeded} من ${changes.length}`)
      loadInventory()
    }
  }

  function resetAll() {
    setPending({})
  }

  const stats = useMemo(() => ({
    total: items.length,
    low: items.filter(i => i.quantity > 0 && i.quantity <= i.low_stock_threshold).length,
    out: items.filter(i => i.quantity === 0).length,
  }), [items])

  const pendingCount = Object.keys(pending).length

  if (!merchant) return null

  return (
    <div style={{ padding: '16px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#6c5ce7,#00b894)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Zap size={20} color="#fff" />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0 }}>تحديث المخزون السريع</h1>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>عدّل كميات متعددة دفعة واحدة</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        <StatCard label="الإجمالي" value={stats.total} color="var(--accent)" />
        <StatCard label="منخفض" value={stats.low} color="#f0a800" />
        <StatCard label="نفد" value={stats.out} color="#e84040" />
      </div>

      {/* Search + Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', position: 'relative', minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none' }} />
          <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو SKU... (اضغط /)"
            style={{ width: '100%', padding: '10px 36px 10px 12px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 3, borderRadius: 9 }}>
          {(['all', 'low', 'out'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 700,
              border: 'none', borderRadius: 7,
              background: filter === f ? 'var(--surface)' : 'transparent',
              color: filter === f ? 'var(--text)' : 'var(--text2)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {f === 'all' ? 'الكل' : f === 'low' ? 'منخفض' : 'نفد'}
            </button>
          ))}
        </div>
      </div>

      {/* Sticky save bar */}
      {pendingCount > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'linear-gradient(135deg,#6c5ce7,#9f8fff)', color: '#fff',
          padding: '10px 14px', borderRadius: 10, marginBottom: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 4px 20px rgba(108,92,231,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{pendingCount} تعديل غير محفوظ</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={resetAll} style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
              padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>تراجع</button>
            <button onClick={saveAll} disabled={saving} style={{
              background: '#fff', border: 'none', color: '#6c5ce7',
              padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 800,
              cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              fontFamily: 'inherit',
            }}>
              <Save size={13} />{saving ? 'جاري الحفظ...' : 'حفظ الكل'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
          لا توجد منتجات
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(item => {
            const qty = getQty(item)
            const isChanged = pending[item.id] !== undefined
            const isOut = qty === 0
            const isLow = qty > 0 && qty <= item.low_stock_threshold
            const platLabel = PLATFORM_MAP[item.platform] || item.platform
            return (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--surface)', border: '1px solid ' + (isChanged ? 'var(--accent)' : 'var(--border)'),
                borderRadius: 10, padding: '10px 12px',
                boxShadow: isChanged ? '0 0 0 3px rgba(108,92,231,0.08)' : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product_name}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 10, color: 'var(--text3)' }}>
                    <span style={{ fontFamily: 'monospace' }}>{item.sku}</span>
                    <span>·</span>
                    <span>{platLabel}</span>
                    <span>·</span>
                    <span style={{ color: isOut ? '#e84040' : isLow ? '#f0a800' : 'var(--text3)' }}>
                      حد: {item.low_stock_threshold}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={() => setQty(item.id, item.quantity, qty - 1)} style={qtyBtnStyle}>
                    <Minus size={14} />
                  </button>
                  <input type="number" value={qty}
                    onChange={e => setQty(item.id, item.quantity, parseInt(e.target.value || '0', 10))}
                    style={{
                      width: 60, textAlign: 'center', border: '1px solid var(--border)',
                      background: isChanged ? 'rgba(108,92,231,0.08)' : 'var(--surface2)',
                      color: isOut ? '#e84040' : isLow ? '#f0a800' : 'var(--text)',
                      borderRadius: 7, padding: '6px 4px', fontSize: 13, fontWeight: 700,
                      fontFamily: 'inherit',
                    }} />
                  <button onClick={() => setQty(item.id, item.quantity, qty + 1)} style={qtyBtnStyle}>
                    <Plus size={14} />
                  </button>
                  {isChanged && (
                    <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginRight: 4, minWidth: 30 }}>
                      {(qty - item.quantity) > 0 ? '+' : ''}{qty - item.quantity}
                    </span>
                  )}
                  {!isChanged && <Check size={14} color="var(--text3)" style={{ marginRight: 4 }} />}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 16, padding: '10px 12px', fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
        💡 اختصارات: اضغط <kbd style={kbdStyle}>/</kbd> للبحث · <kbd style={kbdStyle}>Tab</kbd> للتنقل بين الحقول
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

const qtyBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text2)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit',
}
const kbdStyle: React.CSSProperties = {
  fontSize: 10, padding: '1px 5px', background: 'var(--surface2)',
  border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text2)',
  fontFamily: 'monospace',
}
