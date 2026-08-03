import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'
import { fmtRelative, fmtDate } from '../../lib/formatters'
import { Pagination, EmptyState } from '../../components/UI'

type Merchant = { merchant_code: string; name: string }

const ACTION_LABELS: Record<string, string> = {
  insert: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
}

const ENTITY_LABELS: Record<string, string> = {
  merchants: 'حسابات المتاجر',
  platform_credentials: 'بيانات ربط المنصات',
  platform_connections: 'اتصالات المنصات',
  merchant_account_links: 'روابط حسابات المتاجر',
  platform_file_uploads: 'الملفات المرفوعة',
  merchant_requests: 'طلبات المتاجر',
  payment_requests: 'طلبات التحويل',
}

function changeSummary(log: any) {
  if (log.action === 'delete') return 'تم حذف السجل'
  if (log.action === 'insert') return 'تم إنشاء سجل جديد'

  const before = log.old_values || {}
  const after = log.new_values || {}
  const ignored = new Set(['updated_at', 'created_at', 'last_sync_at', 'last_tested_at'])
  const changed = Object.keys(after).filter(key => !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
  if (!changed.length) return 'تم تحديث السجل'
  return `تم تحديث ${changed.length.toLocaleString('ar-SA')} ${changed.length === 1 ? 'حقل' : 'حقول'}`
}

export default function AuditLogView({ merchants }: { merchants: Merchant[] }) {
  const [logs, setLogs] = useState<any[]>([])
  const [merchantFilter, setMerchantFilter] = useState('')
  const [tableFilter, setTableFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const PAGE_SIZE = 50

  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [merchantFilter, tableFilter, page])

  async function load() {
    setLoading(true)
    let query = supabase.from('audit_log').select('*', { count: 'exact' })
      .order('performed_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (merchantFilter) query = query.eq('merchant_code', merchantFilter)
    if (tableFilter) query = query.eq('table_name', tableFilter)
    const { data, count } = await query
    setLogs(data || [])
    setTotal(count || 0)
    setLoading(false)
  }

  const tables = useMemo(() => Array.from(new Set(logs.map(log => log.table_name).filter(Boolean))), [logs])
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
          {tables.map(table => <option key={table} value={table}>{ENTITY_LABELS[table] || 'سجل تشغيلي'}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>{total.toLocaleString('ar-SA')} عملية</span>
      </div>

      {loading ? null : logs.length === 0 ? (
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
                    <td style={{ ...S.td, fontSize: 11, whiteSpace: 'nowrap' }} title={fmtDate(log.performed_at)}>{fmtRelative(log.performed_at)}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>{log.performed_by || 'النظام'}</td>
                    <td style={{ ...S.td, fontWeight: 700 }}>{ACTION_LABELS[log.action] || 'إجراء'}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--accent)' }}>{ENTITY_LABELS[log.table_name] || 'سجل تشغيلي'}</td>
                    <td style={{ ...S.td, fontSize: 11 }}>{merchantNames.get(log.merchant_code) || log.merchant_code || 'إدارة المنصة'}</td>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>{changeSummary(log)}</td>
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
