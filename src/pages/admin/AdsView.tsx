import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP, PLATFORM_COLORS } from './adminShared'
import { Megaphone, TrendingUp, TrendingDown, Search } from 'lucide-react'

type Merchant = { merchant_code: string; name: string; role: string }

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

export default function AdsView({ merchants }: { merchants: Merchant[] }) {
  const [merchantCode, setMerchantCode] = useState('')
  const [rows, setRows] = useState<AdRow[]>([])
  const [loading, setLoading] = useState(false)
  const [platformFilter, setPlatformFilter] = useState<'all' | string>('all')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'campaign' | 'sku' | 'query'>('campaign')

  useEffect(() => { if (merchantCode) load() }, [merchantCode])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('ad_metrics')
      .select('*')
      .eq('merchant_code', merchantCode)
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
    rows: filteredRows.length,
    spend: filteredRows.reduce((a, r) => a + (Number(r.spend) || 0), 0),
    revenue: filteredRows.reduce((a, r) => a + (Number(r.revenue) || 0), 0),
    impressions: filteredRows.reduce((a, r) => a + r.impressions, 0),
    clicks: filteredRows.reduce((a, r) => a + r.clicks, 0),
    orders: filteredRows.reduce((a, r) => a + r.orders, 0),
  }), [filteredRows])

  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  const cvr = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0

  // Group rows
  const grouped = useMemo(() => {
    const map: Record<string, { key: string; impressions: number; clicks: number; orders: number; spend: number; revenue: number; rows: number; platform: string }> = {}
    for (const r of filteredRows) {
      const key = groupBy === 'campaign' ? (r.campaign_name || r.ad_group_name || 'بلا اسم') : groupBy === 'sku' ? (r.sku || '—') : (r.search_query || '—')
      if (!map[key]) map[key] = { key, impressions: 0, clicks: 0, orders: 0, spend: 0, revenue: 0, rows: 0, platform: r.platform }
      map[key].impressions += r.impressions
      map[key].clicks      += r.clicks
      map[key].orders      += r.orders
      map[key].spend       += Number(r.spend) || 0
      map[key].revenue     += Number(r.revenue) || 0
      map[key].rows        += 1
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend).slice(0, 200)
  }, [filteredRows, groupBy])

  const platforms = useMemo(() => {
    const set = new Set(rows.map(r => r.platform))
    return Array.from(set)
  }, [rows])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1300, margin: '0 auto' }}>
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📣 أداء الإعلانات</h3>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>كل حملات نون وتراندايول وأمازون في مكان واحد · تحليل ROAS و CTR والعائد</p>
      </div>

      {/* Merchant selector */}
      <div style={{ ...S.formCard, padding: 18 }}>
        <label style={S.label}>التاجر</label>
        <select value={merchantCode} onChange={e => setMerchantCode(e.target.value)} style={{ ...S.input, fontSize: 13 }}>
          <option value="">— اختر التاجر —</option>
          {merchants.filter(m => m.role === 'merchant').map(m => (
            <option key={m.merchant_code} value={m.merchant_code}>{m.name} ({m.merchant_code})</option>
          ))}
        </select>
      </div>

      {merchantCode && !loading && rows.length > 0 && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <KpiCard label="الإنفاق" value={Math.round(totals.spend).toLocaleString('ar-SA') + ' ر.س'} color="#e84040" icon={<TrendingDown size={20} />} />
            <KpiCard label="الإيرادات" value={Math.round(totals.revenue).toLocaleString('ar-SA') + ' ر.س'} color="#00b894" icon={<TrendingUp size={20} />} />
            <KpiCard label="ROAS"  value={roas.toFixed(2) + 'x'} sub={roas >= 3 ? '✓ ممتاز' : roas >= 1.5 ? 'جيد' : '⚠ منخفض'} color={roas >= 3 ? '#00b894' : roas >= 1.5 ? '#ff9900' : '#e84040'} />
            <KpiCard label="عدد المعاملات" value={totals.rows.toLocaleString('ar-SA')} sub={`${totals.orders} طلب`} color="#7c6bff" icon={<Megaphone size={20} />} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <SubKpi label="الظهور" value={totals.impressions.toLocaleString('ar-SA')} />
            <SubKpi label="النقرات" value={totals.clicks.toLocaleString('ar-SA') + ` (${ctr.toFixed(2)}% CTR)`} />
            <SubKpi label="معدّل التحويل" value={cvr.toFixed(2) + '%'} />
          </div>

          {/* Filters */}
          <div style={{ ...S.formCard, padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', ...platforms] as const).map(p => (
                <button key={p} onClick={() => setPlatformFilter(p)} style={{
                  padding: '7px 14px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer',
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
                  cursor: 'pointer',
                  background: groupBy === g ? 'var(--accent)' : 'var(--surface2)',
                  color: groupBy === g ? '#fff' : 'var(--text2)',
                }}>
                  {g === 'campaign' ? 'الحملة' : g === 'sku' ? 'المنتج (SKU)' : 'كلمة البحث'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', right: 10, color: 'var(--text3)' }} />
              <input
                placeholder="بحث"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...S.searchInput, paddingRight: 32, minWidth: 200 }}
              />
            </div>
          </div>

          {/* Grouped table */}
          <div style={{ ...S.tableCard }}>
            <div style={S.tableHeader}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {groupBy === 'campaign' ? '🎯 الحملات' : groupBy === 'sku' ? '📦 المنتجات' : '🔍 كلمات البحث'} ({grouped.length})
              </div>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 600, overflowY: 'auto' }}>
              <table style={S.table}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)', zIndex: 1 }}>
                  <tr>
                    {[groupBy === 'campaign' ? 'الحملة' : groupBy === 'sku' ? 'SKU' : 'كلمة البحث', 'المنصة', 'ظهور', 'نقرات', 'CTR', 'طلبات', 'تكلفة', 'إيرادات', 'ROAS'].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((g, i) => {
                    const r = g.spend > 0 ? g.revenue / g.spend : 0
                    const ct = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0
                    const color = PLATFORM_COLORS[g.platform] || '#7c6bff'
                    return (
                      <tr key={i} style={S.tr}>
                        <td style={{ ...S.td, fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.key}>{g.key}</td>
                        <td style={{ ...S.td, fontSize: 11, color, fontWeight: 700 }}>{PLATFORM_MAP[g.platform] || g.platform}</td>
                        <td style={{ ...S.td, fontSize: 11 }}>{g.impressions.toLocaleString('ar-SA')}</td>
                        <td style={{ ...S.td, fontSize: 11 }}>{g.clicks.toLocaleString('ar-SA')}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{ct.toFixed(2)}%</td>
                        <td style={{ ...S.td, fontSize: 11, fontWeight: 700 }}>{g.orders}</td>
                        <td style={{ ...S.td, fontSize: 11, color: '#e84040', fontFamily: 'monospace' }}>{g.spend.toFixed(2)}</td>
                        <td style={{ ...S.td, fontSize: 11, color: '#00b894', fontFamily: 'monospace' }}>{g.revenue.toFixed(2)}</td>
                        <td style={{ ...S.td, fontSize: 11, fontWeight: 800, color: r >= 3 ? '#00b894' : r >= 1 ? '#ff9900' : '#e84040' }}>{r.toFixed(2)}x</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {merchantCode && !loading && rows.length === 0 && (
        <div style={{ ...S.formCard, padding: 60, textAlign: 'center' }}>
          <Megaphone size={48} color="var(--text3)" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>لا توجد إعلانات لهذا التاجر</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>ارفع تقارير الإعلانات من صفحة استيراد الملفات</div>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon?: React.ReactNode }) {
  return (
    <div style={{ ...S.kpiCard, borderLeft: `3px solid ${color}` }}>
      <div style={S.kpiTop}>
        <span style={S.kpiLabel}>{label}</span>
        {icon && <span style={{ ...S.kpiIcon, color, background: color + '15' }}>{icon}</span>}
      </div>
      <div style={{ ...S.kpiValue, color }}>{value}</div>
      {sub && <div style={S.kpiSub}>{sub}</div>}
    </div>
  )
}

function SubKpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...S.kpiCard, padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  )
}
