import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import type { Merchant } from '../lib/supabase'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  amazon:   { label: 'أمازون',    color: '#ff9900' },
  noon:     { label: 'نون',       color: '#f5c518' },
  trendyol: { label: 'تراندايول', color: '#f27a1a' },
}

function fmt(v: number) { return v.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر.س' }
function fmtPct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%' }

export default function Statement({ merchant }: { merchant: Merchant | null }) {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [perfData, setPerfData]     = useState<any[]>([])
  const [returns, setReturns]       = useState<any[]>([])
  const [targets, setTargets]       = useState<any[]>([])
  const [commRate, setCommRate]     = useState(5)   // Sellpert commission %
  const [loading, setLoading]       = useState(true)
  const isMobile = useMobile()

  useEffect(() => { if (merchant) load() }, [merchant, year, month])

  async function load() {
    setLoading(true)
    const start = `${year}-${String(month).padStart(2,'0')}-01`
    const endDate = new Date(year, month, 0)
    const end   = `${year}-${String(month).padStart(2,'0')}-${endDate.getDate()}`

    const [{ data: perf }, { data: rets }, { data: tgts }, { data: merch }] = await Promise.all([
      supabase.from('performance_data').select('*')
        .eq('merchant_code', merchant!.merchant_code)
        .gte('data_date', start).lte('data_date', end),
      supabase.from('returns').select('*')
        .eq('merchant_code', merchant!.merchant_code)
        .gte('return_date', start).lte('return_date', end),
      supabase.from('sales_targets').select('*')
        .eq('merchant_code', merchant!.merchant_code)
        .eq('year', year).eq('month', month),
      supabase.from('merchants').select('sellpert_commission_rate')
        .eq('merchant_code', merchant!.merchant_code).maybeSingle(),
    ])
    setPerfData(perf || [])
    setReturns(rets || [])
    setTargets(tgts || [])
    setCommRate((merch as any)?.sellpert_commission_rate ?? 5)
    setLoading(false)
  }

  // ── Computed ──────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const grossRevenue  = perfData.reduce((s, r) => s + r.total_sales, 0)
    const platformFees  = perfData.reduce((s, r) => s + (r.platform_fees || 0), 0)
    const adSpend       = perfData.reduce((s, r) => s + (r.ad_spend || 0), 0)
    const totalReturns  = returns.reduce((s, r) => s + (r.return_amount || 0), 0)
    const afterFees     = grossRevenue - platformFees - adSpend - totalReturns
    const sellpertComm  = Math.round(grossRevenue * commRate / 100)
    const netPayout     = afterFees - sellpertComm
    const margin        = grossRevenue > 0 ? (netPayout / grossRevenue * 100) : 0
    const totalOrders   = perfData.reduce((s, r) => s + r.order_count, 0)
    return { grossRevenue, platformFees, adSpend, totalReturns, afterFees, sellpertComm, netPayout, margin, totalOrders }
  }, [perfData, returns, commRate])

  // Per-platform breakdown
  const byPlatform = useMemo(() => {
    const map: Record<string, { revenue: number; fees: number; ad: number; orders: number; returns: number }> = {}
    for (const r of perfData) {
      if (!map[r.platform]) map[r.platform] = { revenue: 0, fees: 0, ad: 0, orders: 0, returns: 0 }
      map[r.platform].revenue += r.total_sales
      map[r.platform].fees   += r.platform_fees || 0
      map[r.platform].ad     += r.ad_spend || 0
      map[r.platform].orders += r.order_count
    }
    for (const r of returns) {
      if (!map[r.platform]) map[r.platform] = { revenue: 0, fees: 0, ad: 0, orders: 0, returns: 0 }
      map[r.platform].returns += r.return_amount || 0
    }
    return map
  }, [perfData, returns])

  // Daily trend for chart
  const dailyTrend = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of perfData) {
      const d = r.data_date || r.created_at?.split('T')[0]
      if (d) map[d] = (map[d] || 0) + r.total_sales
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, rev]) => ({
      date: new Date(date).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }),
      rev: Math.round(rev),
    }))
  }, [perfData])

  // Month target
  const monthTarget = targets.find(t => t.platform === 'all')?.target_amount || 0
  const targetPct   = monthTarget > 0 ? Math.min((summary.grossRevenue / monthTarget) * 100, 100) : 0

  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
    if (isCurrentMonth) return
    if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ padding: isMobile ? '16px' : '28px 32px', maxWidth: 960, margin: '0 auto' }}>

      {/* Header + month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>كشف الحساب</h2>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>ملخص مالي شهري — الإيرادات والرسوم والصافي</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '6px 12px' }}>
          <button style={S.navBtn} onClick={prevMonth}>›</button>
          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 110, textAlign: 'center' }}>
            {MONTHS[month - 1]} {year}
          </span>
          <button style={{ ...S.navBtn, opacity: year === now.getFullYear() && month === now.getMonth() + 1 ? 0.3 : 1 }} onClick={nextMonth}>‹</button>
        </div>
      </div>

      {perfData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text3)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>لا توجد بيانات لهذا الشهر</div>
          <div style={{ fontSize: 13 }}>لم يتم إدخال مبيعات لـ {MONTHS[month-1]} {year}</div>
        </div>
      ) : (
        <>
          {/* Target progress */}
          {monthTarget > 0 && (
            <div style={{ ...S.card, marginBottom: 16, padding: '14px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>🎯 الهدف الشهري</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: targetPct >= 100 ? 'var(--accent2)' : 'var(--accent)' }}>
                  {fmt(summary.grossRevenue)} / {fmt(monthTarget)} ({targetPct.toFixed(0)}%)
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 8, background: 'var(--surface2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${targetPct}%`, background: targetPct >= 100 ? 'var(--accent2)' : 'var(--accent)', borderRadius: 8, transition: 'width 0.8s ease' }} />
              </div>
            </div>
          )}

          {/* Summary KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'إجمالي المبيعات',   value: fmt(summary.grossRevenue), color: '#7c6bff', icon: '💰', sub: `${summary.totalOrders} طلب` },
              { label: 'رسوم وإعلانات',      value: fmt(summary.platformFees + summary.adSpend), color: '#ff4d6d', icon: '📤', sub: `${((summary.platformFees + summary.adSpend) / (summary.grossRevenue || 1) * 100).toFixed(1)}% من الإيراد` },
              { label: 'عمولة Sellpert',     value: fmt(summary.sellpertComm), color: '#f27a1a', icon: '🏷️', sub: `${commRate}% من الإيراد` },
              { label: 'الصافي للتحويل',     value: fmt(summary.netPayout), color: summary.netPayout >= 0 ? '#00e5b0' : '#ff4d6d', icon: '✅', sub: `هامش ${summary.margin.toFixed(1)}%` },
            ].map((k, i) => (
              <div key={i} style={{ ...S.card, padding: 16, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color, borderRadius: '12px 12px 0 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
                  <span style={{ fontSize: 18 }}>{k.icon}</span>
                </div>
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: k.color, letterSpacing: '-0.5px' }}>{k.value}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Detailed breakdown */}
          <div style={{ ...S.card, marginBottom: 20, overflow: 'hidden', padding: 0 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
              📊 تفصيل الحساب
            </div>
            <div style={{ padding: '20px' }}>
              {[
                { label: 'إجمالي المبيعات الخام',   value: summary.grossRevenue,  color: 'var(--accent)', sign: '' },
                { label: 'رسوم المنصات',              value: -summary.platformFees, color: '#ff4d6d', sign: '−' },
                { label: 'الإنفاق الإعلاني',          value: -summary.adSpend,      color: '#ff4d6d', sign: '−' },
                { label: 'قيمة المرتجعات',            value: -summary.totalReturns, color: '#ffd166', sign: '−' },
                null, // divider
                { label: 'الإيراد قبل عمولة Sellpert', value: summary.afterFees, color: 'var(--text)', sign: '', bold: true },
                { label: `عمولة Sellpert (${commRate}%)`, value: -summary.sellpertComm, color: '#f27a1a', sign: '−' },
                null,
                { label: 'الصافي المستحق للتحويل',    value: summary.netPayout,     color: summary.netPayout >= 0 ? 'var(--accent2)' : '#ff4d6d', sign: '', bold: true, large: true },
              ].map((row, i) => row === null ? (
                <div key={i} style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
              ) : (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
                  <span style={{ fontSize: row.bold ? 13 : 12, fontWeight: row.bold ? 700 : 500, color: row.bold ? 'var(--text)' : 'var(--text2)' }}>{row.label}</span>
                  <span style={{ fontSize: row.large ? 20 : row.bold ? 14 : 13, fontWeight: row.bold ? 800 : 600, color: row.color, fontFamily: 'monospace' }}>
                    {row.sign}{fmt(Math.abs(row.value))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Per-platform table */}
          {Object.keys(byPlatform).length > 0 && (
            <div style={{ ...S.card, marginBottom: 20, overflow: 'hidden', padding: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                🏪 تفصيل المنصات
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['المنصة', 'الإيرادات', 'رسوم المنصة', 'الإعلانات', 'المرتجعات', 'الطلبات', 'الصافي'].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(byPlatform).map(([p, d]) => {
                      const net = d.revenue - d.fees - d.ad - d.returns
                      const meta = PLATFORM_META[p]
                      return (
                        <tr key={p} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={S.td}><span style={{ color: meta?.color, fontWeight: 700 }}>{meta?.label || p}</span></td>
                          <td style={{ ...S.td, color: 'var(--accent)', fontWeight: 700 }}>{fmt(d.revenue)}</td>
                          <td style={{ ...S.td, color: '#ff4d6d' }}>{d.fees > 0 ? fmt(d.fees) : '—'}</td>
                          <td style={{ ...S.td, color: '#ff4d6d' }}>{d.ad > 0 ? fmt(d.ad) : '—'}</td>
                          <td style={{ ...S.td, color: '#ffd166' }}>{d.returns > 0 ? fmt(d.returns) : '—'}</td>
                          <td style={S.td}>{d.orders.toLocaleString()}</td>
                          <td style={{ ...S.td, color: net >= 0 ? 'var(--accent2)' : '#ff4d6d', fontWeight: 700 }}>{fmt(net)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily trend chart */}
          {dailyTrend.length > 1 && (
            <div style={{ ...S.card, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>📈 المبيعات اليومية</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={dailyTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="stmtGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7c6bff" stopOpacity={0.35}/>
                      <stop offset="95%" stopColor="#7c6bff" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(0)+'k' : v} />
                  <Tooltip contentStyle={{ background: '#12121f', border: '1px solid #2d2d4a', borderRadius: 10, fontSize: 12 }} formatter={(v: number) => [fmt(v), 'المبيعات']} />
                  <Area type="monotone" dataKey="rev" stroke="#7c6bff" strokeWidth={2.5} fill="url(#stmtGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Account transactions ledger */}
          <TransactionsLedger merchant={merchant} month={month} year={year} />

          {/* Returns analytics */}
          <ReturnsAnalytics merchant={merchant} grossRevenue={summary.grossRevenue} />

          {/* Returns section */}
          <ReturnsSection merchant={merchant} month={month} year={year} onUpdate={load} />
        </>
      )}
    </div>
  )
}

// ── Account Transactions Ledger ──────────────────────────────────────────────
function TransactionsLedger({ merchant, month, year }: { merchant: Merchant | null; month: number; year: number }) {
  const [tx, setTx] = useState<any[]>([])
  const [filter, setFilter] = useState<'all' | 'amazon' | 'trendyol'>('all')
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (merchant) loadTx() /* eslint-disable-line */ }, [merchant?.merchant_code, month, year])
  async function loadTx() {
    if (!merchant) return
    setLoading(true)
    const start = `${year}-${String(month).padStart(2,'0')}-01`
    const endDate = new Date(year, month, 0)
    const end   = `${year}-${String(month).padStart(2,'0')}-${endDate.getDate()}T23:59:59`
    const { data } = await supabase.from('account_transactions')
      .select('platform, transaction_date, transaction_type, order_id, description, debit, credit, net_amount, currency, amount_description')
      .eq('merchant_code', merchant.merchant_code)
      .gte('transaction_date', start).lte('transaction_date', end)
      .order('transaction_date', { ascending: false })
      .limit(500)
    setTx(data || [])
    setLoading(false)
  }
  const filtered = filter === 'all' ? tx : tx.filter(r => r.platform === filter)
  const totals = useMemo(() => filtered.reduce((a, r) => ({
    debit: a.debit + (Number(r.debit) || 0),
    credit: a.credit + (Number(r.credit) || 0),
    net: a.net + (Number(r.net_amount) || 0),
  }), { debit: 0, credit: 0, net: 0 }), [filtered])

  if (loading) return null
  if (tx.length === 0) return null

  return (
    <div style={{ ...S.card, marginBottom: 20, overflow: 'hidden', padding: 0 }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>🧾 كشف المعاملات المالية ({filtered.length})</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'amazon', 'trendyol'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', background: filter === f ? 'var(--accent)' : 'var(--surface2)',
              color: filter === f ? '#fff' : 'var(--text2)',
            }}>
              {f === 'all' ? 'الكل' : f === 'amazon' ? 'أمازون' : 'تراندايول'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: '12px 20px', display: 'flex', gap: 24, fontSize: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span>الدائن: <b style={{ color: '#00e5b0' }}>{fmt(totals.credit)}</b></span>
        <span>المدين: <b style={{ color: '#ff4d6d' }}>{fmt(totals.debit)}</b></span>
        <span>الصافي: <b style={{ color: totals.net >= 0 ? '#00e5b0' : '#ff4d6d' }}>{fmt(totals.net)}</b></span>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)' }}>
            <tr>
              {['التاريخ', 'المنصة', 'النوع', 'الوصف', 'رقم الطلب', 'مدين', 'دائن', 'الصافي'].map(h => (
                <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const d = r.transaction_date ? new Date(r.transaction_date).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' }) : '—'
              const meta = PLATFORM_META[r.platform]
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...S.td, fontSize: 11, whiteSpace: 'nowrap' }}>{d}</td>
                  <td style={{ ...S.td, fontSize: 11, color: meta?.color, fontWeight: 700 }}>{meta?.label || r.platform}</td>
                  <td style={{ ...S.td, fontSize: 11 }}>{r.transaction_type || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }} title={r.description || ''}>{r.description || r.amount_description || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>{r.order_id || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#ff4d6d', fontFamily: 'monospace' }}>{r.debit > 0 ? r.debit.toLocaleString() : '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#00e5b0', fontFamily: 'monospace' }}>{r.credit > 0 ? r.credit.toLocaleString() : '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, fontWeight: 700, color: r.net_amount >= 0 ? 'var(--text)' : '#ff4d6d', fontFamily: 'monospace' }}>{Number(r.net_amount || 0).toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Returns analytics ─────────────────────────────────────────────────────────
function ReturnsAnalytics({ merchant, grossRevenue }: { merchant: Merchant | null; grossRevenue: number }) {
  const [data, setData] = useState<any[]>([])
  const [orderCount, setOrderCount] = useState(0)
  const [commissionByPlatform, setCommissionByPlatform] = useState<Record<string, number>>({})
  const [shippingByPlatform, setShippingByPlatform] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])
  async function load() {
    if (!merchant) return
    setLoading(true)
    const [{ data: rows }, { count }, { data: rates }] = await Promise.all([
      supabase.from('returns').select('*').eq('merchant_code', merchant.merchant_code),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('merchant_code', merchant.merchant_code),
      supabase.from('platform_commission_rates').select('platform, rate, shipping_fee'),
    ])
    setData(rows || [])
    setOrderCount(count || 0)
    const cm: Record<string, number> = {}, sh: Record<string, number> = {}
    for (const r of (rates || [])) { cm[r.platform] = Number(r.rate) || 0; sh[r.platform] = Number(r.shipping_fee) || 0 }
    setCommissionByPlatform(cm); setShippingByPlatform(sh)
    setLoading(false)
  }

  const stats = useMemo(() => {
    const total = data.reduce((a, r) => a + (Number(r.return_amount) || 0), 0)
    const count = data.length
    const refunded = data.filter(r => r.status === 'refunded' || r.status === 'processed').length
    const pending  = data.filter(r => r.status === 'pending').length
    const rateOfRevenue = grossRevenue > 0 ? (total / grossRevenue) * 100 : 0
    const rateOfOrders  = orderCount > 0 ? (count / orderCount) * 100 : 0

    // الخسائر المتكبدة = العمولات + الشحن على القيم المرتجعة
    let lossFees = 0, lossShipping = 0
    for (const r of data) {
      const cmRate = commissionByPlatform[r.platform] || 12  // افتراضي 12%
      const shFee  = shippingByPlatform[r.platform] || 0
      const ret    = Number(r.return_amount) || 0
      const qty    = Number(r.quantity) || 1
      lossFees     += (ret * cmRate) / 100
      lossShipping += shFee * qty
    }
    const lossTotal = lossFees + lossShipping
    return { total, count, refunded, pending, rateOfRevenue, rateOfOrders, lossFees, lossShipping, lossTotal }
  }, [data, grossRevenue, orderCount, commissionByPlatform, shippingByPlatform])

  const byPlatform = useMemo(() => {
    const m: Record<string, { count: number; amount: number }> = {}
    for (const r of data) {
      if (!m[r.platform]) m[r.platform] = { count: 0, amount: 0 }
      m[r.platform].count += 1
      m[r.platform].amount += Number(r.return_amount) || 0
    }
    return Object.entries(m).map(([p, v]) => ({ platform: p, ...v })).sort((a, b) => b.amount - a.amount)
  }, [data])

  const topReasons = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of data) {
      const k = r.reason || 'غير محدّد'
      m[k] = (m[k] || 0) + 1
    }
    return Object.entries(m).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [data])

  const topProducts = useMemo(() => {
    const m: Record<string, { count: number; amount: number }> = {}
    for (const r of data) {
      const k = r.product_name || 'غير محدّد'
      if (!m[k]) m[k] = { count: 0, amount: 0 }
      m[k].count += 1
      m[k].amount += Number(r.return_amount) || 0
    }
    return Object.entries(m).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [data])

  if (loading || data.length === 0) return null

  return (
    <div style={{ ...S.card, marginBottom: 20, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
        📊 تحليل المرتجعات
      </div>
      <div style={{ padding: 20 }}>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
          <StatCard label="عدد المرتجعات" value={stats.count.toString()} sub={`من ${orderCount} طلب`} color="#ffd166" />
          <StatCard label="نسبة الإرجاع" value={stats.rateOfOrders.toFixed(1) + '%'} sub={stats.rateOfOrders > 10 ? '⚠ مرتفعة' : stats.rateOfOrders > 5 ? 'متوسطة' : 'طبيعية'} color={stats.rateOfOrders > 10 ? '#e84040' : stats.rateOfOrders > 5 ? '#ff9900' : '#00b894'} />
          <StatCard label="القيمة المرتجعة" value={fmt(stats.total)} sub={stats.rateOfRevenue.toFixed(1) + '% من الإيراد'} color="#e84040" />
          <StatCard label="الخسائر المتكبدة" value={fmt(stats.lossTotal)} sub={`عمولة ${fmt(stats.lossFees)} · شحن ${fmt(stats.lossShipping)}`} color="#ff4d6d" />
          <StatCard label="مُسترد" value={stats.refunded.toString()} sub={stats.pending > 0 ? `${stats.pending} قيد المراجعة` : 'مكتمل'} color="#7c6bff" />
        </div>

        {/* By platform */}
        {byPlatform.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 10 }}>المرتجعات حسب المنصة</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byPlatform.map(p => {
                const meta = PLATFORM_META[p.platform]
                const pct = stats.total > 0 ? (p.amount / stats.total) * 100 : 0
                return (
                  <div key={p.platform} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ minWidth: 80, fontSize: 12, fontWeight: 700, color: meta?.color || 'var(--text)' }}>{meta?.label || p.platform}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: meta?.color || 'var(--accent)', borderRadius: 4, transition: 'width 0.6s' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text3)', minWidth: 50, textAlign: 'left' }}>{p.count} مرتجع</span>
                    <span style={{ fontSize: 12, fontWeight: 700, minWidth: 90, textAlign: 'left' }}>{fmt(p.amount)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Top products + reasons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {topProducts.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>🏷️ أكثر المنتجات إرجاعاً</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topProducts.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={p.name}>{p.name}</span>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <span style={{ color: 'var(--text3)' }}>{p.count}×</span>
                      <span style={{ fontWeight: 700, color: '#e84040' }}>{fmt(p.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topReasons.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>🔍 أكثر الأسباب</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topReasons.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 12 }}>
                    <span>{r.reason}</span>
                    <span style={{ fontWeight: 700, color: '#ffd166' }}>{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ── Returns mini-section ──────────────────────────────────────────────────────

function ReturnsSection({ merchant, month, year, onUpdate }: { merchant: Merchant | null; month: number; year: number; onUpdate: () => void }) {
  const [returns, setReturns] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ platform: 'amazon', order_id: '', product_name: '', quantity: '1', return_amount: '', reason: '', return_date: new Date().toISOString().split('T')[0], status: 'pending' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadReturns() }, [month, year])

  async function loadReturns() {
    const start = `${year}-${String(month).padStart(2,'0')}-01`
    const end = new Date(year, month, 0).toISOString().split('T')[0]
    const { data } = await supabase.from('returns').select('*').eq('merchant_code', merchant!.merchant_code).gte('return_date', start).lte('return_date', end).order('created_at', { ascending: false })
    setReturns(data || [])
  }

  async function addReturn() {
    if (!form.return_amount) return
    setSaving(true)
    await supabase.from('returns').insert({
      merchant_code: merchant!.merchant_code,
      platform: form.platform,
      order_id: form.order_id || null,
      product_name: form.product_name || null,
      quantity: parseInt(form.quantity) || 1,
      return_amount: parseFloat(form.return_amount) || 0,
      reason: form.reason || null,
      return_date: form.return_date,
      status: form.status,
    })
    setSaving(false)
    setShowForm(false)
    setForm(f => ({ ...f, order_id: '', product_name: '', quantity: '1', return_amount: '', reason: '' }))
    loadReturns()
    onUpdate()
  }

  const totalReturns = returns.reduce((s, r) => s + r.return_amount, 0)

  return (
    <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>↩️ المرتجعات</span>
          {returns.length > 0 && <span style={{ fontSize: 12, color: '#ffd166', marginRight: 10 }}>إجمالي: {fmt(totalReturns)}</span>}
        </div>
        <button style={S.addBtn} onClick={() => setShowForm(v => !v)}>{showForm ? '✕ إلغاء' : '+ إضافة مرتجع'}</button>
      </div>

      {showForm && (
        <div style={{ padding: '16px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
            {[
              { label: 'المنصة', key: 'platform', type: 'select', opts: ['amazon','noon','trendyol'] },
              { label: 'رقم الطلب', key: 'order_id', type: 'text', placeholder: 'اختياري' },
              { label: 'اسم المنتج', key: 'product_name', type: 'text', placeholder: 'اختياري' },
              { label: 'الكمية', key: 'quantity', type: 'number', placeholder: '1' },
              { label: 'مبلغ المرتجع (ر.س) *', key: 'return_amount', type: 'number', placeholder: '0' },
              { label: 'تاريخ المرتجع', key: 'return_date', type: 'date', placeholder: '' },
              { label: 'الحالة', key: 'status', type: 'select', opts: ['pending','approved','refunded'] },
              { label: 'السبب', key: 'reason', type: 'text', placeholder: 'اختياري' },
            ].map(f => (
              <div key={f.key}>
                <label style={S.label}>{f.label}</label>
                {f.type === 'select' ? (
                  <select style={S.input} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}>
                    {f.opts!.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input style={S.input} type={f.type} placeholder={f.placeholder} value={(form as any)[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
          <button style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }} onClick={addReturn} disabled={saving}>
            {saving ? '...' : '✓ حفظ المرتجع'}
          </button>
        </div>
      )}

      {returns.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>لا توجد مرتجعات هذا الشهر</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['التاريخ','المنصة','المنتج','الكمية','المبلغ','الحالة'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {returns.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ ...S.td, fontSize: 11 }}>{r.return_date}</td>
                  <td style={{ ...S.td, color: PLATFORM_META[r.platform]?.color, fontWeight: 700 }}>{PLATFORM_META[r.platform]?.label || r.platform}</td>
                  <td style={{ ...S.td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name || '—'}</td>
                  <td style={S.td}>{r.quantity}</td>
                  <td style={{ ...S.td, color: '#ffd166', fontWeight: 700 }}>{fmt(r.return_amount)}</td>
                  <td style={S.td}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: r.status === 'refunded' ? 'rgba(0,229,176,0.12)' : r.status === 'approved' ? 'rgba(124,107,255,0.12)' : 'rgba(255,209,102,0.12)', color: r.status === 'refunded' ? 'var(--accent2)' : r.status === 'approved' ? 'var(--accent)' : '#ffd166' }}>
                      {r.status === 'refunded' ? 'مسترد' : r.status === 'approved' ? 'موافق' : 'قيد المراجعة'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  card:   { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 },
  navBtn: { background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px', fontWeight: 800 },
  th:     { padding: '10px 16px', textAlign: 'right' as const, fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const },
  td:     { padding: '11px 16px', fontSize: 13 },
  label:  { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text3)', marginBottom: 5, textTransform: 'uppercase' as const },
  input:  { width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  addBtn: { background: 'var(--accent)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' },
}

