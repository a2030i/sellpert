import { useState, useEffect } from 'react'
import { S, fmt, relativeTime, PLATFORM_MAP, PLATFORM_COLORS, CHART_COLORS } from './adminShared'
import type { Merchant, PerformanceData, SyncLog } from '../../lib/supabase'
import { supabase } from '../../lib/supabase'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'

export default function OverviewView({ merchantOnly, merchants, totalGMV, totalOrders, activeIntegrations, gmvTrend, gmvByPlatform, topMerchants, syncLogs, perfData }: any) {
  const now = new Date()
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`

  const gmvThisMonth = perfData.filter((r: PerformanceData) => (r.data_date || r.created_at.split('T')[0]).startsWith(thisMonthKey)).reduce((s: number, r: PerformanceData) => s + r.total_sales, 0)
  const gmvLastMonth = perfData.filter((r: PerformanceData) => (r.data_date || r.created_at.split('T')[0]).startsWith(prevMonthKey)).reduce((s: number, r: PerformanceData) => s + r.total_sales, 0)
  const gmvDelta = gmvLastMonth > 0 ? ((gmvThisMonth - gmvLastMonth) / gmvLastMonth) * 100 : null
  const ordersThisMonth = perfData.filter((r: PerformanceData) => (r.data_date || r.created_at.split('T')[0]).startsWith(thisMonthKey)).reduce((s: number, r: PerformanceData) => s + r.order_count, 0)
  const ordersLastMonth = perfData.filter((r: PerformanceData) => (r.data_date || r.created_at.split('T')[0]).startsWith(prevMonthKey)).reduce((s: number, r: PerformanceData) => s + r.order_count, 0)
  const ordersDelta = ordersLastMonth > 0 ? ((ordersThisMonth - ordersLastMonth) / ordersLastMonth) * 100 : null
  const avgGMVPerMerchant = merchantOnly.length > 0 ? totalGMV / merchantOnly.length : 0
  const adminCount = merchants.filter((m: Merchant) => ['admin', 'super_admin'].includes(m.role)).length
  const employeeCount = merchants.filter((m: Merchant) => m.role === 'employee').length
  const topGMV = topMerchants[0]?.gmv || 1

  function Delta({ v }: { v: number | null }) {
    if (v === null) return <span style={{ fontSize: 11, color: 'var(--text3)' }}>—</span>
    const up = v >= 0
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: up ? 'var(--accent2)' : 'var(--red)', background: up ? 'rgba(0,229,176,0.12)' : 'rgba(255,77,109,0.12)', padding: '2px 7px', borderRadius: 20 }}>
        {up ? '▲' : '▼'} {Math.abs(v).toFixed(1)}%
      </span>
    )
  }

  const kpis = [
    { label: 'التجار النشطون', value: merchantOnly.length, icon: '👥', color: '#7c6bff', sub: `${adminCount} مدير · ${employeeCount} موظف` },
    { label: 'GMV هذا الشهر', value: fmt(gmvThisMonth), icon: '💰', color: '#00e5b0', sub: 'الشهر الماضي: ' + fmt(gmvLastMonth), delta: gmvDelta },
    { label: 'طلبات هذا الشهر', value: ordersThisMonth.toLocaleString('ar-SA'), icon: '📦', color: '#ff9900', sub: 'الشهر الماضي: ' + ordersLastMonth.toLocaleString('ar-SA'), delta: ordersDelta },
    { label: 'متوسط GMV / تاجر', value: fmt(avgGMVPerMerchant), icon: '📈', color: '#4cc9f0', sub: 'إجمالي كل الوقت' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {kpis.map((k, i) => (
          <div key={i} style={{ ...S.kpiCard, padding: 18 }}>
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: k.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color, letterSpacing: '-0.5px', lineHeight: 1 }}>{k.value}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--text3)', flex: 1 }}>{k.sub}</span>
              {k.delta !== undefined && <Delta v={k.delta} />}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <div style={S.chartCard}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={S.chartTitle}>اتجاه الإيرادات — آخر 30 يوم</div>
              <div style={S.chartSub}>جميع التجار والمنصات مجتمعة</div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 20 }}>GMV الكلي: {fmt(totalGMV)}</span>
          </div>
          {gmvTrend.length === 0 ? (
            <div style={S.emptyChart}>لا توجد بيانات بعد</div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={gmvTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="adminGmvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c6bff" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#7c6bff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, color: 'var(--text)', fontSize: 12 }} formatter={(v: number) => [fmt(v), 'الإيرادات']} />
                <Area type="monotone" dataKey="gmv" stroke="#7c6bff" strokeWidth={2.5} fill="url(#adminGmvGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={S.chartCard}>
          <div style={{ marginBottom: 14 }}>
            <div style={S.chartTitle}>توزيع المنصات</div>
            <div style={S.chartSub}>حصة كل منصة من GMV الكلي</div>
          </div>
          {gmvByPlatform.length === 0 ? (
            <div style={S.emptyChart}>لا توجد بيانات</div>
          ) : (
            <div>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={gmvByPlatform} dataKey="gmv" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={4} startAngle={90} endAngle={-270}>
                    {gmvByPlatform.map((_: any, i: number) => (
                      <Cell key={i} fill={Object.values(PLATFORM_COLORS)[i] || CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, color: 'var(--text)', fontSize: 12 }} formatter={(v: number, _: any, props: any) => [fmt(v), props.payload.name]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {gmvByPlatform.map((p: any, i: number) => {
                  const pct = totalGMV > 0 ? (p.gmv / totalGMV * 100) : 0
                  const color = Object.values(PLATFORM_COLORS)[i] || CHART_COLORS[i % CHART_COLORS.length]
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600 }}>{p.name}</span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{pct.toFixed(1)}%</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={S.chartCard}>
          <div style={{ marginBottom: 16 }}>
            <div style={S.chartTitle}>🏆 أفضل التجار — GMV الكلي</div>
            <div style={S.chartSub}>مرتبون تنازلياً</div>
          </div>
          {topMerchants.length === 0 ? (
            <div style={S.emptyChart}>لا يوجد تجار بعد</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {topMerchants.map((m: any, i: number) => {
                const pct = topGMV > 0 ? (m.gmv / topGMV * 100) : 0
                const rankColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#7c6bff', '#00e5b0']
                const rc = rankColors[i] || '#7c6bff'
                return (
                  <div key={m.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 6, background: rc + '22', color: rc, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.name}</span>
                      <HealthScoreBadge merchantCode={m.merchant_code} />
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>{m.merchant_code}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: rc }}>{fmt(m.gmv)}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${rc},${rc}99)`, borderRadius: 4, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={S.chartCard}>
          <div style={{ marginBottom: 14 }}>
            <div style={S.chartTitle}>⚡ آخر النشاطات</div>
            <div style={S.chartSub}>آخر عمليات إدخال ومزامنة</div>
          </div>
          {syncLogs.length === 0 ? (
            <div style={S.emptyChart}>لا توجد نشاطات</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {syncLogs.map((l: SyncLog, i: number) => {
                const isSuccess = l.status === 'success'
                const isError = l.status === 'error'
                const dotColor = isSuccess ? 'var(--accent2)' : isError ? 'var(--red)' : '#ffd166'
                return (
                  <div key={l.id} style={{ display: 'flex', gap: 12, paddingBottom: i < syncLogs.length - 1 ? 12 : 0, marginBottom: i < syncLogs.length - 1 ? 12 : 0, borderBottom: i < syncLogs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 3, flexShrink: 0 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
                      {i < syncLogs.length - 1 && <div style={{ width: 1, flex: 1, background: 'var(--border)', marginTop: 4 }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{l.merchant_code}</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>·</span>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{PLATFORM_MAP[l.platform] || l.platform}</span>
                        <span style={{ marginRight: 'auto', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: isSuccess ? 'rgba(0,229,176,0.12)' : isError ? 'rgba(255,77,109,0.12)' : 'rgba(255,209,102,0.12)', color: isSuccess ? 'var(--accent2)' : isError ? 'var(--red)' : '#ffd166' }}>
                          {isSuccess ? 'نجح' : isError ? 'خطأ' : 'جاري'}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{relativeTime(l.started_at)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


function HealthScoreBadge({ merchantCode }: { merchantCode: string }) {
  const [score, setScore] = useState<{ score: number; rating: string } | null>(null)
  useEffect(() => {
    supabase.rpc('merchant_health_score', { p_merchant_code: merchantCode })
      .then(({ data }) => setScore(data))
  }, [merchantCode])
  if (!score) return <span style={{ width: 50 }} />
  const c = score.score >= 80 ? '#00b894' : score.score >= 60 ? '#4cc9f0' : score.score >= 40 ? '#ff9900' : '#e84040'
  return (
    <span title={score.rating} style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: c + '20', color: c, border: `1px solid ${c}40` }}>
      {score.score}/100
    </span>
  )
}
