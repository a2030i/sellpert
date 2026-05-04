import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant, Product } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY

const PLATFORMS = [
  { value: 'trendyol', label: 'تراندايول', color: '#f27a1a' },
  { value: 'noon',     label: 'نون',        color: '#f5c518' },
  { value: 'amazon',   label: 'أمازون',     color: '#ff9900' },
]

type Tab = 'checklist' | 'entry' | 'history' | 'tasks'
type MerchantOpt = { merchant_code: string; name: string }
type ProductRow  = { product_id: string | null; name: string; sku: string; qty: string; revenue: string; isCustom?: boolean }
type EntrySession = { merchant_code: string; platform: string; data_date: string; total_sales: number; record_count: number }

const today = () => new Date().toISOString().split('T')[0]

export default function EmployeePanel({ merchant: employee }: { merchant: Merchant | null }) {
  const [tab, setTab]               = useState<Tab>('checklist')
  const [merchants, setMerchants]   = useState<MerchantOpt[]>([])
  const [sessions, setSessions]     = useState<EntrySession[]>([])
  const [history, setHistory]       = useState<any[]>([])
  const [loading, setLoading]       = useState(true)
  const [msg, setMsg]               = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Entry form state
  const [selMerchant, setSelMerchant] = useState('')
  const [selPlatform, setSelPlatform] = useState('trendyol')
  const [selDate, setSelDate]         = useState(today())
  const [products, setProducts]       = useState<Product[]>([])
  const [productRows, setProductRows] = useState<ProductRow[]>([])
  const [platformFees, setPlatformFees] = useState('')
  const [adSpend, setAdSpend]         = useState('')
  const [notes, setNotes]             = useState('')
  const [saving, setSaving]           = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Anomaly / duplicate state
  const [prevDaySales, setPrevDaySales] = useState<number | null>(null)
  const [dupWarning, setDupWarning]     = useState(false)
  const [anomalyWarning, setAnomalyWarning] = useState(false)

  // Edit state
  const [editRecord, setEditRecord]   = useState<any | null>(null)
  const [editSaving, setEditSaving]   = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    await Promise.all([fetchMerchants(), fetchSessions(), fetchHistory()])
    setLoading(false)
  }

  async function fetchMerchants() {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/manual-entry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_merchants' }),
    })
    const data = await res.json()
    setMerchants(data.merchants || [])
  }

  async function fetchSessions() {
    const { data } = await supabase
      .from('entry_sessions')
      .select('merchant_code,platform,data_date,total_sales,record_count')
      .gte('data_date', new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0])
      .order('data_date', { ascending: false })
    setSessions(data || [])
  }

  async function fetchHistory() {
    const { data } = await supabase
      .from('performance_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setHistory(data || [])
  }

  // When merchant/platform changes → load their products
  useEffect(() => {
    if (!selMerchant) { setProducts([]); setProductRows([]); return }
    loadProducts()
  }, [selMerchant, selPlatform])

  // Fetch previous day sales for anomaly detection
  useEffect(() => {
    if (!selMerchant || !selPlatform || !selDate) { setPrevDaySales(null); return }
    const prev = new Date(selDate)
    prev.setDate(prev.getDate() - 1)
    const prevStr = prev.toISOString().split('T')[0]
    supabase
      .from('performance_data')
      .select('total_sales')
      .eq('merchant_code', selMerchant)
      .eq('platform', selPlatform)
      .eq('data_date', prevStr)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setPrevDaySales(data.reduce((s, r) => s + r.total_sales, 0))
        } else {
          setPrevDaySales(null)
        }
      })
  }, [selMerchant, selPlatform, selDate])

  async function loadProducts() {
    setLoadingProducts(true)
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('merchant_code', selMerchant)
      .eq('status', 'active')
      .order('name')
    setProducts(data || [])
    // Build initial rows from products
    setProductRows((data || []).map(p => ({
      product_id: p.id,
      name: p.name,
      sku: p.sku || '',
      qty: '',
      revenue: '',
    })))
    setLoadingProducts(false)
  }

  function updateRow(i: number, field: 'qty' | 'revenue', val: string) {
    setProductRows(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  function addCustomRow() {
    setProductRows(rows => [...rows, { product_id: null, name: '', sku: '', qty: '', revenue: '', isCustom: true }])
  }

  function removeRow(i: number) {
    setProductRows(rows => rows.filter((_, idx) => idx !== i))
  }

  // Totals computed from rows
  const totalRevenue = useMemo(() =>
    productRows.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0)
  , [productRows])

  const totalOrders = useMemo(() =>
    productRows.reduce((s, r) => s + (parseInt(r.qty) || 0), 0)
  , [productRows])

  async function submitEntry(force = false) {
    const activeRows = productRows.filter(r => r.qty || r.revenue)
    if (!selMerchant) { setMsg({ type: 'err', text: 'اختر التاجر' }); return }
    if (activeRows.length === 0) { setMsg({ type: 'err', text: 'أدخل بيانات منتج واحد على الأقل' }); return }

    // Duplicate check
    const alreadyEntered = sessions.some(
      s => s.merchant_code === selMerchant && s.platform === selPlatform && s.data_date === selDate
    )
    if (alreadyEntered && !force) { setDupWarning(true); return }

    // Anomaly check — warn if revenue is 5x previous day
    if (prevDaySales !== null && prevDaySales > 0 && totalRevenue > prevDaySales * 5 && !force) {
      setAnomalyWarning(true); return
    }

    setDupWarning(false); setAnomalyWarning(false)
    setSaving(true); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const entryBy = employee?.email || employee?.merchant_code || 'employee'

      // Build performance_data rows
      const rows = activeRows.map(r => ({
        merchant_code: selMerchant,
        platform: selPlatform,
        data_date: selDate,
        product_id: r.product_id || null,
        product_name: r.name || null,
        total_sales: parseFloat(r.revenue) || 0,
        order_count: parseInt(r.qty) || 0,
        platform_fees: 0,
        ad_spend: 0,
        margin: 0,
        entry_by: entryBy,
        notes: notes.trim() || null,
      }))

      // First row carries the shared fees
      if (rows.length > 0) {
        rows[0].platform_fees = parseFloat(platformFees) || 0
        rows[0].ad_spend = parseFloat(adSpend) || 0
      }

      // Call manual-entry edge function
      const res = await fetch(`${SUPABASE_URL}/functions/v1/manual-entry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const result = await res.json()
      if (result.error) { setMsg({ type: 'err', text: result.error }); return }

      // Upsert entry_session
      await supabase.from('entry_sessions').upsert({
        merchant_code: selMerchant,
        platform: selPlatform,
        data_date: selDate,
        entered_by: entryBy,
        record_count: activeRows.length,
        total_sales: totalRevenue,
        platform_fees: parseFloat(platformFees) || 0,
        ad_spend: parseFloat(adSpend) || 0,
      }, { onConflict: 'merchant_code,platform,data_date' })

      // Audit log
      await supabase.from('audit_log').insert({
        merchant_code: selMerchant,
        action: 'entry_created',
        table_name: 'performance_data',
        new_values: { platform: selPlatform, date: selDate, rows: activeRows.length, total: totalRevenue },
        performed_by: entryBy,
      })

      setMsg({ type: 'ok', text: `✅ تم حفظ ${activeRows.length} منتج — إجمالي ${totalRevenue.toLocaleString()} ر.س` })

      // Reset revenue/qty only, keep products
      setProductRows(rows => rows.filter(r => !r.isCustom).map(r => ({ ...r, qty: '', revenue: '' })))
      setPlatformFees(''); setAdSpend(''); setNotes('')
      fetchSessions(); fetchHistory()
    } finally { setSaving(false) }
  }

  async function saveEdit() {
    if (!editRecord) return
    setEditSaving(true)
    const { error } = await supabase.from('performance_data').update({
      total_sales: parseFloat(editRecord.total_sales) || 0,
      order_count: parseInt(editRecord.order_count) || 0,
      platform_fees: parseFloat(editRecord.platform_fees) || 0,
      ad_spend: parseFloat(editRecord.ad_spend) || 0,
      notes: editRecord.notes,
      is_edited: true,
      edited_at: new Date().toISOString(),
      edited_by: employee?.email || 'employee',
    }).eq('id', editRecord.id)

    if (error) setMsg({ type: 'err', text: error.message })
    else {
      setMsg({ type: 'ok', text: '✅ تم تعديل السجل' })
      setEditRecord(null)
      fetchHistory()
    }
    setEditSaving(false)
  }

  // Checklist: which merchant/platform needs entry today
  const checklistData = useMemo(() => {
    const todayStr = today()
    return merchants.map(m => {
      const platformStatus = PLATFORMS.filter(p => ['trendyol','noon','amazon'].includes(p.value)).map(p => {
        const session = sessions.find(s =>
          s.merchant_code === m.merchant_code &&
          s.platform === p.value &&
          s.data_date === todayStr
        )
        return { ...p, done: !!session, total: session?.total_sales || 0 }
      })
      const doneCount = platformStatus.filter(p => p.done).length
      return { ...m, platformStatus, doneCount, total: platformStatus.length }
    })
  }, [merchants, sessions])

  const getMerchantName = (code: string) => merchants.find(m => m.merchant_code === code)?.name || code
  const getPlatformLabel = (val: string) => PLATFORMS.find(p => p.value === val)?.label || val
  const getPlatformColor = (val: string) => PLATFORMS.find(p => p.value === val)?.color || '#5a5a7a'

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={S.logo}>S</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Sellpert</div>
            <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>إدخال بيانات</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{employee?.name}</span>
          <button style={S.logoutBtn} onClick={() => supabase.auth.signOut()}>خروج</button>
        </div>
      </header>

      {/* Tabs */}
      <div style={S.tabs}>
        {([
          { key: 'tasks',     label: '📋 مهامي', badge: 0 },
          { key: 'checklist', label: '✅ مهام اليوم', badge: checklistData.filter(m => m.doneCount < m.total).length },
          { key: 'entry',     label: '📝 إدخال بيانات', badge: 0 },
          { key: 'history',   label: '🕐 السجل والتعديل', badge: 0 },
        ] as const).map(t => (
          <button key={t.key} style={{ ...S.tab, ...(tab === t.key ? S.tabActive : {}) }} onClick={() => setTab(t.key)}>
            {t.label}
            {t.badge > 0 && <span style={S.tabBadge}>{t.badge}</span>}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '16px', maxWidth: 640, margin: '0 auto', width: '100%' }}>

        {msg && (
          <div style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', background: msg.type === 'ok' ? 'rgba(0,229,176,0.1)' : 'rgba(255,77,109,0.1)', color: msg.type === 'ok' ? 'var(--accent2)' : 'var(--red)', border: `1px solid ${msg.type === 'ok' ? 'rgba(0,229,176,0.3)' : 'rgba(255,77,109,0.3)'}` }}>
            {msg.text}
            <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setMsg(null)}>✕</button>
          </div>
        )}

        {/* ── TAB: TASKS — مهامي المسندة ── */}
        {tab === 'tasks' && employee && <EmployeeTasksTab employeeCode={employee.merchant_code} />}

        {/* ── TAB: CHECKLIST ── */}
        {tab === 'checklist' && (
          <div>
            <div style={S.sectionTitle}>مهام اليوم — {new Date().toLocaleDateString('ar-SA', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            {checklistData.length === 0 ? (
              <div style={S.empty}>لا يوجد تجار مسجّلون</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {checklistData.map(m => (
                  <div key={m.merchant_code} style={{ ...S.card, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                        background: m.doneCount === m.total ? 'rgba(0,229,176,0.12)' : 'rgba(255,209,102,0.15)',
                        color: m.doneCount === m.total ? 'var(--accent2)' : '#ffd166',
                      }}>
                        {m.doneCount}/{m.total} منصة
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 4, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{ height: '100%', borderRadius: 4, background: m.doneCount === m.total ? 'var(--accent2)' : 'var(--accent)', width: `${m.total > 0 ? (m.doneCount / m.total) * 100 : 0}%`, transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {m.platformStatus.map(p => (
                        <button
                          key={p.value}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            border: `1px solid ${p.done ? p.color + '44' : 'var(--border)'}`,
                            background: p.done ? p.color + '18' : 'var(--surface2)',
                            color: p.done ? p.color : 'var(--text2)',
                          }}
                          onClick={() => {
                            setSelMerchant(m.merchant_code)
                            setSelPlatform(p.value)
                            setSelDate(today())
                            setTab('entry')
                          }}
                        >
                          {p.done ? '✓' : '○'} {p.label}
                          {p.done && <span style={{ fontSize: 10, opacity: 0.8 }}>{p.total.toLocaleString()} ر.س</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent 3 days summary */}
            {sessions.length > 0 && (
              <div style={{ ...S.card, marginTop: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: 'var(--text2)' }}>آخر الإدخالات</div>
                {sessions.slice(0, 8).map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < 7 ? '1px solid var(--border)' : 'none' }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{getMerchantName(s.merchant_code)}</span>
                      <span style={{ fontSize: 11, color: getPlatformColor(s.platform), fontWeight: 700, marginRight: 8 }}>{getPlatformLabel(s.platform)}</span>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent2)' }}>{s.total_sales.toLocaleString()} ر.س</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{s.data_date}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB: ENTRY ── */}
        {tab === 'entry' && (
          <div>
            <div style={S.sectionTitle}>إدخال مبيعات يومية</div>

            {/* Step 1: Select merchant/platform/date */}
            <div style={S.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                <div style={S.field}>
                  <span style={S.label}>التاجر *</span>
                  <select style={S.input} value={selMerchant} onChange={e => setSelMerchant(e.target.value)}>
                    <option value="">— اختر التاجر —</option>
                    {merchants.map(m => <option key={m.merchant_code} value={m.merchant_code}>{m.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={S.field}>
                    <span style={S.label}>المنصة *</span>
                    <select style={S.input} value={selPlatform} onChange={e => setSelPlatform(e.target.value)}>
                      {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div style={S.field}>
                    <span style={S.label}>التاريخ *</span>
                    <input type="date" style={S.input} value={selDate} onChange={e => setSelDate(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Product rows */}
            {selMerchant && (
              <div style={{ ...S.card, marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    المنتجات
                    {loadingProducts && <span style={{ color: 'var(--text3)', fontWeight: 400, marginRight: 8 }}>جاري التحميل...</span>}
                  </div>
                  <button style={S.btnSm} onClick={addCustomRow}>+ منتج غير مسجّل</button>
                </div>

                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 28px', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)' }}>المنتج</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textAlign: 'center' }}>الكمية</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textAlign: 'center' }}>الإيراد (ر.س)</div>
                  <div />
                </div>

                {productRows.length === 0 && !loadingProducts && (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                    لا توجد منتجات مسجّلة لهذا التاجر — استخدم "منتج غير مسجّل" أو أضف منتجات من صفحة المنتجات
                  </div>
                )}

                {productRows.map((row, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 28px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    {row.isCustom ? (
                      <input
                        style={{ ...S.input, fontSize: 12 }}
                        placeholder="اسم المنتج"
                        value={row.name}
                        onChange={e => setProductRows(rows => rows.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))}
                      />
                    ) : (
                      <div style={{ padding: '9px 10px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>{row.name}</div>
                        {row.sku && <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'monospace', marginTop: 2 }}>{row.sku}</div>}
                      </div>
                    )}
                    <input
                      type="number" min="0" inputMode="numeric"
                      style={{ ...S.input, textAlign: 'center' }}
                      placeholder="0"
                      value={row.qty}
                      onChange={e => updateRow(i, 'qty', e.target.value)}
                    />
                    <input
                      type="number" min="0" inputMode="decimal"
                      style={{ ...S.input, textAlign: 'center' }}
                      placeholder="0.00"
                      value={row.revenue}
                      onChange={e => updateRow(i, 'revenue', e.target.value)}
                    />
                    <button
                      style={{ width: 28, height: 28, background: 'rgba(255,77,109,0.1)', border: 'none', borderRadius: 7, color: 'var(--red)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                      onClick={() => removeRow(i)}
                    >✕</button>
                  </div>
                ))}

                {/* Totals bar */}
                {(totalRevenue > 0 || totalOrders > 0) && (
                  <div style={{ display: 'flex', gap: 16, padding: '10px 12px', background: 'rgba(124,107,255,0.06)', borderRadius: 10, marginTop: 6, marginBottom: 4, border: '1px solid rgba(124,107,255,0.15)' }}>
                    <div><span style={{ fontSize: 10, color: 'var(--text3)' }}>إجمالي الإيراد </span><strong style={{ color: 'var(--accent)' }}>{totalRevenue.toLocaleString()} ر.س</strong></div>
                    <div><span style={{ fontSize: 10, color: 'var(--text3)' }}>إجمالي الطلبات </span><strong>{totalOrders}</strong></div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Shared fees */}
            {selMerchant && (
              <div style={{ ...S.card, marginTop: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>تفاصيل إضافية (من تقرير المنصة)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={S.field}>
                    <span style={S.label}>رسوم المنصة الإجمالية</span>
                    <input type="number" min="0" inputMode="decimal" style={S.input} placeholder="0.00" value={platformFees} onChange={e => setPlatformFees(e.target.value)} />
                  </div>
                  <div style={S.field}>
                    <span style={S.label}>الإنفاق الإعلاني</span>
                    <input type="number" min="0" inputMode="decimal" style={S.input} placeholder="0.00" value={adSpend} onChange={e => setAdSpend(e.target.value)} />
                  </div>
                </div>
                <div style={S.field}>
                  <span style={S.label}>ملاحظات (اختياري)</span>
                  <input style={S.input} placeholder="مثال: يوم الجمعة — مبيعات مرتفعة" value={notes} onChange={e => setNotes(e.target.value)} />
                </div>

                {/* Summary before submit */}
                {totalRevenue > 0 && (
                  <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '12px 14px', marginTop: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontWeight: 700 }}>ملخص الإدخال</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[
                        { label: 'الإيراد', val: totalRevenue.toLocaleString() + ' ر.س', color: 'var(--accent)' },
                        { label: 'رسوم المنصة', val: (parseFloat(platformFees) || 0).toLocaleString() + ' ر.س', color: 'var(--red)' },
                        { label: 'الصافي', val: (totalRevenue - (parseFloat(platformFees) || 0) - (parseFloat(adSpend) || 0)).toLocaleString() + ' ر.س', color: 'var(--accent2)' },
                      ].map((item, i) => (
                        <div key={i} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text3)' }}>{item.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: item.color }}>{item.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Duplicate warning */}
                {dupWarning && (
                  <div style={{ background: 'rgba(255,209,102,0.1)', border: '1px solid rgba(255,209,102,0.4)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#ffd166', marginBottom: 8 }}>
                      ⚠️ يوجد إدخال مسبق لهذا التاجر والمنصة في هذا التاريخ
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={{ ...S.btnSm, background: '#ffd16622', color: '#ffd166', borderColor: '#ffd16644' }} onClick={() => submitEntry(true)}>تحديث وإضافة</button>
                      <button style={{ ...S.btnSm }} onClick={() => setDupWarning(false)}>إلغاء</button>
                    </div>
                  </div>
                )}

                {/* Anomaly warning */}
                {anomalyWarning && prevDaySales !== null && (
                  <div style={{ background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.4)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>
                      🚨 تحذير: المبيعات مرتفعة بشكل غير اعتيادي
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                      المدخل: <strong>{totalRevenue.toLocaleString()} ر.س</strong> — البارحة: <strong>{prevDaySales.toLocaleString()} ر.س</strong>
                      <span style={{ color: 'var(--red)', marginRight: 8 }}>({(totalRevenue / prevDaySales).toFixed(1)}x)</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={{ ...S.btnSm, background: 'rgba(255,77,109,0.15)', color: 'var(--red)', borderColor: 'rgba(255,77,109,0.3)' }} onClick={() => submitEntry(true)}>الأرقام صحيحة، حفظ</button>
                      <button style={{ ...S.btnSm }} onClick={() => setAnomalyWarning(false)}>مراجعة</button>
                    </div>
                  </div>
                )}

                <button style={{ ...S.btnPrimary, width: '100%' }} onClick={() => submitEntry()} disabled={saving}>
                  {saving ? '⟳ جاري الحفظ...' : `💾 حفظ البيانات — ${getMerchantName(selMerchant)} · ${getPlatformLabel(selPlatform)}`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: HISTORY ── */}
        {tab === 'history' && (
          <div>
            <div style={S.sectionTitle}>السجل والتعديل — آخر 100 إدخال</div>
            {history.length === 0 ? (
              <div style={S.empty}>لا توجد إدخالات بعد</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map(rec => (
                  <div key={rec.id} style={{ ...S.card, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{getMerchantName(rec.merchant_code)}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: getPlatformColor(rec.platform) }}>{getPlatformLabel(rec.platform)}</span>
                          {rec.is_edited && <span style={{ fontSize: 10, color: '#ffd166', background: 'rgba(255,209,102,0.15)', padding: '1px 7px', borderRadius: 6 }}>معدّل</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                          {rec.product_name && <span style={{ marginLeft: 8 }}>{rec.product_name}</span>}
                          <span style={{ color: 'var(--text3)' }}>{rec.data_date || rec.created_at?.split('T')[0]}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12 }}>
                          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{Number(rec.total_sales).toLocaleString()} ر.س</span>
                          <span style={{ color: 'var(--text3)' }}>{rec.order_count} طلب</span>
                          {rec.platform_fees > 0 && <span style={{ color: 'var(--red)' }}>رسوم: {Number(rec.platform_fees).toLocaleString()}</span>}
                          {rec.notes && <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>{rec.notes}</span>}
                        </div>
                      </div>
                      <button
                        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                        onClick={() => setEditRecord({ ...rec })}
                      >تعديل</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editRecord && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '22px 20px', width: '100%', maxWidth: 380 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>تعديل إدخال</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>
              {getMerchantName(editRecord.merchant_code)} · {getPlatformLabel(editRecord.platform)} · {editRecord.data_date}
              {editRecord.product_name && ` · ${editRecord.product_name}`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'المبيعات (ر.س)', key: 'total_sales' },
                { label: 'عدد الطلبات', key: 'order_count' },
                { label: 'رسوم المنصة', key: 'platform_fees' },
                { label: 'الإنفاق الإعلاني', key: 'ad_spend' },
              ].map(f => (
                <div key={f.key} style={S.field}>
                  <span style={S.label}>{f.label}</span>
                  <input type="number" min="0" style={S.input}
                    value={editRecord[f.key]}
                    onChange={e => setEditRecord((r: any) => ({ ...r, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div style={S.field}>
              <span style={S.label}>ملاحظة التعديل</span>
              <input style={S.input} value={editRecord.notes || ''} onChange={e => setEditRecord((r: any) => ({ ...r, notes: e.target.value }))} placeholder="سبب التعديل..." />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button style={{ ...S.btnPrimary, flex: 1 }} onClick={saveEdit} disabled={editSaving}>{editSaving ? '⟳' : '✓ حفظ التعديل'}</button>
              <button style={{ ...S.btnSecondary, flex: 1 }} onClick={() => setEditRecord(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  header: { position: 'sticky', top: 0, zIndex: 50, background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' },
  logo: { width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg, var(--accent), var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0 },
  logoutBtn: { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer' },
  tabs: { display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 52, zIndex: 40 },
  tab: { flex: 1, padding: '12px 6px', background: 'transparent', border: 'none', color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'inherit' },
  tabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  tabBadge: { background: '#ff4d6d', color: '#fff', fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 10 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text2)', marginBottom: 14 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 },
  label: { fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.4px' },
  input: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px', color: 'var(--text)', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  btnPrimary: { background: 'var(--accent2)', color: '#111', border: 'none', padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  btnSecondary: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnSm: { background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  empty: { padding: '40px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 },
}

// ─── Employee Tasks Tab ───────────────────────────────────────────────────────
function EmployeeTasksTab({ employeeCode }: { employeeCode: string }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'done'>('all')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('merchant_requests').select('*')
      .eq('assigned_to', employeeCode).order('priority', { ascending: false }).order('created_at', { ascending: false })
    setTasks(data || [])
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [employeeCode])

  async function updateStatus(id: string, status: string) {
    await supabase.from('merchant_requests').update({ status, updated_at: new Date().toISOString(),
      ...(status === 'done' ? { resolved_at: new Date().toISOString() } : {})
    }).eq('id', id)
    load()
  }

  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter)
  const STATUSES: any = {
    pending:     { label: '⏳ بانتظار', color: '#ffd166' },
    in_progress: { label: '⚙ تنفيذ', color: '#7c6bff' },
    review:      { label: '👀 مراجعة', color: '#4cc9f0' },
    blocked:     { label: '⛔ متوقف', color: '#e84040' },
    done:        { label: '✓ تم', color: '#00b894' },
  }
  const PRIORITIES: any = { urgent: '#e84040', high: '#ff9900', medium: '#7c6bff', low: '#888' }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { v: 'all',         l: `الكل (${tasks.length})` },
          { v: 'pending',     l: `بانتظار (${tasks.filter(t => t.status === 'pending').length})` },
          { v: 'in_progress', l: `قيد التنفيذ (${tasks.filter(t => t.status === 'in_progress').length})` },
          { v: 'done',        l: `مكتمل (${tasks.filter(t => t.status === 'done').length})` },
        ].map(b => (
          <button key={b.v} onClick={() => setFilter(b.v as any)} style={{
            padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            background: filter === b.v ? 'var(--accent)' : 'var(--surface2)',
            color: filter === b.v ? '#fff' : 'var(--text2)',
          }}>{b.l}</button>
        ))}
      </div>

      {loading ? null : filtered.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)' }}>📭 لا توجد مهام مُسنَدة لك</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(t => {
            const sm = STATUSES[t.status]
            const isOverdue = t.due_date && new Date(t.due_date) < new Date() && !['done','rejected'].includes(t.status)
            return (
              <div key={t.id} style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                padding: 12, borderRight: `3px solid ${PRIORITIES[t.priority] || '#7c6bff'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title || t.note?.slice(0, 60)}</div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: sm?.color + '20', color: sm?.color }}>{sm?.label}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>
                  {t.merchant_code} {t.platform && ` · ${t.platform}`}
                  {isOverdue && <span style={{ color: '#e84040', fontWeight: 700, marginRight: 6 }}>⚠ متأخرة</span>}
                </div>
                {t.note && <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.6 }}>{t.note}</div>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {t.status === 'pending'     && <button onClick={() => updateStatus(t.id, 'in_progress')} style={btnA('#7c6bff')}>▶ ابدأ</button>}
                  {t.status === 'in_progress' && <button onClick={() => updateStatus(t.id, 'review')}      style={btnA('#4cc9f0')}>👀 للمراجعة</button>}
                  {(t.status === 'in_progress' || t.status === 'review') && <button onClick={() => updateStatus(t.id, 'done')} style={btnA('#00b894')}>✓ تم</button>}
                  {t.status !== 'blocked' && t.status !== 'done' && <button onClick={() => updateStatus(t.id, 'blocked')} style={btnA('#e84040')}>⛔ متوقف</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function btnA(color: string): React.CSSProperties {
  return { background: color, border: 'none', color: '#fff', padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
}
