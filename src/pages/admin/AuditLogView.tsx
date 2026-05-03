import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S, PLATFORM_MAP } from './adminShared'
import { fmtRelative, fmtDate } from '../../lib/formatters'
import { Pagination, EmptyState } from '../../components/UI'

type Merchant = { merchant_code: string; name: string }

const ACTION_ICONS: Record<string, string> = {
  insert: '➕', update: '✏️', delete: '🗑️',
}

export default function AuditLogView({ merchants }: { merchants: Merchant[] }) {
  const [logs, setLogs] = useState<any[]>([])
  const [merchantFilter, setMerchantFilter] = useState('')
  const [tableFilter, setTableFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const PAGE_SIZE = 50

  useEffect(() => { load() /* eslint-disable-line */ }, [merchantFilter, tableFilter, page])

  async function load() {
    setLoading(true)
    let query = supabase.from('audit_log').select('*', { count: 'exact' })
      .order('performed_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (merchantFilter) query = query.eq('merchant_code', merchantFilter)
    if (tableFilter)    query = query.eq('table_name', tableFilter)
    const { data, count } = await query
    setLogs(data || [])
    setTotal(count || 0)
    setLoading(false)
  }

  const tables = Array.from(new Set(logs.map(l => l.table_name).filter(Boolean)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📜 سجل التدقيق</h3>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>كل التغييرات اللي صارت في النظام مع المنفذ والوقت</p>
      </div>

      {/* Filters */}
      <div style={{ ...S.formCard, padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select value={merchantFilter} onChange={e => { setMerchantFilter(e.target.value); setPage(1) }} style={{ ...S.input, fontSize: 12, minWidth: 220 }}>
          <option value="">كل التجار</option>
          {merchants.map(m => <option key={m.merchant_code} value={m.merchant_code}>{m.name}</option>)}
        </select>
        <select value={tableFilter} onChange={e => { setTableFilter(e.target.value); setPage(1) }} style={{ ...S.input, fontSize: 12, minWidth: 180 }}>
          <option value="">كل الجداول</option>
          {tables.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>{total.toLocaleString('ar-SA')} سجل</span>
      </div>

      {loading ? null : logs.length === 0 ? (
        <EmptyState icon="📋" title="لا توجد سجلات" description="سجلات التدقيق ستظهر هنا عند حدوث تغييرات في البيانات" />
      ) : (
        <div style={{ ...S.tableCard }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>{['الوقت', 'المنفذ', 'الإجراء', 'الجدول', 'التاجر', 'التفاصيل'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} style={S.tr}>
                    <td style={{ ...S.td, fontSize: 11, whiteSpace: 'nowrap' }} title={fmtDate(l.performed_at)}>{fmtRelative(l.performed_at)}</td>
                    <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)' }}>{l.performed_by || '—'}</td>
                    <td style={S.td}>{ACTION_ICONS[l.action] || ''} <span style={{ fontWeight: 700 }}>{l.action}</span></td>
                    <td style={{ ...S.td, fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)' }}>{l.table_name || '—'}</td>
                    <td style={{ ...S.td, fontSize: 11 }}>{l.merchant_code || '—'}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(l.new_values || l.old_values || {})}>
                      {l.new_values ? JSON.stringify(l.new_values).slice(0, 80) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      )}
    </div>
  )
}
