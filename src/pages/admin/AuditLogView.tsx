import { useEffect, useMemo, useState } from 'react'
import { S } from './adminShared'
import { fmtRelative, fmtDate } from '../../lib/formatters'
import { Pagination, EmptyState } from '../../components/UI'
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITIES, activitySummary, fetchActivityFeed, type ActivityEntry } from '../../lib/activityFeed'

type Merchant = { merchant_code: string; name: string }

export default function AuditLogView({ merchants }: { merchants: Merchant[] }) {
  const [logs, setLogs] = useState<ActivityEntry[]>([])
  const [merchantFilter, setMerchantFilter] = useState('')
  const [tableFilter, setTableFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const PAGE_SIZE = 50

  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [merchantFilter, tableFilter, page])

  async function load() {
    setLoading(true); setError('')
    try {
      const result = await fetchActivityFeed({ merchantCode: merchantFilter, table: tableFilter, page, limit: PAGE_SIZE })
      setLogs(result.entries); setTotal(result.total)
    } catch (e: any) {
      setLogs([]); setTotal(0); setError(e?.message || 'تعذر تحميل سجل التدقيق.')
    }
    setLoading(false)
  }

  const tables = useMemo(() => Object.keys(ACTIVITY_ENTITIES).filter(key => key !== 'operational_record'), [])
  const merchantNames = useMemo(() => new Map(merchants.map(merchant => [merchant.merchant_code, merchant.name])), [merchants])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>سجل أمني للعمليات الحساسة يوضح الإجراء والمنفذ والوقت، من دون عرض كلمات المرور أو مفاتيح الربط.</p>
      </div>

      <div style={{ ...S.formCard, padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select aria-label="تصفية سجل التدقيق حسب المتجر" value={merchantFilter} onChange={event => { setMerchantFilter(event.target.value); setPage(1) }} style={{ ...S.input, fontSize: 12, minWidth: 220 }}>
          <option value="">كل المتاجر</option>
          {merchants.map(merchant => <option key={merchant.merchant_code} value={merchant.merchant_code}>{merchant.name}</option>)}
        </select>
        <select aria-label="تصفية سجل التدقيق حسب نوع السجل" value={tableFilter} onChange={event => { setTableFilter(event.target.value); setPage(1) }} style={{ ...S.input, fontSize: 12, minWidth: 180 }}>
          <option value="">كل أنواع السجلات</option>
          {tables.map(table => <option key={table} value={table}>{ACTIVITY_ENTITIES[table] || 'سجل تشغيلي'}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>{total.toLocaleString('ar-SA-u-nu-latn')} عملية</span>
      </div>

      {error ? <div style={{ ...S.formCard, color: 'var(--danger-text)', background: 'var(--danger-bg)', fontSize: 12 }}>{error}</div> : loading ? null : logs.length === 0 ? (
        <EmptyState icon="" title="لا توجد عمليات مسجلة" description="ستظهر هنا التغييرات الحساسة فور حدوثها في النظام." />
      ) : (
        <div style={S.tableCard}>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>{['الوقت', 'المنفذ', 'الإجراء', 'نوع السجل', 'المتجر', 'الملخص'].map(heading => <th key={heading} style={S.th}>{heading}</th>)}</tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} style={S.tr}>
                    <td style={{ ...S.td, fontSize: 11, whiteSpace: 'nowrap' }} title={fmtDate(log.occurred_at)}>{fmtRelative(log.occurred_at)}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>{log.actor || 'النظام'}</td>
                    <td style={{ ...S.td, fontWeight: 700 }}>{ACTIVITY_ACTIONS[log.action] || 'إجراء'}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--accent)' }}>{ACTIVITY_ENTITIES[log.entity] || 'سجل تشغيلي'}</td>
                    <td style={{ ...S.td, fontSize: 11 }}>{(log.merchant_code ? merchantNames.get(log.merchant_code) : undefined) || log.merchant_code || 'إدارة المنصة'}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{activitySummary(log)}</td>
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
