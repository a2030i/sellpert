import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import { TrendingUp, TrendingDown, Megaphone, Search } from 'lucide-react'
import { Pagination, Tooltip } from '../components/UI'
import BudgetAlertsPanel from '../components/BudgetAlertsPanel'

interface AdRow {
  id: string
  platform: string
  campaign_name: string | null
  ad_group_name: string | null
  sku: string | null
  search_query: string | null
  impressions: number
  clicks: number
  orders: number
  spend: number
  revenue: number
  ctr: number | null
  roas: number | null
  cpc: number | null
  acos: number | null
  report_date: string
}

export default function Marketing({ merchant }: { merchant: Merchant | null }) {
  const [rows, setRows] = useState<AdRow[]>([])
  const [loading, setLoading] = useState(true)
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'campaign' | 'sku' | 'query'>('campaign')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { if (merchant) load() /* eslint-disable-line */ }, [merchant?.merchant_code])

  async function load() {
    if (!merchant) return
    setLoading(true)
    const { data } = await supabase.from('ad_metrics')
      .select('*')
      .eq('merchant_code', merchant.merchant_code)
      .order('spend', { ascending: false })
      .limit(5000)
    setRows((data as AdRow[]) || [])
    setLoading(false)
  }

  const filteredRows = useMemo(() => {
    let r = rows
    if (platformFilter !== 'all') r = r.filter(x => x.platform === platformFilter)
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x =>
        (x.campaign_name || '').toLowerCase().includes(q) ||
        (x.sku || '').toLowerCase().includes(q) ||
        (x.search_query || '').toLowerCase().includes(q)
      )
    }
    return r
  }, [rows, platformFilter, search])

  const totals = useMemo(() => ({
    spend: filteredRows.reduce((a, r) => a + (Number(r.spend) || 0), 0),
    revenue: filteredRows.reduce((a, r) => a + (Number(r.revenue) || 0), 0),
    impressions: filteredRows.reduce((a, r) => a + r.impressions, 0),
    clicks: filteredRows.reduce((a, r) => a + r.clicks, 0),
    orders: filteredRows.reduce((a, r) => a + r.orders, 0),
  }), [filteredRows])

  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  const cvr = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0

  const grouped = useMemo(() => {
    const map: Record<string, { key: string; impressions: number; clicks: number; orders: number; spend: number; revenue: number; platform: string }> = {}
    for (const r of filteredRows) {
      const key = groupBy === 'campaign' ? (r.campaign_name || r.ad_group_name || 'بلا اسم') : groupBy === 'sku' ? (r.sku || '—') : (r.search_query || '—')
      if (!map[key]) map[key] = { key, impressions: 0, clicks: 0, orders: 0, spend: 0, revenue: 0, platform: r.platform }
      map[key].impressions += r.impressions
      map[key].clicks      += r.clicks
      map[key].orders      += r.orders
      map[key].spend       += Number(r.spend) || 0
      map[key].revenue     += Number(r.revenue) || 0
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend)
  }, [filteredRows, groupBy])
  const pagedGrouped = useMemo(() => grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [grouped, page])

  const platforms = useMemo(() => Array.from(new Set(rows.map(r => r.platform))), [rows])

  const recommendations = useMemo(() => {
    const recs: { type: 'good' | 'warn' | 'bad'; title: string; desc: string }[] = []
    // أفضل حملة
    const best = grouped.filter(g => g.spend > 50).sort((a, b) => (b.revenue/Math.max(b.spend,1)) - (a.revenue/Math.max(a.spend,1)))[0]
    if (best && best.spend > 0) {
      const r = best.revenue / best.spend
      if (r > 3) recs.push({ type: 'good', title: '🏆 أفضل حملة: ' + best.key, desc: `ROAS ${r.toFixed(2)}x — ضاعف ميزانيتها` })
    }
    // حملات خاسرة
    const losing = grouped.filter(g => g.spend > 100 && (g.revenue / g.spend) < 1)
    for (const l of losing.slice(0, 2)) {
      recs.push({ type: 'bad', title: '⚠️ حملة خاسرة: ' + l.key, desc: `أنفقت ${l.spend.toFixed(0)} ر.س وعادت ${l.revenue.toFixed(0)} — أوقفها` })
    }
    // كلمات بحث ناجحة بدون حملة
    if (groupBy === 'query' && grouped[0] && grouped[0].orders > 5) {
      recs.push({ type: 'good', title: '🔍 كلمة قوية: ' + grouped[0].key, desc: `${grouped[0].orders} طلب — استثمر فيها أكثر` })
    }
    return recs
  }, [grouped, groupBy])

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><div style={spinner} /></div>

  if (rows.length === 0) {
    return (
      <div style={{ padding: '60px 32px', textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
        <Megaphone size={56} color="var(--text3)" style={{ marginBottom: 16 }} />
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>لا توجد بيانات إعلانية بعد</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>يقوم فريق Sellpert برفع تقارير إعلاناتك من المنصات وستظهر هنا تلقائياً</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>📣 التسويق</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>أداء حملاتك الإعلانية عبر كل المنصات</p>
      </div>

      {/* True ROAS panel */}
      <TrueAdEffectivenessPanel merchantCode={merchant?.merchant_code} />

      {/* Budget alerts */}
      {merchant?.merchant_code && (
        <div style={{ marginBottom: 16 }}>
          <BudgetAlertsPanel merchantCode={merchant.merchant_code} />
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="الإنفاق" value={Math.round(totals.spend).toLocaleString('ar-SA') + ' ر.س'} color="#e84040" icon={<TrendingDown size={18} />} />
        <Kpi label="الإيرادات" value={Math.round(totals.revenue).toLocaleString('ar-SA') + ' ر.س'} color="#00b894" icon={<TrendingUp size={18} />} />
        <Kpi labelNode={<Tooltip text="عائد الإنفاق على الإعلان: كم ريال يجيب كل ريال إنفاق إعلاني"><span>ROAS ⓘ</span></Tooltip>} label="" value={roas.toFixed(2) + 'x'} sub={roas >= 3 ? '✓ ممتاز' : roas >= 1.5 ? 'جيد' : '⚠ منخفض'} color={roas >= 3 ? '#00b894' : roas >= 1.5 ? '#ff9900' : '#e84040'} />
        <Kpi label="CTR" value={ctr.toFixed(2) + '%'} sub={`${totals.clicks.toLocaleString('ar-SA')} نقرة`} color="#7c6bff" />
        <Kpi label="معدل التحويل" value={cvr.toFixed(2) + '%'} sub={`${totals.orders} طلب`} color="#4cc9f0" />
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text)' }}>💡 توصيات سريعة</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recommendations.map((r, i) => (
              <div key={i} style={{
                padding: '10px 14px', borderRadius: 9,
                background: r.type === 'good' ? 'rgba(0,184,148,0.06)' : r.type === 'warn' ? 'rgba(255,153,0,0.06)' : 'rgba(232,64,64,0.06)',
                border: `1px solid ${r.type === 'good' ? 'rgba(0,184,148,0.2)' : r.type === 'warn' ? 'rgba(255,153,0,0.2)' : 'rgba(232,64,64,0.2)'}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{r.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', ...platforms] as const).map(p => (
            <button key={p} onClick={() => setPlatformFilter(p)} style={{
              padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              background: platformFilter === p ? (PLATFORM_COLORS[p] || 'var(--accent)') : 'var(--surface2)',
              color: platformFilter === p ? '#fff' : 'var(--text2)',
            }}>
              {p === 'all' ? 'كل المنصات' : (PLATFORM_MAP[p] || p)}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', alignSelf: 'center' }}>تجميع:</span>
          {(['campaign', 'sku', 'query'] as const).map(g => (
            <button key={g} onClick={() => setGroupBy(g)} style={{
              padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              background: groupBy === g ? 'var(--accent)' : 'var(--surface2)',
              color: groupBy === g ? '#fff' : 'var(--text2)',
            }}>
              {g === 'campaign' ? 'الحملة' : g === 'sku' ? 'المنتج' : 'كلمة البحث'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', right: 10, color: 'var(--text3)' }} />
          <input placeholder="بحث" value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 32px 8px 12px', borderRadius: 8, fontSize: 12, outline: 'none', minWidth: 200 }} />
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>
          {groupBy === 'campaign' ? '🎯 الحملات' : groupBy === 'sku' ? '📦 المنتجات' : '🔍 كلمات البحث'} ({grouped.length})
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 600, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)', zIndex: 1 }}>
              <tr>
                {[groupBy === 'campaign' ? 'الحملة' : groupBy === 'sku' ? 'SKU' : 'كلمة البحث', 'المنصة', 'ظهور', 'نقرات', 'CTR', 'طلبات', 'تكلفة', 'إيرادات', 'ROAS'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedGrouped.map((g, i) => {
                const r = g.spend > 0 ? g.revenue / g.spend : 0
                const ct = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0
                const color = PLATFORM_COLORS[g.platform] || '#7c6bff'
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.key}>{g.key}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color, fontWeight: 700 }}>{PLATFORM_MAP[g.platform] || g.platform}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11 }}>{g.impressions.toLocaleString('ar-SA')}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11 }}>{g.clicks.toLocaleString('ar-SA')}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text3)' }}>{ct.toFixed(2)}%</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700 }}>{g.orders}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: '#e84040', fontFamily: 'monospace' }}>{g.spend.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: '#00b894', fontFamily: 'monospace' }}>{g.revenue.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: r >= 3 ? '#00b894' : r >= 1 ? '#ff9900' : '#e84040' }}>{r.toFixed(2)}x</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={grouped.length} onPage={setPage} />
      </div>
    </div>
  )
}

function Kpi({ label, labelNode, value, sub, color, icon }: { label: string; labelNode?: React.ReactNode; value: string; sub?: string; color: string; icon?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{labelNode || label}</span>
        {icon && <span style={{ color, opacity: 0.85 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const spinner: React.CSSProperties = {
  width: 36, height: 36, margin: '0 auto', border: '3px solid var(--border)',
  borderTopColor: 'var(--accent)', borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
}

// ─── True Ad Effectiveness (Net ROAS after returns) ──────────────────────────
function TrueAdEffectivenessPanel({ merchantCode }: { merchantCode?: string }) {
  const [data, setData] = useState<any[]>([])
  const [summary, setSummary] = useState<any[]>([])
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    if (!merchantCode) return
    Promise.all([
      supabase.from('true_ad_effectiveness').select('*').eq('merchant_code', merchantCode).order('spend', { ascending: false }).limit(30),
      supabase.from('ad_net_summary').select('*').eq('merchant_code', merchantCode),
    ]).then(([d, s]) => {
      setData(d.data || [])
      setSummary(s.data || [])
    })
  }, [merchantCode])

  if (data.length === 0) return null

  const losses = data.filter(d => d.net_roas !== null && Number(d.net_roas) < 1)
  const inflated = data.filter(d => d.gross_roas && d.net_roas && Number(d.gross_roas) >= 2 && Number(d.net_roas) < 1)

  // Aggregate summary
  const totalSpend = summary.reduce((s, r) => s + Number(r.total_spend || 0), 0)
  const totalGross = summary.reduce((s, r) => s + Number(r.total_gross || 0), 0)
  const totalNet = summary.reduce((s, r) => s + Number(r.total_net || 0), 0)
  const totalCommission = summary.reduce((s, r) => s + Number(r.total_commission || 0), 0)
  const totalFba = summary.reduce((s, r) => s + Number(r.total_fba || 0), 0)
  const totalVat = summary.reduce((s, r) => s + Number(r.total_vat || 0), 0)
  const totalReturns = summary.reduce((s, r) => s + Number(r.total_returns || 0), 0)
  const grossRoas = totalSpend > 0 ? totalGross / totalSpend : 0
  const netRoas = totalSpend > 0 ? totalNet / totalSpend : 0
  const inflationPct = totalGross > 0 ? ((totalGross - totalNet) / totalGross) * 100 : 0

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🎯 ROAS الحقيقي — بعد العمولة والشحن والمرتجعات</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            تقارير المنصات تعرض GMV الإجمالي. الـ ROAS الحقيقي يخصم عمولة المنصة + رسوم FBA + الضريبة المحجوزة + المرتجعات
          </div>
        </div>
        <button onClick={() => setShowDetails(s => !s)} style={{
          background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)',
          padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {showDetails ? '▲ إخفاء التفاصيل' : '▼ عرض تفاصيل الرسوم'}
        </button>
      </div>

      {/* Inflation banner */}
      {inflationPct > 5 && (
        <div style={{ marginBottom: 12, padding: '12px 14px', background: 'linear-gradient(135deg,rgba(245,158,11,0.10),rgba(232,64,64,0.10))', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 9, fontSize: 12, color: 'var(--text)' }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠ الـ ROAS اللي تشوفه في تقارير المنصة متضخّم بنسبة {inflationPct.toFixed(0)}%</div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            تقرير المنصة يقول: <strong style={{ color: '#00b894' }}>{grossRoas.toFixed(2)}x ROAS</strong> ·
            بعد خصم العمولة والرسوم والمرتجعات الفعلي: <strong style={{ color: netRoas >= 1 ? '#00b894' : '#e84040' }}>{netRoas.toFixed(2)}x ROAS</strong>
          </div>
        </div>
      )}

      {/* KPI breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
        <MetricCard label="إنفاق إعلاني" value={Math.round(totalSpend).toLocaleString('en-US')} suffix="ر.س" color="#e84040" />
        <MetricCard label="إيراد إجمالي" value={Math.round(totalGross).toLocaleString('en-US')} suffix="ر.س" sub="حسب تقرير المنصة" />
        <MetricCard label="عمولة المنصة" value={Math.abs(Math.round(totalCommission)).toLocaleString('en-US')} suffix="ر.س-" color="#f59e0b" />
        <MetricCard label="رسوم FBA" value={Math.abs(Math.round(totalFba)).toLocaleString('en-US')} suffix="ر.س-" color="#f59e0b" />
        <MetricCard label="ضريبة محجوزة" value={Math.abs(Math.round(totalVat)).toLocaleString('en-US')} suffix="ر.س-" color="#f59e0b" />
        <MetricCard label="مرتجعات" value={Math.abs(Math.round(totalReturns)).toLocaleString('en-US')} suffix="ر.س-" color="#f59e0b" />
        <MetricCard label="صافي الإيراد" value={Math.round(totalNet).toLocaleString('en-US')} suffix="ر.س" color={totalNet > 0 ? '#00b894' : '#e84040'} bold />
        <MetricCard label="ROAS الحقيقي" value={netRoas.toFixed(2) + 'x'} color={netRoas >= 2 ? '#00b894' : netRoas >= 1 ? '#f59e0b' : '#e84040'} bold sub={`المنصة: ${grossRoas.toFixed(2)}x`} />
      </div>

      {losses.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(232,64,64,0.08)', border: '1px solid rgba(232,64,64,0.2)', borderRadius: 9, fontSize: 12, color: '#e84040', fontWeight: 600 }}>
          ⚠️ {losses.length} إعلان خاسر فعلياً بعد احتساب الرسوم والمرتجعات — راجعها أو أوقفها
        </div>
      )}
      {inflated.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 9, fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
          🚨 {inflated.length} إعلان يبدو مربحاً جداً بـROAS ≥ 2x لكن صافياً خاسر — تنبيه للتضخّم
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr>{(showDetails
            ? ['SKU/حملة','إنفاق','إجمالي (متضخم)','رسوم منصة','مرتجعات','صافي','ROAS منصة','ROAS حقيقي']
            : ['SKU/حملة','إنفاق','إجمالي','صافي','ROAS منصة','ROAS حقيقي']
          ).map(h => (
            <th key={h} style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {data.slice(0, 15).map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 10px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.campaign_name || r.sku}>
                  {r.sku ? <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{r.sku}</span> : (r.campaign_name || '—')}
                </td>
                <td style={{ padding: '7px 10px', color: '#e84040' }}>{Number(r.spend).toFixed(0)}</td>
                <td style={{ padding: '7px 10px' }}>{Number(r.gross_revenue).toFixed(0)}</td>
                {showDetails && (
                  <>
                    <td style={{ padding: '7px 10px', color: '#f59e0b' }}>
                      {r.est_fees > 0 ? '−' + Number(r.est_fees).toFixed(0) : '—'}
                      {r.fee_rate && <span style={{ fontSize: 9, color: 'var(--text3)' }}> ({(Number(r.fee_rate) * 100).toFixed(0)}%)</span>}
                    </td>
                    <td style={{ padding: '7px 10px', color: '#ffd166' }}>
                      {r.est_returns > 0 ? '−' + Number(r.est_returns).toFixed(0) : '—'}
                      {r.return_rate && <span style={{ fontSize: 9, color: 'var(--text3)' }}> ({(Number(r.return_rate) * 100).toFixed(0)}%)</span>}
                    </td>
                  </>
                )}
                <td style={{ padding: '7px 10px', fontWeight: 700, color: r.net_revenue >= 0 ? '#00b894' : '#e84040' }}>{Number(r.net_revenue).toFixed(0)}</td>
                <td style={{ padding: '7px 10px', color: 'var(--text3)' }}>{r.gross_roas ? Number(r.gross_roas).toFixed(2) + 'x' : '—'}</td>
                <td style={{ padding: '7px 10px', fontWeight: 800, color: !r.net_roas ? 'var(--text3)' : Number(r.net_roas) >= 2 ? '#00b894' : Number(r.net_roas) >= 1 ? '#ff9900' : '#e84040' }}>
                  {r.net_roas ? Number(r.net_roas).toFixed(2) + 'x' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text3)', lineHeight: 1.7, padding: 10, background: 'var(--surface2)', borderRadius: 8 }}>
        💡 <strong>كيف يحسبها النظام؟</strong> النظام يحلل ملف كشف الحساب الفعلي ويستخرج نسبتين: نسبة الرسوم (عمولة + FBA + ضريبة محجوزة ÷ المبيعات الإجمالية) ونسبة المرتجعات. ثم يطبقهما على الإيراد المعلن من تقارير Ads. كلما رفعت المزيد من ملفات الكشوف (Settlement)، ارتفعت دقة الحساب.
      </div>
    </div>
  )
}

function MetricCard({ label, value, suffix, color, sub, bold }: any) {
  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: bold ? 16 : 14, fontWeight: bold ? 800 : 700, color: color || 'var(--text)' }}>
        {value}{suffix && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text3)', marginRight: 3 }}> {suffix}</span>}
      </div>
      {sub && <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
