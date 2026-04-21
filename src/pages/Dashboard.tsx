import { useState, useEffect } from 'react'
import { supabase, type Merchant, type PerformanceData, type AiInsight } from '../lib/supabase'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'

const PLATFORMS = ['الكل', 'تراندايول', 'نون', 'أمازون', 'سلة', 'زد', 'شوبيفاي']
const PLATFORM_MAP: Record<string, string> = {
  trendyol: 'تراندايول', noon: 'نون', amazon: 'أمازون',
  salla: 'سلة', zid: 'زد', shopify: 'شوبيفاي', other: 'أخرى'
}
const PLATFORM_COLORS = ['#f27a1a', '#ffe600', '#ff9900', '#7c6bff', '#00e5b0', '#4cc9f0']

const PRESETS = [
  { key: 'all', label: 'الكل' },
  { key: 'today', label: 'اليوم' },
  { key: 'last7', label: '7 أيام' },
  { key: 'last30', label: '30 يوم' },
  { key: 'thisMonth', label: 'هذا الشهر' },
  { key: 'lastMonth', label: 'الشهر الماضي' },
]

function fmt(val: number, type: 'currency' | 'number' | 'percent') {
  if (type === 'currency') return `${val.toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ر.س`
  if (type === 'percent') return `${val.toFixed(1)}%`
  return val.toLocaleString('ar-SA')
}

function filterByPreset(data: PerformanceData[], preset: string) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'today') return data.filter(r => new Date(r.created_at) >= today)
  if (preset === 'last7') { const f = new Date(today); f.setDate(f.getDate() - 7); return data.filter(r => new Date(r.created_at) >= f) }
  if (preset === 'last30') { const f = new Date(today); f.setDate(f.getDate() - 30); return data.filter(r => new Date(r.created_at) >= f) }
  if (preset === 'thisMonth') return data.filter(r => new Date(r.created_at) >= new Date(now.getFullYear(), now.getMonth(), 1))
  if (preset === 'lastMonth') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 1)
    return data.filter(r => { const d = new Date(r.created_at); return d >= from && d < to })
  }
  return data
}

