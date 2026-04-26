import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useMobile } from '../lib/hooks'
import type { Merchant, Order, OrderStatus } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'

const ORDER_PAGE_SIZE = 50
const STATUS_MAP: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending:    { label: 'معلق',      color: '#ffd166', bg: 'rgba(255,209,102,0.15)' },
  processing: { label: 'قيد التنفيذ', color: '#4cc9f0', bg: 'rgba(76,201,240,0.15)' },
  shipped:    { label: 'تم الشحن',  color: '#7c6bff', bg: 'rgba(124,107,255,0.15)' },
  delivered:  { label: 'تم التسليم', color: '#00e5b0', bg: 'rgba(0,229,176,0.15)' },
  cancelled:  { label: 'ملغي',      color: '#ff4d6d', bg: 'rgba(255,77,109,0.15)' },
  returned:   { label: 'مُرتجع',   color: '#ff9900', bg: 'rgba(255,153,0,0.15)' },
}

function fmt(v: number) { return v.toLocaleString('ar-SA', { maximumFractionDigits: 0 }) + ' ر.س' }

export default function Orders({ merchant }: { merchant: Merchant | null }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState('all')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [preset, setPreset] = useState('last30')
  const [tab, setTab] = useState<'list' | 'compare' | 'chart'>('list')
  const [orderPage, setOrderPage] = useState(0)
  const isMobile = useMobile()

  useEffect(() => {
    if (!merchant) return
    supabase
      .from('orders')
      .select('*')
      .eq('merchant_code', merchant.merchant_code)
      .order('order_date', { ascending: false })
      .limit(2000)
      .then(({ data }) => { setOrders(data || []); setLoading(false) })
  }, [merchant])

  const filtered = useMemo(() => {
    setOrderPage(0)
    let d = orders
    if (platform !== 'all') d = d.filter(o => o.platform === platform)
    if (status !== 'all') d = d.filter(o => o.status === status)
    if (search.trim()) {
      const q = search.toLowerCase()
      d = d.filter(o =>
        o.order_id.toLowerCase().includes(q) ||
        o.product_name?.toLowerCase().includes(q) ||
        o.customer_city?.toLowerCase().includes(q)
      )
    }
    const now = Date.now()
    if (preset === 'today') d = d.filter(o => new Date(o.order_date).toDateString() === new Date().toDateString())
    else if (preset === 'last7')  d = d.filter(o => new Date(o.order_date).getTime() >= now - 7 * 86400000)
    else if (preset === 'last30') d = d.filter(o => new Date(o.order_date).getTime() >= now - 30 * 86400000)
    else if (preset === 'thisMonth') {
      const s = new Date(); s.setDate(1); s.setHours(0,0,0,0)
      d = d.filter(o => new Date(o.order_date) >= s)
    }
    return d
  }, [orders, platform, status, search, preset])

  const totalPages = Math.ceil(filtered.length / ORDER_PAGE_SIZE)
  const pageRows   = filtered.slice(orderPage * ORDER_PAGE_SIZE, (orderPage + 1) * ORDER_PAGE_SIZE)

  // KPIs
  const totalRevenue  = filtered.reduce((s, o) => s + o.total_amount, 0)
  const totalOrders   = filtered.length
  const deliveredCount = filtered.filter(o => o.status === 'delivered').length
  const cancelRate    = totalOrders > 0 ? (filtered.filter(o => o.status === 'cancelled').length / totalOrders) * 100 : 0
  const aov           = totalOrders > 0 ? totalRevenue / totalOrders : 0

  // Chart: orders per day
  const dailyData = useMemo(() => {
    const map: Record<string, { revenue: number; count: number }> = {}
    for (const o of filtered) {
      const d = o.order_date.split('T')[0]
      if (!map[d]) map[d] = { revenue: 0, count: 0 }
      map[d].revenue += o.total_amount
      map[d].count++
    }
    return Object.entries(map).sort(([a],[b]) => a.localeCompare(b)).slice(-30).map(([date, v]) => ({
      date: new Date(date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }),
      revenue: Math.round(v.revenue), count: v.count,
    }))
  }, [filtered])

  // Compare: per platform
  const platformCompare = useMemo(() => {
    const map: Record<string, { revenue: number; count: number; delivered: number; cancelled: number }> = {}
    for (const o of filtered) {
      if (!map[o.platform]) map[o.platform] = { revenue: 0, count: 0, delivered: 0, cancelled: 0 }
      map[o.platform].revenue += o.total_amount
      map[o.platform].count++
      if (o.status === 'delivered') map[o.platform].delivered++
      if (o.status === 'cancelled') map[o.platform].cancelled++
    }
    return Object.entries(map).map(([p, v]) => ({
      platform: p, name: PLATFORM_MAP[p] || p,
      revenue: Math.round(v.revenue), count: v.count,
      deliveryRate: v.count > 0 ? ((v.delivered / v.count) * 100).toFixed(1) : '0.0',
      cancelRate:   v.count > 0 ? ((v.cancelled / v.count) * 100).toFixed(1) : '0.0',
      aov: v.count > 0 ? Math.round(v.revenue / v.count) : 0,
    })).sort((a,b) => b.revenue - a.revenue)
  }, [filtered])

  const platforms = [...new Set(orders.map(o => o.platform))]

  function exportCSV() {
    const h = ['رقم الطلب','المنصة','المنتج','الحالة','الكمية','المبلغ','رسوم المنصة','المدينة','التاريخ']
    const rows = filtered.map(o => [
      o.order_id, PLATFORM_MAP[o.platform] || o.platform, o.product_name || '',
      STATUS_MAP[o.status]?.label || o.status, o.quantity, o.total_amount,
      o.platform_fee || 0, o.customer_city || '',
      new Date(o.order_date).toLocaleDateString('ar-SA'),
    ])
    const csv = [h, ...rows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `orders-${preset}.csv`; a.click()
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:400 }}>
      <div style={{ width:36, height:36, border:'3px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={S.wrap}>
      {/* TOPBAR */}
      <div style={S.topbar}>
        <div>
          <h2 style={S.pageTitle}>الطلبات</h2>
          <p style={S.pageSub}>{totalOrders.toLocaleString()} طلب في الفترة المحددة</p>
        </div>
        <button style={S.exportBtn} onClick={exportCSV}>⬇ تصدير CSV</button>
      </div>

      {/* FILTERS */}
      <div style={S.filtersRow}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {[
            { k:'today', l:'اليوم' }, { k:'last7', l:'7 أيام' },
            { k:'last30', l:'30 يوم' }, { k:'thisMonth', l:'هذا الشهر' }, { k:'all', l:'الكل' },
          ].map(p => (
            <button key={p.k} style={{ ...S.pill, ...(preset===p.k ? S.pillActive : {}) }} onClick={() => setPreset(p.k)}>{p.l}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <select style={S.select} value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="all">كل المنصات</option>
            {platforms.map(p => <option key={p} value={p}>{PLATFORM_MAP[p] || p}</option>)}
          </select>
          <select style={S.select} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">كل الحالات</option>
            {(Object.keys(STATUS_MAP) as OrderStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_MAP[s].label}</option>
            ))}
          </select>
          <input
            style={{ ...S.select, flex:1, minWidth:200 }}
            placeholder="ابحث برقم الطلب أو المنتج..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* KPIs */}
      <div style={{ ...S.kpisGrid, gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)' }}>
        {[
          { label:'إجمالي الإيراد',   value: fmt(totalRevenue),               icon:'💰', color:'#7c6bff' },
          { label:'عدد الطلبات',      value: totalOrders.toLocaleString(),     icon:'📦', color:'#00e5b0' },
          { label:'متوسط الطلب',      value: fmt(aov),                         icon:'🛒', color:'#ff9900' },
          { label:'تم التسليم',       value: deliveredCount.toLocaleString(),  icon:'✅', color:'#00e5b0' },
          { label:'نسبة الإلغاء',     value: cancelRate.toFixed(1) + '%',      icon:'❌', color:'#ff4d6d' },
        ].map((k,i) => (
          <div key={i} style={S.kpiCard}>
            <div style={{ ...S.kpiBar, background:k.color }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={S.kpiLabel}>{k.label}</span>
              <span style={{ fontSize:18 }}>{k.icon}</span>
            </div>
            <div style={{ ...S.kpiValue, color:k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'1px solid var(--border)', paddingBottom:0 }}>
        {([['list','قائمة الطلبات'], ['compare','مقارنة المنصات'], ['chart','الرسوم البيانية']] as const).map(([k,l]) => (
          <button
            key={k}
            style={{ ...S.tabBtn, ...(tab===k ? S.tabActive : {}) }}
            onClick={() => setTab(k)}
          >{l}</button>
        ))}
      </div>

      {/* TAB: LIST */}
      {tab === 'list' && (
        <div style={S.card}>
          <div style={{ overflowX:'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {['رقم الطلب','المنصة','المنتج','الكمية','المبلغ','رسوم المنصة','المدينة','الحالة','التاريخ'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding:'50px', textAlign:'center', color:'var(--text3)' }}>
                    لا توجد طلبات في هذه الفترة
                  </td></tr>
                ) : pageRows.map(o => (
                  <tr key={o.id} style={S.tr}>
                    <td style={{ ...S.td, fontFamily:'monospace', fontSize:11 }}>{o.order_id}</td>
                    <td style={S.td}>
                      <span style={{ ...S.platformTag, background:(PLATFORM_COLORS[o.platform]||'#5a5a7a')+'22', color:PLATFORM_COLORS[o.platform]||'#5a5a7a' }}>
                        {PLATFORM_MAP[o.platform] || o.platform}
                      </span>
                    </td>
                    <td style={{ ...S.td, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {o.product_name || '—'}
                    </td>
                    <td style={{ ...S.td, textAlign:'center' }}>{o.quantity}</td>
                    <td style={{ ...S.td, fontWeight:700 }}>{fmt(o.total_amount)}</td>
                    <td style={{ ...S.td, color:'var(--text3)' }}>{fmt(o.platform_fee || 0)}</td>
                    <td style={{ ...S.td, color:'var(--text2)', fontSize:12 }}>{o.customer_city || '—'}</td>
                    <td style={S.td}>
                      <span style={{ ...S.statusBadge, background:STATUS_MAP[o.status]?.bg, color:STATUS_MAP[o.status]?.color }}>
                        {STATUS_MAP[o.status]?.label || o.status}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontSize:11, color:'var(--text3)' }}>
                      {new Date(o.order_date).toLocaleDateString('ar-SA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderTop:'1px solid var(--border)' }}>
              <span style={{ fontSize:12, color:'var(--text3)' }}>
                {orderPage * ORDER_PAGE_SIZE + 1}–{Math.min((orderPage + 1) * ORDER_PAGE_SIZE, filtered.length)} من {filtered.length.toLocaleString()} طلب
              </span>
              <div style={{ display:'flex', gap:8 }}>
                <button
                  onClick={() => setOrderPage(p => Math.max(0, p - 1))}
                  disabled={orderPage === 0}
                  style={{ ...S.pageBtn, opacity: orderPage === 0 ? 0.4 : 1 }}
                >›</button>
                <span style={{ fontSize:12, color:'var(--text2)', padding:'0 4px', alignSelf:'center' }}>
                  {orderPage + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setOrderPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={orderPage >= totalPages - 1}
                  style={{ ...S.pageBtn, opacity: orderPage >= totalPages - 1 ? 0.4 : 1 }}
                >‹</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: COMPARE */}
      {tab === 'compare' && (
        <div>
          {platformCompare.length === 0 ? (
            <div style={{ ...S.card, padding:50, textAlign:'center', color:'var(--text3)' }}>لا توجد بيانات</div>
          ) : (
            <>
              {/* Platform cards */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:16, marginBottom:20 }}>
                {platformCompare.map(p => (
                  <div key={p.platform} style={{ ...S.card, padding:20, borderTop:`3px solid ${PLATFORM_COLORS[p.platform]||'#7c6bff'}` }}>
                    <div style={{ fontSize:16, fontWeight:800, marginBottom:14, color:PLATFORM_COLORS[p.platform]||'#7c6bff' }}>
                      {p.name}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                      {[
                        { label:'الإيراد',       value: fmt(p.revenue) },
                        { label:'الطلبات',       value: p.count.toLocaleString() },
                        { label:'متوسط الطلب',  value: fmt(p.aov) },
                        { label:'نسبة التسليم',  value: p.deliveryRate + '%' },
                        { label:'نسبة الإلغاء',  value: p.cancelRate + '%' },
                      ].map((item,i) => (
                        <div key={i} style={{ background:'var(--bg)', borderRadius:8, padding:'8px 12px' }}>
                          <div style={{ fontSize:10, color:'var(--text3)', fontWeight:700, marginBottom:3 }}>{item.label}</div>
                          <div style={{ fontSize:14, fontWeight:800, color:'var(--text)' }}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Bar comparison */}
              <div style={{ ...S.card, padding:20 }}>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>مقارنة الإيراد بين المنصات</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={platformCompare} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f2" horizontal={false} />
                    <XAxis type="number" tick={{ fill:'#5a5a7a', fontSize:11 }} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(0)+'k' : String(v)} />
                    <YAxis type="category" dataKey="name" tick={{ fill:'var(--text)', fontSize:12 }} width={70} />
                    <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:10, color:'var(--text)' }} formatter={(v:number) => [fmt(v), 'الإيراد']} />
                    <Bar dataKey="revenue" radius={[0,6,6,0]}>
                      {platformCompare.map((p,i) => (
                        <rect key={i} fill={PLATFORM_COLORS[p.platform]||'#7c6bff'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB: CHART */}
      {tab === 'chart' && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
          <div style={{ ...S.card, padding:20 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>الإيراد اليومي</div>
            {dailyData.length === 0 ? (
              <div style={{ height:200, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)' }}>لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f2" />
                  <XAxis dataKey="date" tick={{ fill:'#5a5a7a', fontSize:10 }} />
                  <YAxis tick={{ fill:'#5a5a7a', fontSize:10 }} tickFormatter={v => v>=1000?(v/1000).toFixed(0)+'k':v} />
                  <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:10, color:'var(--text)' }} formatter={(v:number) => [fmt(v), 'الإيراد']} />
                  <Line type="monotone" dataKey="revenue" stroke="#7c6bff" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div style={{ ...S.card, padding:20 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>عدد الطلبات اليومي</div>
            {dailyData.length === 0 ? (
              <div style={{ height:200, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)' }}>لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f2" />
                  <XAxis dataKey="date" tick={{ fill:'#5a5a7a', fontSize:10 }} />
                  <YAxis tick={{ fill:'#5a5a7a', fontSize:10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:10, color:'var(--text)' }} formatter={(v:number) => [v, 'طلب']} />
                  <Bar dataKey="count" fill="#00e5b0" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:       { padding:'28px 32px', minHeight:'100vh' },
  topbar:     { display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 },
  pageTitle:  { fontSize:24, fontWeight:800, letterSpacing:'-0.5px' },
  pageSub:    { fontSize:13, color:'var(--text2)', marginTop:3 },
  exportBtn:  { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 18px', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer' },
  filtersRow: { display:'flex', flexDirection:'column', gap:10, marginBottom:20 },
  pill:       { padding:'7px 16px', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text2)', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer' },
  pillActive: { background:'var(--accent)', borderColor:'var(--accent)', color:'#fff' },
  select:     { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:9, fontSize:12, outline:'none', cursor:'pointer' },
  kpisGrid:   { display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14, marginBottom:22 },
  kpiCard:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:16, position:'relative', overflow:'hidden' },
  kpiBar:     { position:'absolute', top:0, left:0, right:0, height:3 },
  kpiLabel:   { fontSize:11, color:'var(--text3)', fontWeight:600 },
  kpiValue:   { fontSize:22, fontWeight:800, marginTop:4 },
  tabBtn:     { padding:'10px 20px', background:'transparent', border:'none', color:'var(--text2)', fontSize:13, fontWeight:600, cursor:'pointer', borderBottom:'2px solid transparent', marginBottom:-1 },
  tabActive:  { color:'var(--accent)', borderBottomColor:'var(--accent)' },
  card:       { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', marginBottom:0 },
  table:      { width:'100%', borderCollapse:'collapse' },
  th:         { padding:'10px 16px', textAlign:'right', fontSize:11, fontWeight:700, color:'var(--text3)', background:'var(--surface2)', borderBottom:'1px solid var(--border)' },
  tr:         { borderBottom:'1px solid var(--border)' },
  td:         { padding:'11px 16px', fontSize:13, color:'var(--text)' },
  platformTag:{ padding:'3px 10px', borderRadius:6, fontSize:11, fontWeight:600 },
  statusBadge:{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 },
  pageBtn:    { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', width:32, height:32, borderRadius:8, fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
}

