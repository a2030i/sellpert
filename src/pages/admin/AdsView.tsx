import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP, PLATFORM_COLORS } from './adminShared'
import { Megaphone, TrendingUp, TrendingDown, Search } from 'lucide-react'

type Merchant = { merchant_code: string; name: string; role: string }

interface AdGroupRow {
  key: string
  platform: string
  impressions: number
  clicks: number
  orders: number
  spend: number
  revenue: number
  rows: number
}

type AdTotals = { rows:number; spend:number; revenue:number; impressions:number; clicks:number; orders:number }
type AdUpload = { id:string; file_name:string; platform:string; uploaded_at:string; rows_inserted:number }
const EMPTY_TOTALS: AdTotals = { rows:0, spend:0, revenue:0, impressions:0, clicks:0, orders:0 }

export default function AdsView({ merchants }: { merchants: Merchant[] }) {
  const requestSequence = useRef(0)
  const [merchantCode, setMerchantCode] = useState('')
  const [groups, setGroups] = useState<AdGroupRow[]>([])
  const [totals, setTotals] = useState<AdTotals>(EMPTY_TOTALS)
  const [platforms, setPlatforms] = useState<string[]>([])
  const [reports, setReports] = useState<AdUpload[]>([])
  const [reportId, setReportId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [platformFilter, setPlatformFilter] = useState<'all' | string>('all')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'campaign' | 'sku' | 'query'>('campaign')

  useEffect(() => {
    if (!merchantCode) return
    let cancelled = false
    setLoading(true); setError(''); setGroups([]); setTotals(EMPTY_TOTALS); setReports([]); setReportId('')
    supabase.from('platform_file_uploads')
      .select('id,file_name,platform,uploaded_at,rows_inserted')
      .eq('merchant_code', merchantCode).eq('status', 'success')
      .in('file_type', ['noon_ads', 'amazon_ads', 'amazon_campaigns', 'trendyol_ads'])
      .order('uploaded_at', { ascending: false })
      .then(({ data, error: reportError }) => {
        if (cancelled) return
        if (reportError) { setError(reportError.message); setLoading(false); return }
        const next = (data || []) as AdUpload[]
        setReports(next)
        setReportId(next.length ? 'latest' : 'all')
        if (!next.length) setLoading(false)
      })
    return () => { cancelled = true }
  }, [merchantCode])

  useEffect(() => {
    if (!merchantCode || !reportId) return
    const timer = window.setTimeout(() => { load() }, 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantCode, reportId, platformFilter, groupBy, search])

  async function load() {
    const requestId = ++requestSequence.current
    setLoading(true)
    setError('')
    const latestReportIds = reportId === 'latest'
      ? Array.from(reports.reduce((byPlatform, report) => {
          if (!byPlatform.has(report.platform)) byPlatform.set(report.platform, report.id)
          return byPlatform
        }, new Map<string, string>()).values())
      : []
    const reportIds = latestReportIds.length ? latestReportIds : [reportId === 'all' ? null : reportId]
    const responses = await Promise.all(reportIds.map(uploadId => supabase.rpc('admin_ad_performance', {
      p_merchant_code: merchantCode, p_upload_id: uploadId,
      p_platform: platformFilter === 'all' ? null : platformFilter,
      p_group_by: groupBy, p_search: search.trim() || null,
    })))
    const queryError = responses.find(response => response.error)?.error
    const data = queryError ? null : mergeAdResults(responses.map(response => response.data))
    if (requestId !== requestSequence.current) return
    if (queryError) {
      setError(queryError.message); setGroups([]); setTotals(EMPTY_TOTALS)
    } else {
      setGroups((data?.groups || []) as AdGroupRow[])
      setTotals({ ...EMPTY_TOTALS, ...(data?.totals || {}) })
      if (platformFilter === 'all') setPlatforms((data?.platforms || []) as string[])
    }
    setLoading(false)
  }

  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  const cvr = totals.clicks > 0 ? (totals.orders / totals.clicks) * 100 : 0


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1300, margin: '0 auto' }}>
      <div>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>كل حملات نون وتراندايول وأمازون في مكان واحد · تحليل ROAS و CTR والعائد</p>
      </div>

      {/* Merchant selector */}
      <div style={{ ...S.formCard, padding: 18 }}>
        <label style={S.label}>التاجر</label>
        <select aria-label="اختيار التاجر لأداء الإعلانات" value={merchantCode} onChange={e => setMerchantCode(e.target.value)} style={{ ...S.input, fontSize: 13 }}>
          <option value="">— اختر التاجر —</option>
          {merchants.filter(m => m.role === 'merchant').map(m => (
            <option key={m.merchant_code} value={m.merchant_code}>{m.name} ({m.merchant_code})</option>
          ))}
        </select>
        {merchantCode && reports.length > 0 && <>
          <label style={{ ...S.label, marginTop: 12 }}>تقرير الإعلانات</label>
          <select aria-label="اختيار تقرير الإعلانات" value={reportId} onChange={e => { setReportId(e.target.value); setPlatformFilter('all') }} style={{ ...S.input, fontSize: 13 }}>
            <option value="latest">أحدث تقرير من كل منصة</option>
            {reports.map(report => <option key={report.id} value={report.id}>{reportLabel(report)}</option>)}
            <option value="all">كل التقارير المرفوعة</option>
          </select>
        </>}
      </div>

      {error && <div style={{ ...S.formCard, color: 'var(--danger-text)', padding: 14 }}>تعذر تحميل أداء الإعلانات: {error}</div>}

      {merchantCode && !loading && !error && totals.rows > 0 && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <KpiCard label="الإنفاق" value={Math.round(totals.spend).toLocaleString('ar-SA-u-nu-latn') + ' ر.س'} color="#e84040" icon={<TrendingDown size={20} />} />
            <KpiCard label="الإيرادات" value={Math.round(totals.revenue).toLocaleString('ar-SA-u-nu-latn') + ' ر.س'} color="#00b894" icon={<TrendingUp size={20} />} />
            <KpiCard label="ROAS"  value={roas.toFixed(2) + 'x'} sub={roas >= 3 ? 'ممتاز' : roas >= 1.5 ? 'جيد' : 'منخفض'} color={roas >= 3 ? '#00b894' : roas >= 1.5 ? '#ff9900' : '#e84040'} />
            <KpiCard label="عدد المعاملات" value={totals.rows.toLocaleString('ar-SA-u-nu-latn')} sub={`${totals.orders} طلب`} color="#0f958c" icon={<Megaphone size={20} />} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <SubKpi label="الظهور" value={totals.impressions.toLocaleString('ar-SA-u-nu-latn')} />
            <SubKpi label="النقرات" value={totals.clicks.toLocaleString('ar-SA-u-nu-latn') + ` (${ctr.toFixed(2)}% CTR)`} />
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
                aria-label="البحث في الحملات الإعلانية"
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
                {groupBy === 'campaign' ? 'الحملات' : groupBy === 'sku' ? 'المنتجات' : 'كلمات البحث'} ({groups.length})
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
                  {groups.map((g, i) => {
                    const r = g.spend > 0 ? g.revenue / g.spend : 0
                    const ct = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0
                    const color = PLATFORM_COLORS[g.platform] || '#0f958c'
                    return (
                      <tr key={i} style={S.tr}>
                        <td style={{ ...S.td, fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.key}>{g.key}</td>
                        <td style={{ ...S.td, fontSize: 11, color, fontWeight: 700 }}>{PLATFORM_MAP[g.platform] || g.platform}</td>
                        <td style={{ ...S.td, fontSize: 11 }}>{g.impressions.toLocaleString('ar-SA-u-nu-latn')}</td>
                        <td style={{ ...S.td, fontSize: 11 }}>{g.clicks.toLocaleString('ar-SA-u-nu-latn')}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{ct.toFixed(2)}%</td>
                        <td style={{ ...S.td, fontSize: 11, fontWeight: 700 }}>{g.orders}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--danger-text)', fontFamily: 'monospace' }}>{g.spend.toFixed(2)}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--success-text)', fontFamily: 'monospace' }}>{g.revenue.toFixed(2)}</td>
                        <td style={{ ...S.td, fontSize: 11, fontWeight: 800, color: r >= 3 ? 'var(--success-text)' : r >= 1 ? 'var(--warning-text)' : 'var(--danger-text)' }}>{r.toFixed(2)}x</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {merchantCode && !loading && !error && totals.rows === 0 && (
        <div style={{ ...S.formCard, padding: 60, textAlign: 'center' }}>
          <Megaphone size={48} color="var(--text3)" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text2)' }}>لا توجد إعلانات لهذا التاجر</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>ارفع تقارير الإعلانات من صفحة استيراد الملفات</div>
        </div>
      )}
    </div>
  )
}

function mergeAdResults(results: any[]) {
  const totals = { ...EMPTY_TOTALS }
  const groups = new Map<string, AdGroupRow>()
  const platforms = new Set<string>()
  for (const result of results) {
    const current = result?.totals || EMPTY_TOTALS
    for (const key of Object.keys(totals) as (keyof AdTotals)[]) totals[key] += Number(current[key] || 0)
    for (const platform of result?.platforms || []) platforms.add(platform)
    for (const row of (result?.groups || []) as AdGroupRow[]) {
      const id = `${row.platform}\u0000${row.key}`
      const previous = groups.get(id)
      groups.set(id, previous ? {
        ...previous, impressions:previous.impressions+row.impressions, clicks:previous.clicks+row.clicks,
        orders:previous.orders+row.orders, spend:previous.spend+Number(row.spend||0),
        revenue:previous.revenue+Number(row.revenue||0), rows:previous.rows+row.rows,
      } : { ...row, spend:Number(row.spend||0), revenue:Number(row.revenue||0) })
    }
  }
  return { totals, platforms:Array.from(platforms), groups:Array.from(groups.values()).sort((a,b)=>b.spend-a.spend).slice(0,200) }
}

function reportLabel(report: AdUpload) {
  const range = report.file_name.match(/(20\d{2}-\d{2}-\d{2})[_-](20\d{2}-\d{2}-\d{2})/)
  const period = range ? `${range[1]} إلى ${range[2]}` : new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium' }).format(new Date(report.uploaded_at))
  return `${PLATFORM_MAP[report.platform] || report.platform} · ${period} · ${Number(report.rows_inserted || 0).toLocaleString('ar-SA-u-nu-latn')} صف`
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
