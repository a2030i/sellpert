import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, fmt } from './adminShared'
import type { Merchant, PerformanceData } from '../../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface RevenueEdit {
  subscription_monthly_amount: string
  sellpert_commission_rate: string
  fixed_fee_per_order: string
}

export default function RevenueView({ merchants, perfData }: { merchants: Merchant[]; perfData: PerformanceData[] }) {
  const [rates, setRates]   = useState<Record<string, { sub: number; comm: number; fixed: number }>>({})
  const [editId, setEditId] = useState<string | null>(null)
  const [editVals, setEditVals] = useState<RevenueEdit>({ subscription_monthly_amount: '', sellpert_commission_rate: '', fixed_fee_per_order: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const map: Record<string, { sub: number; comm: number; fixed: number }> = {}
    merchants.forEach(m => {
      map[m.id] = {
        sub:   m.subscription_monthly_amount   ?? 0,
        comm:  m.sellpert_commission_rate ?? 5,
        fixed: m.fixed_fee_per_order       ?? 0,
      }
    })
    setRates(map)
  }, [merchants])

  const now = new Date()
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const revenueByMerchant = useMemo(() => {
    const map: Record<string, { gmv: number; commEarned: number; fixedEarned: number; gmvMonth: number; commMonth: number; fixedMonth: number; ordersAll: number; ordersMonth: number }> = {}
    for (const m of merchants) {
      const r = rates[m.id] ?? { sub: 0, comm: m.sellpert_commission_rate ?? 5, fixed: 0 }
      const rows = perfData.filter(row => row.merchant_code === m.merchant_code)
      const rowsMonth = rows.filter(row => (row.data_date || row.created_at.split('T')[0]).startsWith(thisMonthKey))
      const gmv      = rows.reduce((s, row) => s + row.total_sales, 0)
      const gmvMonth = rowsMonth.reduce((s, row) => s + row.total_sales, 0)
      const ordersAll   = rows.reduce((s, row) => s + (row.order_count ?? 0), 0)
      const ordersMonth = rowsMonth.reduce((s, row) => s + (row.order_count ?? 0), 0)
      map[m.id] = {
        gmv, gmvMonth, ordersAll, ordersMonth,
        commEarned:  Math.round(gmv * r.comm / 100),
        commMonth:   Math.round(gmvMonth * r.comm / 100),
        fixedEarned: Math.round(ordersAll * r.fixed),
        fixedMonth:  Math.round(ordersMonth * r.fixed),
      }
    }
    return map
  }, [merchants, perfData, rates, thisMonthKey])

  const totSub      = merchants.reduce((s, m) => s + (rates[m.id]?.sub ?? 0), 0)
  const totCommAll  = Object.values(revenueByMerchant).reduce((s, v) => s + v.commEarned, 0)
  const totFixed    = Object.values(revenueByMerchant).reduce((s, v) => s + v.fixedEarned, 0)
  const totMonth    = Object.values(revenueByMerchant).reduce((s, v) => s + v.commMonth + v.fixedMonth, 0) + totSub
  const totGMV      = Object.values(revenueByMerchant).reduce((s, v) => s + v.gmv, 0)

  const commTrend = useMemo(() => {
    const map: Record<string, number> = {}
    for (const m of merchants) {
      const r = rates[m.id] ?? { sub: 0, comm: m.sellpert_commission_rate ?? 5, fixed: 0 }
      const rows = perfData.filter(row => row.merchant_code === m.merchant_code)
      for (const row of rows) {
        const d = row.data_date || row.created_at.split('T')[0]
        const mk = d.slice(0, 7)
        map[mk] = (map[mk] || 0) + Math.round(row.total_sales * r.comm / 100) + Math.round((row.order_count ?? 0) * r.fixed)
      }
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([k, v]) => {
      const [yr, mo] = k.split('-')
      return { month: new Date(+yr, +mo - 1, 1).toLocaleDateString('ar-SA', { month: 'short', year: '2-digit' }), rev: v }
    })
  }, [merchants, perfData, rates])

  async function saveRow(merchantId: string) {
    const sub   = parseFloat(editVals.subscription_monthly_amount)
    const comm  = parseFloat(editVals.sellpert_commission_rate)
    const fixed = parseFloat(editVals.fixed_fee_per_order)
    if ([sub, comm, fixed].some(v => isNaN(v) || v < 0)) return
    if (comm > 100) return
    setSaving(true)
    await supabase.from('merchants').update({
      subscription_monthly_amount: sub,
      sellpert_commission_rate: comm,
      fixed_fee_per_order: fixed,
    }).eq('id', merchantId)
    setRates(prev => ({ ...prev, [merchantId]: { sub, comm, fixed } }))
    setEditId(null)
    setSaving(false)
  }

  const avgComm = merchants.length > 0
    ? merchants.reduce((s, m) => s + (rates[m.id]?.comm ?? m.sellpert_commission_rate ?? 5), 0) / merchants.length
    : 5

  const numInput: React.CSSProperties = {
    ...S.input, width: 80, padding: '5px 8px', fontSize: 12, textAlign: 'center' as const,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14 }}>
        {[
          { label: 'اشتراكات شهرية',       value: fmt(totSub),     color: '#7c6bff', icon: '💳', sub: `${merchants.length} تاجر` },
          { label: 'عمولة % (كل الوقت)',    value: fmt(totCommAll), color: '#00e5b0', icon: '📊', sub: `متوسط ${avgComm.toFixed(1)}%` },
          { label: 'رسوم ثابتة (كل الوقت)', value: fmt(totFixed),   color: '#f27a1a', icon: '🏷️', sub: 'ر.س/طلب' },
          { label: 'إجمالي هذا الشهر',      value: fmt(totMonth),   color: '#ff9900', icon: '📅', sub: 'اشتراك + عمولة + رسوم' },
          { label: 'GMV الكلي للتجار',      value: fmt(totGMV),     color: '#4cc9f0', icon: '💰', sub: 'كل الوقت' },
        ].map((k, i) => (
          <div key={i} style={{ ...S.kpiCard, padding: 18, position: 'relative', overflow: 'hidden' }}>
            <div style={{ ...S.kpiBar, background: k.color }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: k.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color, letterSpacing: '-0.5px', lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <div style={S.chartCard}>
        <div style={{ marginBottom: 14 }}>
          <div style={S.chartTitle}>📈 اتجاه إيرادات Sellpert الشهرية</div>
          <div style={S.chartSub}>مجموع العمولة + الرسوم الثابتة من جميع التجار شهرياً</div>
        </div>
        {commTrend.length === 0 ? (
          <div style={S.emptyChart}>لا توجد بيانات بعد</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={commTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" tick={{ fill: '#5a5a7a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, color: 'var(--text)', fontSize: 12 }} formatter={(v: number) => [fmt(v), 'الإيرادات']} />
              <Bar dataKey="rev" fill="#7c6bff" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-merchant table */}
      <div style={{ ...S.chartCard, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={S.chartTitle}>👥 إيرادات التجار — 3 مصادر</div>
            <div style={S.chartSub}>اشتراك شهري · نسبة عمولة · رسوم ثابتة لكل طلب</div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['التاجر', 'الكود', 'اشتراك/شهر', 'عمولة %', 'رسوم/طلب', 'GMV الكلي', 'إيراد كلي', 'هذا الشهر', ''].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...merchants]
                .sort((a, b) => (revenueByMerchant[b.id]?.commEarned || 0) - (revenueByMerchant[a.id]?.commEarned || 0))
                .map(m => {
                  const rv  = revenueByMerchant[m.id] || { gmv: 0, commEarned: 0, fixedEarned: 0, gmvMonth: 0, commMonth: 0, fixedMonth: 0, ordersAll: 0, ordersMonth: 0 }
                  const r   = rates[m.id] ?? { sub: 0, comm: m.sellpert_commission_rate ?? 5, fixed: 0 }
                  const isEditing = editId === m.id
                  const totalAll   = rv.commEarned + rv.fixedEarned
                  const totalMonth = r.sub + rv.commMonth + rv.fixedMonth
                  return (
                    <tr key={m.id} style={S.tr}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{m.email}</div>
                      </td>
                      <td style={S.td}><span style={S.codeTag}>{m.merchant_code}</span></td>

                      {/* 3 revenue columns */}
                      <td style={S.td}>
                        {isEditing ? (
                          <input style={numInput} type="number" min="0" step="1" value={editVals.subscription_monthly_amount}
                            onChange={e => setEditVals(p => ({ ...p, subscription_monthly_amount: e.target.value }))} autoFocus />
                        ) : (
                          <span style={{ fontWeight: 700, color: '#7c6bff' }}>{fmt(r.sub)}</span>
                        )}
                      </td>
                      <td style={S.td}>
                        {isEditing ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input style={numInput} type="number" min="0" max="100" step="0.5" value={editVals.sellpert_commission_rate}
                              onChange={e => setEditVals(p => ({ ...p, sellpert_commission_rate: e.target.value }))} />
                            <span style={{ fontSize: 11, color: 'var(--text3)' }}>%</span>
                          </div>
                        ) : (
                          <span style={{ fontWeight: 700, color: '#f27a1a' }}>{r.comm}%</span>
                        )}
                      </td>
                      <td style={S.td}>
                        {isEditing ? (
                          <input style={numInput} type="number" min="0" step="0.5" value={editVals.fixed_fee_per_order}
                            onChange={e => setEditVals(p => ({ ...p, fixed_fee_per_order: e.target.value }))} />
                        ) : (
                          <span style={{ fontWeight: 700, color: '#4cc9f0' }}>{r.fixed > 0 ? `${r.fixed} ر.س` : '—'}</span>
                        )}
                      </td>

                      <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent)' }}>{fmt(rv.gmv)}</td>
                      <td style={{ ...S.td, fontWeight: 700, color: '#7c6bff' }}>{fmt(totalAll)}</td>
                      <td style={{ ...S.td, color: '#00e5b0', fontWeight: 700 }}>{fmt(totalMonth)}</td>
                      <td style={S.td}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={{ ...S.saveBtn, padding: '5px 10px', fontSize: 12 }} onClick={() => saveRow(m.id)} disabled={saving}>✓</button>
                            <button style={{ ...S.miniBtn, fontSize: 12 }} onClick={() => setEditId(null)}>✕</button>
                          </div>
                        ) : (
                          <button style={S.miniBtn} onClick={() => {
                            setEditId(m.id)
                            setEditVals({
                              subscription_monthly_amount: String(r.sub),
                              sellpert_commission_rate:    String(r.comm),
                              fixed_fee_per_order:         String(r.fixed),
                            })
                          }}>تعديل</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

