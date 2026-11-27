import { useSellingAccountClient } from '../components/SellingAccountScope'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { loadMarketingData, type AdRow } from '../lib/marketingLoad'
import { ratio, formatRatio } from '../lib/dataScope'
import DataLoadError from '../components/DataLoadError'
import type { Merchant } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import { TrendingUp, TrendingDown, Megaphone, Search } from 'lucide-react'
import { Pagination, Tooltip, PageHeader, PageLoading } from '../components/UI'
import BudgetAlertsPanel from '../components/BudgetAlertsPanel'
import { createCatalogResolver, type CatalogChannelMapping, type CatalogProductIdentity } from '../lib/catalogIdentity'


export default function Marketing({ merchant }: { merchant: Merchant | null }) {
  const supabase = useSellingAccountClient()

  const [rows, setRows] = useState<AdRow[]>([])
  const [catalogProducts, setCatalogProducts] = useState<CatalogProductIdentity[]>([])
  const [catalogMappings, setCatalogMappings] = useState<CatalogChannelMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const activeLoad = useRef<AbortController | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'campaign' | 'sku' | 'query'>('campaign')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50
  const resolveCatalogProduct = useMemo(() => createCatalogResolver(catalogProducts, catalogMappings), [catalogProducts, catalogMappings])

  const merchantCode=merchant?.merchant_code
  const load=useCallback(async () => {
    activeLoad.current?.abort()
    const controller=new AbortController()
    activeLoad.current=controller
    setLoading(true);setLoadError(false);setRows([])
    try {
      if(!merchantCode)throw new Error('Workspace missing')
      const {data,products,mappings}=await loadMarketingData(supabase,merchantCode,controller.signal)
      if(controller.signal.aborted || activeLoad.current!==controller)return
      setRows(data);setCatalogProducts(products);setCatalogMappings(mappings)
    } catch {
      if(!controller.signal.aborted && activeLoad.current===controller)setLoadError(true)
    } finally {if(activeLoad.current===controller)setLoading(false)}
  },[merchantCode,supabase])
  useEffect(()=>{void load();return ()=>{activeLoad.current?.abort();activeLoad.current=null}},[load])
  useEffect(() => { setPage(1) }, [platformFilter, search, groupBy])

  const filteredRows = useMemo(() => {
    let r = rows
    if (platformFilter !== 'all') r = r.filter(x => x.platform === platformFilter)
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x =>
        (x.campaign_name || '').toLowerCase().includes(q) ||
        (x.sku || '').toLowerCase().includes(q) ||
        (resolveCatalogProduct({marketplace_account_id:x.marketplace_account_id,platform:x.platform,identifiers:[x.sku]})?.name || '').toLowerCase().includes(q) ||
        (x.search_query || '').toLowerCase().includes(q)
      )
    }
    return r
  }, [rows, platformFilter, search, resolveCatalogProduct])

  // المؤشرات العلوية من إجماليات الخادم الكاملة (دقيقة)؛ البحث النصي يرجع لتجميع الصفوف المحمّلة
  const totals = useMemo(() => {
    return {
      spend: filteredRows.reduce((a, r) => a + (Number(r.spend) || 0), 0),
      revenue: filteredRows.reduce((a, r) => a + (Number(r.revenue) || 0), 0),
      impressions: filteredRows.reduce((a, r) => a + r.impressions, 0),
      clicks: filteredRows.reduce((a, r) => a + r.clicks, 0),
      orders: filteredRows.reduce((a, r) => a + r.orders, 0),
    }
  }, [filteredRows])

  const roas = ratio(totals.revenue, totals.spend)
  const ctr = ratio(totals.clicks, totals.impressions)
  const cvr = ratio(totals.orders, totals.clicks)

  const grouped = useMemo(() => {
    const map: Record<string, { key: string; impressions: number; clicks: number; orders: number; spend: number; revenue: number; platform: string }> = {}
    for (const r of filteredRows) {
      const sourceKey = groupBy === 'campaign' ? (r.campaign_name || r.ad_group_name || 'بلا اسم') : groupBy === 'sku' ? (r.sku || '—') : (r.search_query || '—')
      const product = groupBy === 'sku' ? resolveCatalogProduct({marketplace_account_id:r.marketplace_account_id,platform:r.platform,identifiers:[r.sku]}) : undefined
      const aggregationKey = product?.id || `${r.marketplace_account_id}:${r.platform}:${sourceKey}`
      if (!map[aggregationKey]) map[aggregationKey] = { key:product?.name || sourceKey, impressions: 0, clicks: 0, orders: 0, spend: 0, revenue: 0, platform: r.platform }
      map[aggregationKey].impressions += r.impressions
      map[aggregationKey].clicks      += r.clicks
      map[aggregationKey].orders      += r.orders
      map[aggregationKey].spend       += Number(r.spend) || 0
      map[aggregationKey].revenue     += Number(r.revenue) || 0
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend)
  }, [filteredRows, groupBy, resolveCatalogProduct])
  const pagedGrouped = useMemo(() => grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [grouped, page])

  const platforms = useMemo(() => Array.from(new Set(rows.map(r => r.platform))), [rows])

  const recommendations = useMemo(() => {
    const recs: { type: 'good' | 'warn' | 'bad'; title: string; desc: string }[] = []
    // أفضل حملة
    const best = grouped.filter(g => g.spend > 50).sort((a, b) => (b.revenue/Math.max(b.spend,1)) - (a.revenue/Math.max(a.spend,1)))[0]
    if (best && best.spend > 0) {
      const r = best.revenue / best.spend
      if (r > 3) recs.push({ type: 'good', title: 'حملة ذات عائد مرتفع: ' + best.key, desc: `عائد ${formatRatio(r, 'x')} — مرشحة لزيادة مدروسة بعد مراجعة هامش المنتج` })
    }
    // حملات خاسرة
    const losing = grouped.filter(g => g.spend > 100 && (g.revenue / g.spend) < 1)
    for (const l of losing.slice(0, 2)) {
      recs.push({ type: 'bad', title: 'حملة تحتاج مراجعة: ' + l.key, desc: `أنفقت ${l.spend.toFixed(0)} ر.س وعادت ${l.revenue.toFixed(0)} ر.س — راجع الاستهداف والهامش قبل الاستمرار` })
    }
    // كلمات بحث ناجحة بدون حملة
    if (groupBy === 'query' && grouped[0] && grouped[0].orders > 5) {
      recs.push({ type: 'good', title: 'كلمة بحث ذات تحويل مرتفع: ' + grouped[0].key, desc: `${grouped[0].orders} طلب — راجع إمكانية تخصيص حملة مستقلة لها` })
    }
    return recs
  }, [grouped, groupBy])

  if (loading) return <PageLoading title="الإعلانات والأداء" />

  if (loadError) return <div className="merchant-page"><PageHeader title="الإعلانات والأداء" /><DataLoadError onRetry={load} /></div>

  if (rows.length === 0) {
    return (
      <div className="merchant-page">
        <PageHeader title="الإعلانات والأداء" description="أداء حملاتك الإعلانية عبر كل المنصات" />
        <div className="merchant-page-state">
        <Megaphone size={56} color="var(--text3)" style={{ marginBottom: 16 }} />
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>لا توجد بيانات إعلانية بعد</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>ارفع تقرير الإعلانات من صفحة الربط ورفع الملفات، وستظهر المؤشرات هنا بعد اكتمال المعالجة.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="merchant-page">
      <PageHeader title="الإعلانات والأداء" description="أداء حملاتك الإعلانية عبر كل المنصات" />

      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'13px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center', gap:14, flexWrap:'wrap' }}>
        <div><div style={{ fontSize:12, fontWeight:800 }}>مصدر بيانات الإعلانات</div><div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>الأرقام أدناه مأخوذة من تقارير المنصات، وليست خصمًا بنكيًا نهائيًا.</div></div>
        <div style={{ display:'flex', gap:18, flexWrap:'wrap' }}>
          <div><div style={{ fontSize:10, color:'var(--text3)' }}>المصدر</div><div style={{ fontSize:11, fontWeight:700 }}>{rows.some(row => row.upload_id) ? 'ملفات تقارير مرفوعة' : 'ربط مباشر'}</div></div>
          <div><div style={{ fontSize:10, color:'var(--text3)' }}>تواريخ التقارير</div><div style={{ fontSize:11, fontWeight:700 }}>{new Set(rows.map(row => row.report_date)).size.toLocaleString('ar-SA-u-nu-latn')} يوم</div></div>
          <div><div style={{ fontSize:10, color:'var(--text3)' }}>آخر تاريخ تقرير</div><div style={{ fontSize:11, fontWeight:700 }}>{new Date(rows.map(row => row.report_date).sort().slice(-1)[0] || '').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}</div></div>
        </div>
      </div>

      <p style={{fontSize:12,color:"var(--text2)",lineHeight:1.8}}>العائد الإعلاني = الإيراد المنسوب للإعلان ÷ الإنفاق. لا يثبت الربحية قبل احتساب تكلفة المنتج والرسوم والمرتجعات. اقتراحات هذه الصفحة مؤشرات للمراجعة وليست أهدافًا معتمدة للتاجر.</p>

      {/* Budget alerts */}
      {merchant?.merchant_code && (
        <div style={{ marginBottom: 16 }}>
          <BudgetAlertsPanel merchantCode={merchant.merchant_code} />
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label="الإنفاق" value={Math.round(totals.spend).toLocaleString('ar-SA-u-nu-latn') + ' ر.س'} color="var(--danger-text)" icon={<TrendingDown size={18} />} />
        <Kpi label="الإيرادات" value={Math.round(totals.revenue).toLocaleString('ar-SA-u-nu-latn') + ' ر.س'} color="var(--success-text)" icon={<TrendingUp size={18} />} />
        <Kpi labelNode={<Tooltip text="عائد الإعلان قبل خصم الرسوم: كم ريال مبيعات يحقق كل ريال إنفاق إعلاني حسب تقرير المنصة. راجع تكلفة المنتج والرسوم والمرتجعات قبل تقييم الربحية"><span>عائد الإعلان (قبل الرسوم)</span></Tooltip>} label="" value={formatRatio(roas, 'x')} sub="قبل التكاليف والرسوم؛ لا يثبت الربحية" color="var(--text)" />
        <Kpi labelNode={<Tooltip text="نسبة النقر إلى الظهور (CTR): كم شخص نقر على إعلانك من بين كل من شاهده"><span>نسبة النقر (CTR) ⓘ</span></Tooltip>} label="" value={formatRatio(ctr, '%', 100)} sub={`${totals.clicks.toLocaleString('ar-SA-u-nu-latn')} نقرة`} color="#0f958c" />
        <Kpi labelNode={<Tooltip text="معدّل التحويل: كم نقرة تحوّلت إلى طلب فعلي"><span>معدل التحويل ⓘ</span></Tooltip>} label="" value={formatRatio(cvr, '%', 100)} sub={`${totals.orders} طلب`} color="var(--info-text)" />
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text)' }}>توصيات سريعة</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recommendations.map((r, i) => (
              <div key={i} style={{
                padding: '10px 14px', borderRadius: 9,
                background: r.type === 'good' ? 'var(--success-bg)' : r.type === 'warn' ? 'var(--warning-bg)' : 'var(--danger-bg)',
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
              background: platformFilter === p ? (PLATFORM_COLORS[p] || 'var(--accent-strong)') : 'var(--surface2)',
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
              background: groupBy === g ? 'var(--accent-strong)' : 'var(--surface2)',
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
          {groupBy === 'campaign' ? 'الحملات' : groupBy === 'sku' ? 'المنتجات' : 'كلمات البحث'} ({grouped.length})
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
                const r = ratio(g.revenue, g.spend)
                const ct = ratio(g.clicks, g.impressions)
                const color = PLATFORM_COLORS[g.platform] || '#0f958c'
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.key}>{g.key}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color, fontWeight: 700 }}>{PLATFORM_MAP[g.platform] || g.platform}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11 }}>{g.impressions.toLocaleString('ar-SA-u-nu-latn')}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11 }}>{g.clicks.toLocaleString('ar-SA-u-nu-latn')}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text3)' }}>{formatRatio(ct, '%', 100)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700 }}>{g.orders}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--danger-text)', fontFamily: 'monospace' }}>{g.spend.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--success-text)', fontFamily: 'monospace' }}>{g.revenue.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--text)' }}>{formatRatio(r, 'x')}</td>
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
