import { useState, useMemo } from 'react'
import { S, fmt, PLATFORM_MAP, PLATFORM_COLORS } from './adminShared'
import type { Merchant, PerformanceData } from '../../lib/supabase'
import { useEffect } from 'react'
import { filterPerformanceRows, performanceDateKey, summarizePerformance, type PerformancePreset } from '../../lib/adminPerformance'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const PERF_PAGE_SIZE = 50

export default function PerformanceView({ merchants, perfData }: any) {
  const [filterMerchant, setFilterMerchant] = useState('all')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [filterPreset, setFilterPreset] = useState<PerformancePreset>('last30')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    let d = perfData as PerformanceData[]
    if (filterMerchant !== 'all') d = d.filter(r => r.merchant_code === filterMerchant)
    if (filterPlatform !== 'all') d = d.filter(r => r.platform === filterPlatform)
    return filterPerformanceRows(d, filterPreset)
  }, [perfData, filterMerchant, filterPlatform, filterPreset])

  useEffect(() => setPage(0), [filterMerchant, filterPlatform, filterPreset])

  const totalPages = Math.ceil(filtered.length / PERF_PAGE_SIZE)
  const pageRows = filtered.slice(page * PERF_PAGE_SIZE, (page + 1) * PERF_PAGE_SIZE)

  const { sales: totalSales, volume: totalVolume, fees: totalFees } = useMemo(() => summarizePerformance(filtered), [filtered])
  const averageValue = totalVolume > 0 ? totalSales / totalVolume : 0

  const trend = useMemo(() => {
    const map: Record<string, number> = {}
    for (const r of filtered) {
      const d = performanceDateKey(r)
      if (!d) continue
      map[d] = (map[d] || 0) + r.total_sales
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, sales]) => ({
      date: new Date(date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric' }),
      sales: Math.round(sales),
    }))
  }, [filtered])

  const platforms = [...new Set(perfData.map((r: PerformanceData) => r.platform))]

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <select aria-label="تصفية الأداء حسب التاجر" style={S.filterSelect} value={filterMerchant} onChange={e => setFilterMerchant(e.target.value)}>
          <option value="all">كل التجار</option>
          {merchants.map((m: Merchant) => <option key={m.id} value={m.merchant_code}>{m.name}</option>)}
        </select>
        <select aria-label="تصفية الأداء حسب المنصة" style={S.filterSelect} value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
          <option value="all">كل المنصات</option>
          {platforms.map((p: any) => <option key={p} value={p}>{PLATFORM_MAP[p] || p}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { k: 'today', l: 'اليوم' },
            { k: 'last7', l: '7 أيام' },
            { k: 'last30', l: '30 يوم' },
            { k: 'thisMonth', l: 'هذا الشهر' },
            { k: 'all', l: 'الكل' },
          ].map(p => (
            <button key={p.k} aria-pressed={filterPreset === p.k} style={{ ...S.presetBtn, ...(filterPreset === p.k ? S.presetActive : {}) }} onClick={() => setFilterPreset(p.k as PerformancePreset)}>{p.l}</button>
          ))}
        </div>
        <span style={S.badge}>{filtered.length} سجل</span>
        <button style={{ ...S.miniBtn, marginRight: 'auto', fontSize: 12, padding: '6px 14px' }} onClick={() => {
          const headers = ['تاريخ التقرير', 'التاجر', 'المنصة', 'الوحدات/الطلبات', 'المبيعات', 'رسوم المنصة', 'الهامش%', 'الإعلانات']
          const rows = filtered.map((r: PerformanceData) => [
            performanceDateKey(r),
            merchants.find((m: Merchant) => m.merchant_code === r.merchant_code)?.name || r.merchant_code,
            PLATFORM_MAP[r.platform] || r.platform,
            r.order_count, r.total_sales, r.platform_fees || 0, r.margin.toFixed(1), r.ad_spend || 0
          ])
          const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
          const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = `sellpert-perf-${new Date().toISOString().split('T')[0]}.csv`; a.click()
        }}>⬇ تصدير CSV</button>
      </div>

      <div data-kpi-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'إجمالي المبيعات', value: fmt(totalSales), color: 'var(--accent)' },
          { label: 'الوحدات / الطلبات', value: fmt(totalVolume, 'number'), color: 'var(--success-text)' },
          { label: 'متوسط قيمة الوحدة / الطلب', value: fmt(averageValue), color: 'var(--warning-text)' },
          { label: 'رسوم المنصات', value: fmt(totalFees), color: '#ff6b6b' },
        ].map((k, i) => (
          <div key={i} style={{ ...S.kpiCard }}>
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={S.kpiLabel}>{k.label}</div>
            <div style={{ ...S.kpiValue, color: k.color, marginTop: 8 }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ ...S.chartCard, marginBottom: 20 }}>
        <div style={S.chartHeader}>
          <div style={S.chartTitle}>اتجاه المبيعات</div>
          <div style={S.chartSub}>{filtered.length} سجل مرشح · يعتمد التاريخ على فترة التقرير لا وقت الرفع</div>
        </div>
        {trend.length === 0 ? (
          <div style={S.emptyChart}>لا توجد بيانات للفترة المحددة</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text3)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'var(--text3)', fontSize: 10 }} tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, color: 'var(--text)' }} formatter={(v: number) => [fmt(v), 'مبيعات']} />
              <Bar dataKey="sales" fill="var(--accent)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={S.tableCard}>
        <div style={S.tableHeader}>
          <div style={S.chartTitle}>سجل الأداء التفصيلي</div>
          <span style={S.badge}>{filtered.length} سجل</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['تاريخ التقرير', 'التاجر', 'المنصة', 'الوحدات/الطلبات', 'المبيعات', 'رسوم المنصة', 'الهامش', 'الإنفاق'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد بيانات</td></tr>
              ) : pageRows.map((r: PerformanceData) => (
                <tr key={r.id} style={S.tr}>
                  <td style={{ ...S.td, fontSize: 11 }}>{new Date(`${performanceDateKey(r)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.merchant_code}</td>
                  <td style={S.td}>
                    <span style={{ ...S.platformTag, background: (PLATFORM_COLORS[r.platform] || '#5a5a7a') + '22', color: PLATFORM_COLORS[r.platform] || 'var(--text3)' }}>
                      {PLATFORM_MAP[r.platform] || r.platform}
                    </span>
                  </td>
                  <td style={S.td}>{r.order_count.toLocaleString()}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{fmt(r.total_sales)}</td>
                  <td style={S.td}>{fmt(r.platform_fees || 0)}</td>
                  <td style={{ ...S.td, color: r.margin >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{r.margin.toFixed(1)}%</td>
                  <td style={S.td}>{fmt(r.ad_spend || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              {page * PERF_PAGE_SIZE + 1}–{Math.min((page + 1) * PERF_PAGE_SIZE, filtered.length)} من {filtered.length}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...S.miniBtn, opacity: page === 0 ? 0.4 : 1 }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>›</button>
              <span style={{ fontSize: 12, color: 'var(--text2)', padding: '4px 8px' }}>{page + 1} / {totalPages}</span>
              <button style={{ ...S.miniBtn, opacity: page >= totalPages - 1 ? 0.4 : 1 }} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>‹</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
