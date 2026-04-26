import { useState } from 'react'
import { S, PLATFORM_MAP, PLATFORM_COLORS } from './adminShared'
import type { Merchant, SyncLog } from '../../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export default function SyncLogsView({ merchants, syncLogs }: any) {
  const [filterMerchant, setFilterMerchant] = useState('all')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  const filtered = syncLogs.filter((l: SyncLog) => {
    if (filterMerchant !== 'all' && l.merchant_code !== filterMerchant) return false
    if (filterPlatform !== 'all' && l.platform !== filterPlatform) return false
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    return true
  })

  const platforms = [...new Set(syncLogs.map((l: SyncLog) => l.platform))]
  const stats = {
    total: syncLogs.length,
    success: syncLogs.filter((l: SyncLog) => l.status === 'success').length,
    error: syncLogs.filter((l: SyncLog) => l.status === 'error').length,
    running: syncLogs.filter((l: SyncLog) => l.status === 'running').length,
  }

  const chartData = (() => {
    const byDay: Record<string, { success: number; error: number }> = {}
    for (const l of syncLogs) {
      const d = l.started_at.split('T')[0]
      if (!byDay[d]) byDay[d] = { success: 0, error: 0 }
      if (l.status === 'success') byDay[d].success++
      if (l.status === 'error') byDay[d].error++
    }
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([date, v]) => ({
      date: new Date(date).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }), ...v,
    }))
  })()

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'إجمالي', value: stats.total, color: 'var(--text)' },
          { label: 'ناجح', value: stats.success, color: 'var(--green)' },
          { label: 'خطأ', value: stats.error, color: 'var(--red)' },
          { label: 'جاري', value: stats.running, color: '#ffd166' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 20px', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select style={S.filterSelect} value={filterMerchant} onChange={e => setFilterMerchant(e.target.value)}>
          <option value="all">كل التجار</option>
          {merchants.map((m: Merchant) => <option key={m.id} value={m.merchant_code}>{m.name}</option>)}
        </select>
        <select style={S.filterSelect} value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
          <option value="all">كل المنصات</option>
          {platforms.map((p: any) => <option key={p} value={p}>{PLATFORM_MAP[p] || p}</option>)}
        </select>
        <select style={S.filterSelect} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">كل الحالات</option>
          <option value="success">ناجح</option>
          <option value="error">خطأ</option>
          <option value="running">جاري</option>
        </select>
        <span style={{ ...S.badge, alignSelf: 'center' }}>{filtered.length} سجل</span>
      </div>

      {chartData.length > 0 && (
        <div style={{ ...S.chartCard, marginBottom: 20 }}>
          <div style={S.chartHeader}><div style={S.chartTitle}>نشاط المزامنات (آخر 14 يوم)</div></div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f2" />
              <XAxis dataKey="date" tick={{ fill: '#5a5a7a', fontSize: 10 }} />
              <YAxis tick={{ fill: '#5a5a7a', fontSize: 10 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, color: 'var(--text)' }} />
              <Bar dataKey="success" fill="#00e5b0" radius={[3, 3, 0, 0]} name="ناجح" stackId="a" />
              <Bar dataKey="error" fill="#ff4d6d" radius={[3, 3, 0, 0]} name="خطأ" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={S.tableCard}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>{['التاجر', 'المنصة', 'الحالة', 'السجلات', 'وقت البداية', 'المدة', 'رسالة الخطأ'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)' }}>لا توجد سجلات</td></tr>
              ) : filtered.map((l: SyncLog) => {
                const duration = l.finished_at ? Math.round((new Date(l.finished_at).getTime() - new Date(l.started_at).getTime()) / 1000) : null
                return (
                  <tr key={l.id} style={S.tr}>
                    <td style={{ ...S.td, fontSize: 12 }}>{l.merchant_code}</td>
                    <td style={S.td}><span style={{ fontSize: 11, fontWeight: 600, color: PLATFORM_COLORS[l.platform] || 'var(--text2)' }}>{PLATFORM_MAP[l.platform] || l.platform}</span></td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: l.status === 'success' ? 'rgba(0,229,176,0.15)' : l.status === 'error' ? 'rgba(255,77,109,0.15)' : 'rgba(255,209,102,0.15)', color: l.status === 'success' ? 'var(--green)' : l.status === 'error' ? 'var(--red)' : '#ffd166' }}>
                        {l.status === 'success' ? '✓ نجح' : l.status === 'error' ? '✕ خطأ' : '⟳ جاري'}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontFamily: 'monospace' }}>{l.records_synced?.toLocaleString() || 0}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{new Date(l.started_at).toLocaleString('ar-SA')}</td>
                    <td style={{ ...S.td, fontSize: 12, fontFamily: 'monospace' }}>{duration !== null ? `${duration}ث` : '—'}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--red)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.error_message || '—'}</td>
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