export default function Dashboard({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<PerformanceData[]>([])
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState('last30')
  const [platform, setPlatform] = useState('الكل')
  const [insight, setInsight] = useState<AiInsight | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    if (!merchant) return
    supabase
      .from('performance_data')
      .select('*')
      .eq('merchant_code', merchant.merchant_code)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setData(data || []); setLoading(false) })

    // Load latest cached insight if available
    supabase
      .from('ai_insights')
      .select('*')
      .eq('merchant_code', merchant.merchant_code)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => { if (data) setInsight(data) })
  }, [merchant])

  async function requestAiAnalysis() {
    setAiLoading(true)
    setAiError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-merchant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
      })
      const json = await res.json()
      if (!res.ok || json.error) { setAiError(json.error || 'خطأ'); }
      else { setInsight(json.insight) }
    } catch (e: any) { setAiError(e.message) }
    setAiLoading(false)
  }

  const filtered = filterByPreset(data, preset).filter(r =>
    platform === 'الكل' ? true : PLATFORM_MAP[r.platform] === platform
  )

  const totalSales = filtered.reduce((s, r) => s + r.total_sales, 0)
  const totalOrders = filtered.reduce((s, r) => s + r.order_count, 0)
  const totalAdSpend = filtered.reduce((s, r) => s + r.ad_spend, 0)
  const avgMargin = filtered.length ? filtered.reduce((s, r) => s + r.margin, 0) / filtered.length : 0
  const roas = totalAdSpend > 0 ? totalSales / totalAdSpend : 0
  const aov = totalOrders > 0 ? totalSales / totalOrders : 0

  const chartData = [...filtered]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-30)
    .map(r => ({
      date: new Date(r.created_at).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }),
      sales: r.total_sales,
      orders: r.order_count,
    }))

  const platformData = Object.entries(
    filtered.reduce((acc, r) => {
      const name = PLATFORM_MAP[r.platform] || r.platform
      acc[name] = (acc[name] || 0) + r.total_sales
      return acc
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name, value }))

  function exportCSV() {
    const headers = ['التاريخ', 'المنصة', 'المبيعات', 'الطلبات', 'الهامش', 'الإنفاق الإعلاني']
    const rows = filtered.map(r => [
      new Date(r.created_at).toLocaleDateString('ar-SA'),
      PLATFORM_MAP[r.platform] || r.platform,
      r.total_sales, r.order_count, r.margin, r.ad_spend
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'sellpert-report.csv'; a.click()
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  return (
    <div style={S.wrap}>
      {/* TOPBAR */}
      <div style={S.topbar}>
        <div>
          <h2 style={S.pageTitle}>لوحة التحكم</h2>
          <p style={S.pageSub}>مرحباً {merchant?.name}، إليك أداء متجرك</p>
        </div>
        <button style={S.exportBtn} onClick={exportCSV}>⬇ تصدير CSV</button>
      </div>

      {/* FILTERS */}
      <div style={S.filtersRow}>
        <div style={S.presetBar}>
          {PRESETS.map(p => (
            <button
              key={p.key}
              style={{ ...S.presetBtn, ...(preset === p.key ? S.presetActive : {}) }}
              onClick={() => setPreset(p.key)}
            >{p.label}</button>
          ))}
        </div>
        <div style={S.platformBar}>
          {PLATFORMS.map(p => (
            <button
              key={p}
              style={{ ...S.platformBtn, ...(platform === p ? S.platformActive : {}) }}
              onClick={() => setPlatform(p)}
            >{p}</button>
          ))}
        </div>
      </div>

      {/* KPI CARDS */}
      <div style={S.cardsGrid}>
        {[
          { label: 'إجمالي المبيعات', value: fmt(totalSales, 'currency'), icon: '💰', color: '#7c6bff', sub: `${totalOrders} طلب` },
          { label: 'متوسط قيمة الطلب', value: fmt(aov, 'currency'), icon: '🛒', color: '#00e5b0', sub: 'AOV' },
          { label: 'هامش الربح', value: fmt(avgMargin, 'percent'), icon: '📈', color: '#ffd166', sub: 'متوسط الهامش' },
          { label: 'عائد الإعلان', value: roas.toFixed(2) + 'x', icon: '🎯', color: '#ff6b6b', sub: `إنفاق ${fmt(totalAdSpend, 'currency')}` },
        ].map((card, i) => (
          <div key={i} style={S.kpiCard}>
            <div style={{ ...S.kpiBar, background: card.color }} />
            <div style={S.kpiTop}>
              <span style={S.kpiLabel}>{card.label}</span>
              <span style={{ ...S.kpiIcon, background: card.color + '22' }}>{card.icon}</span>
            </div>
            <div style={S.kpiValue}>{card.value}</div>
            <div style={S.kpiSub}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* AI INSIGHTS */}
      <div style={S.aiCard}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: insight ? 20 : 0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:22 }}>🤖</span>
            <div>
              <div style={{ fontSize:14, fontWeight:700 }}>تحليل الذكاء الاصطناعي</div>
              {insight && <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
                آخر تحليل: {new Date(insight.created_at).toLocaleString('ar-SA')}
              </div>}
            </div>
          </div>
          <button style={S.aiBtn} onClick={requestAiAnalysis} disabled={aiLoading}>
            {aiLoading ? '⟳ جاري التحليل...' : insight ? '🔄 تحديث التحليل' : '✨ ابدأ التحليل'}
          </button>
        </div>
        {aiError && <div style={{ color:'var(--red)', fontSize:12, marginTop:8 }}>⚠ {aiError}</div>}
        {insight && (
          <div>
            {insight.content.summary && (
              <div style={{ background:'var(--bg)', borderRadius:10, padding:'14px 16px', marginBottom:16, fontSize:13, lineHeight:1.7, color:'var(--text)' }}>
                {insight.content.summary}
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:14 }}>
              {insight.content.recommendations && insight.content.recommendations.length > 0 && (
                <div style={S.aiSection}>
                  <div style={S.aiSectionTitle}>💡 التوصيات</div>
                  {insight.content.recommendations.map((r, i) => (
                    <div key={i} style={S.aiItem}>
                      <span style={{ color:'var(--accent)', fontWeight:700, marginLeft:6 }}>{i+1}.</span>{r}
                    </div>
                  ))}
                </div>
              )}
              {insight.content.best_days && insight.content.best_days.length > 0 && (
                <div style={S.aiSection}>
                  <div style={S.aiSectionTitle}>📅 أفضل أيام البيع</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:8 }}>
                    {insight.content.best_days.map((d, i) => (
                      <span key={i} style={{ background:'rgba(0,229,176,0.15)', color:'var(--accent2)', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:700 }}>{d}</span>
                    ))}
                  </div>
                </div>
              )}
              {insight.content.forecast_next_week && (
                <div style={S.aiSection}>
                  <div style={S.aiSectionTitle}>🔮 توقع الأسبوع القادم</div>
                  <div style={{ fontSize:28, fontWeight:800, color:'var(--accent)', marginTop:8 }}>
                    {insight.content.forecast_next_week.amount.toLocaleString()} ر.س
                  </div>
                  <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>
                    ثقة: {insight.content.forecast_next_week.confidence} — {insight.content.forecast_next_week.reasoning}
                  </div>
                </div>
              )}
              {insight.content.low_stock_alert && insight.content.low_stock_alert.length > 0 && (
                <div style={{ ...S.aiSection, borderColor:'rgba(255,77,109,0.3)', background:'rgba(255,77,109,0.06)' }}>
                  <div style={{ ...S.aiSectionTitle, color:'#ff4d6d' }}>🚨 تحذير مخزون</div>
                  {insight.content.low_stock_alert.map((p, i) => (
                    <div key={i} style={{ ...S.aiItem, color:'#ff4d6d' }}>• {p}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {!insight && !aiLoading && (
          <div style={{ textAlign:'center', padding:'20px 0 4px', color:'var(--text3)', fontSize:13 }}>
            اضغط "ابدأ التحليل" للحصول على رؤى ذكية مبنية على بيانات متجرك
          </div>
        )}
      </div>

      {/* CHARTS */}
      <div style={S.chartsRow}>
        <div style={S.chartCard}>
          <div style={S.chartHeader}>
            <div style={S.chartTitle}>اتجاه المبيعات</div>
            <div style={S.chartSub}>آخر 30 نقطة بيانات</div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d2d4a" />
              <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} />
              <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
              <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #2d2d4a', borderRadius: 10, color: '#eeeef5' }} />
              <Line type="monotone" dataKey="sales" stroke="#7c6bff" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={S.chartCard}>
          <div style={S.chartHeader}>
            <div style={S.chartTitle}>حجم الطلبات</div>
            <div style={S.chartSub}>آخر 30 نقطة بيانات</div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d2d4a" />
              <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} />
              <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #2d2d4a', borderRadius: 10, color: '#eeeef5' }} />
              <Bar dataKey="orders" fill="#00e5b0" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={S.chartCard}>
          <div style={S.chartHeader}>
            <div style={S.chartTitle}>توزيع المنصات</div>
            <div style={S.chartSub}>حسب المبيعات</div>
          </div>
          {platformData.length === 0 ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
              لا توجد بيانات — اربط منصة من قسم "ربط المنصات"
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 200 }}>
              <ResponsiveContainer width="60%" height={180}>
                <PieChart>
                  <Pie data={platformData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                    {platformData.map((_, i) => <Cell key={i} fill={PLATFORM_COLORS[i % PLATFORM_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #2d2d4a', borderRadius: 10, color: '#eeeef5' }} formatter={(v: number) => [fmt(v, 'currency'), '']} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {platformData.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: PLATFORM_COLORS[i % PLATFORM_COLORS.length], flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div style={S.tableCard}>
        <div style={S.tableHeader}>
          <div style={S.chartTitle}>سجل المعاملات</div>
          <span style={S.badge}>{filtered.length} سجل</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['التاريخ', 'المنصة', 'الطلبات', 'المبيعات', 'رسوم المنصة', 'الهامش'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>
                  لا توجد بيانات — اربط منصة من قسم "ربط المنصات" لسحب بياناتك تلقائياً
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} style={S.tr}>
                  <td style={S.td}>{new Date(r.created_at).toLocaleDateString('ar-SA')}</td>
                  <td style={S.td}><span style={S.platformTag}>{PLATFORM_MAP[r.platform] || r.platform}</span></td>
                  <td style={S.td}>{r.order_count.toLocaleString()}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{fmt(r.total_sales, 'currency')}</td>
                  <td style={S.td}>{fmt(r.platform_fees || 0, 'currency')}</td>
                  <td style={{ ...S.td, color: r.margin >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{fmt(r.margin, 'percent')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: '28px 32px', minHeight: '100vh' },
  topbar: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  pageTitle: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  pageSub: { fontSize: 13, color: 'var(--text2)', marginTop: 3 },
  exportBtn: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  filtersRow: { marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 10 },
  presetBar: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  presetBtn: {
    padding: '7px 16px', border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text2)', borderRadius: 20, fontSize: 12, fontWeight: 600,
    transition: 'all 0.2s', cursor: 'pointer',
  },
  presetActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' },
  platformBar: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  platformBtn: {
    padding: '6px 14px', border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text2)', borderRadius: 20, fontSize: 11, fontWeight: 600,
    transition: 'all 0.2s', cursor: 'pointer',
  },
  platformActive: { background: 'var(--surface2)', borderColor: 'var(--accent2)', color: 'var(--accent2)' },
  cardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 },
  kpiCard: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
    padding: '20px', position: 'relative', overflow: 'hidden',
  },
  kpiBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0' },
  kpiTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  kpiLabel: { fontSize: 12, color: 'var(--text3)', fontWeight: 600 },
  kpiIcon: { width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 },
  kpiValue: { fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px', lineHeight: 1 },
  kpiSub: { fontSize: 11, color: 'var(--text3)', marginTop: 6 },
  chartsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 },
  chartCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 },
  chartHeader: { marginBottom: 16 },
  chartTitle: { fontSize: 14, fontWeight: 700 },
  chartSub: { fontSize: 11, color: 'var(--text3)', marginTop: 3 },
  tableCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' },
  tableHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
  },
  badge: { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 20px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--text3)', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '13px 20px', fontSize: 13, color: 'var(--text)' },
  platformTag: { background: 'rgba(124,107,255,0.15)', color: 'var(--accent)', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  aiCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 16, padding: 20, marginBottom: 20,
    borderTop: '3px solid var(--accent)',
  },
  aiBtn: {
    background: 'linear-gradient(135deg, var(--accent), #a594ff)',
    border: 'none', color: '#fff', padding: '9px 20px',
    borderRadius: 10, fontSize: 13, fontWeight: 700,
    boxShadow: '0 4px 14px rgba(124,107,255,0.35)', cursor: 'pointer',
  },
  aiSection: {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '14px 16px',
  },
  aiSectionTitle: { fontSize: 12, fontWeight: 800, color: 'var(--text2)', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  aiItem: { fontSize: 13, color: 'var(--text)', marginBottom: 6, lineHeight: 1.5 },
}
