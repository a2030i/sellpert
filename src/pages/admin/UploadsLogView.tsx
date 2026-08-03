import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, FileText, FilterX, RefreshCw, Search, Upload } from 'lucide-react'
import { supabase, type Merchant } from '../../lib/supabase'
import { EmptyState, Pagination, Skeleton } from '../../components/UI'
import { S, PLATFORM_COLORS, PLATFORM_MAP } from './adminShared'
import { UPLOAD_STALLED_AFTER_MS, uploadDisplayStatus } from '../../lib/uploadStatus'

interface UploadRecord {
  id: string
  merchant_code: string
  platform: string
  file_name: string | null
  file_type: string | null
  file_size: number | null
  uploaded_by: string | null
  rows_processed: number | null
  rows_inserted: number | null
  rows_updated: number | null
  status: string | null
  error_message: string | null
  detected_report: string | null
  uploaded_at: string | null
  finished_at: string | null
  fingerprint: string | null
}

const PAGE_SIZE = 25

const FILE_TYPE_LABELS: Record<string, string> = {
  noon_sales: 'مبيعات نون', noon_products: 'كاتالوج نون', noon_asn: 'إرسالية نون (ASN)',
  noon_grn: 'استلام نون (GRN)', noon_ads: 'إعلانات نون',
  amazon_transactions: 'معاملات أمازون', amazon_inventory: 'مخزون أمازون',
  amazon_business_report: 'تقرير أعمال أمازون', amazon_settlement: 'تسوية أمازون',
  amazon_ads: 'إعلانات أمازون', amazon_campaigns: 'حملات أمازون',
  amazon_sales_dashboard: 'لوحة مبيعات أمازون',
  trendyol_sales: 'مبيعات تراندايول', trendyol_products: 'كاتالوج تراندايول',
  trendyol_statement: 'كشف حساب تراندايول', trendyol_ads: 'إعلانات تراندايول', trendyol_deals: 'عروض تراندايول',
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  success: { label: 'ناجح', color: 'var(--success-text)', bg: 'var(--success-bg)' },
  completed: { label: 'ناجح', color: 'var(--success-text)', bg: 'var(--success-bg)' },
  partial: { label: 'جزئي', color: 'var(--warning-text)', bg: 'var(--warning-bg)' },
  failed: { label: 'فشل', color: 'var(--danger-text)', bg: 'var(--danger-bg)' },
  error: { label: 'فشل', color: 'var(--danger-text)', bg: 'var(--danger-bg)' },
  processing: { label: 'قيد المعالجة', color: 'var(--warning-text)', bg: 'var(--warning-bg)' },
  running: { label: 'قيد المعالجة', color: 'var(--warning-text)', bg: 'var(--warning-bg)' },
  stalled: { label: 'متعطل (أكثر من 30 دقيقة)', color: 'var(--danger-text)', bg: 'var(--danger-bg)' },
  unknown: { label: 'غير معروف', color: 'var(--text3)', bg: 'var(--surface2)' },
}

const inputStyle: React.CSSProperties = { ...S.input, fontSize: 12, minWidth: 150, height: 40 }

function fullDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fileSize(value: number | null) {
  if (!value) return '—'
  if (value < 1024) return `${value} بايت`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

function duration(start: string | null, end: string | null) {
  if (!start) return '—'
  const ms = Math.max(0, new Date(end || Date.now()).getTime() - new Date(start).getTime())
  if (ms < 1000) return 'أقل من ثانية'
  if (ms < 60000) return `${Math.round(ms / 1000)} ثانية`
  if (ms < 3600000) return `${Math.round(ms / 60000)} دقيقة`
  return `${(ms / 3600000).toFixed(1)} ساعة`
}

function nextDayStart(value: string) {
  return new Date(new Date(`${value}T00:00:00+03:00`).getTime() + 86400000).toISOString()
}

export default function UploadsLogView({ merchants }: { merchants: Merchant[] }) {
  const [records, setRecords] = useState<UploadRecord[]>([])
  const [selected, setSelected] = useState<UploadRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [merchantFilter, setMerchantFilter] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const merchantList = useMemo(() => merchants.filter(item => item.role === 'merchant'), [merchants])
  const staffList = useMemo(() => merchants.filter(item => item.role !== 'merchant'), [merchants])
  const merchantMap = useMemo(() => new Map(merchantList.map(item => [item.merchant_code, item])), [merchantList])

  const employeeName = useCallback((value: string | null) => {
    if (!value) return 'غير مسجل (رفع قديم)'
    const employee = staffList.find(item => item.email === value || item.id === value || item.merchant_code === value)
    return employee?.name || value
  }, [staffList])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    let query = supabase.from('platform_file_uploads')
      .select('*', { count: 'exact' })
      .order('uploaded_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (merchantFilter) query = query.eq('merchant_code', merchantFilter)
    if (platformFilter) query = query.eq('platform', platformFilter)
    if (typeFilter) query = query.eq('file_type', typeFilter)
    const stalledCutoff = new Date(Date.now() - UPLOAD_STALLED_AFTER_MS).toISOString()
    if (statusFilter === 'success') query = query.in('status', ['success', 'completed'])
    else if (statusFilter === 'failed') query = query.in('status', ['failed', 'error'])
    else if (statusFilter === 'processing') query = query.in('status', ['processing', 'running']).gte('uploaded_at', stalledCutoff)
    else if (statusFilter === 'stalled') query = query.in('status', ['processing', 'running']).lt('uploaded_at', stalledCutoff)
    else if (statusFilter) query = query.eq('status', statusFilter)
    if (employeeFilter === '__missing__') query = query.is('uploaded_by', null)
    else if (employeeFilter) query = query.eq('uploaded_by', employeeFilter)
    if (dateFrom) query = query.gte('uploaded_at', new Date(`${dateFrom}T00:00:00+03:00`).toISOString())
    if (dateTo) query = query.lt('uploaded_at', nextDayStart(dateTo))
    if (search) query = query.ilike('file_name', `%${search.replace(/[%_]/g, '\\$&')}%`)

    const { data, count, error: queryError } = await query
    if (queryError) setError(queryError.message)
    setRecords((data || []) as UploadRecord[])
    setTotal(count || 0)
    setLoading(false)
  }, [page, merchantFilter, platformFilter, typeFilter, statusFilter, employeeFilter, dateFrom, dateTo, search])

  useEffect(() => { load() }, [load])

  const resetFilters = () => {
    setSearchInput(''); setSearch(''); setMerchantFilter(''); setPlatformFilter(''); setTypeFilter('')
    setStatusFilter(''); setEmployeeFilter(''); setDateFrom(''); setDateTo(''); setPage(1)
  }

  const applySearch = () => { setSearch(searchInput.trim()); setPage(1) }
  const activeFilters = [search, merchantFilter, platformFilter, typeFilter, statusFilter, employeeFilter, dateFrom, dateTo].filter(Boolean).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1450, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>سجل عمليات الاستيراد</div>
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: '5px 0 0' }}>مرجع موحّد لكل ملف: المتجر والمنصة والموظف والنتيجة والوقت وعدد الصفوف</p>
        </div>
        <button onClick={() => { window.history.pushState(null, '', '/admin/import'); window.dispatchEvent(new PopStateEvent('popstate')) }} style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Upload size={14} /> رفع ملفات جديدة
        </button>
      </div>

      <div style={{ ...S.formCard, padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(165px,1fr))', gap: 9 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input aria-label="البحث باسم الملف" value={searchInput} onChange={event => setSearchInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applySearch() }} placeholder="ابحث باسم الملف…" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
            <button aria-label="تنفيذ البحث" onClick={applySearch} style={{ ...S.miniBtn, width: 40, display: 'grid', placeItems: 'center' }}><Search size={15} /></button>
          </div>
          <select aria-label="تصفية حسب المتجر" value={merchantFilter} onChange={event => { setMerchantFilter(event.target.value); setPage(1) }} style={inputStyle}>
            <option value="">كل المتاجر</option>
            {merchantList.map(item => <option key={item.id} value={item.merchant_code}>{item.name} ({item.merchant_code})</option>)}
          </select>
          <select aria-label="تصفية حسب المنصة" value={platformFilter} onChange={event => { setPlatformFilter(event.target.value); setPage(1) }} style={inputStyle}>
            <option value="">كل المنصات</option><option value="noon">نون</option><option value="amazon">أمازون</option><option value="trendyol">تراندايول</option>
          </select>
          <select aria-label="تصفية حسب نوع الملف" value={typeFilter} onChange={event => { setTypeFilter(event.target.value); setPage(1) }} style={inputStyle}>
            <option value="">كل أنواع الملفات</option>
            {Object.entries(FILE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="تصفية حسب الحالة" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1) }} style={inputStyle}>
            <option value="">كل الحالات</option><option value="success">ناجح</option><option value="partial">جزئي</option><option value="failed">فشل</option><option value="processing">قيد المعالجة</option><option value="stalled">متعطل (أكثر من 30 دقيقة)</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 9, marginTop: 9, alignItems: 'center' }}>
          <select aria-label="تصفية حسب الموظف" value={employeeFilter} onChange={event => { setEmployeeFilter(event.target.value); setPage(1) }} style={inputStyle}>
            <option value="">كل الموظفين</option>
            <option value="__missing__">غير مسجل (الرفعات القديمة)</option>
            {staffList.filter(item => item.email).map(item => <option key={item.id} value={item.email!}>{item.name} · {item.email}</option>)}
          </select>
          <input aria-label="من تاريخ" type="date" value={dateFrom} onChange={event => { setDateFrom(event.target.value); setPage(1) }} style={inputStyle} />
          <input aria-label="إلى تاريخ" type="date" value={dateTo} onChange={event => { setDateTo(event.target.value); setPage(1) }} style={inputStyle} />
          <button onClick={resetFilters} disabled={activeFilters === 0} style={{ ...S.miniBtn, height: 40, display: 'flex', alignItems: 'center', gap: 6, opacity: activeFilters ? 1 : 0.5 }}><FilterX size={14} /> مسح الفلاتر</button>
          <div style={{ textAlign: 'left', fontSize: 12, color: 'var(--text3)' }}><b style={{ color: 'var(--text)' }}>{total.toLocaleString('ar-SA')}</b> عملية {activeFilters > 0 && `· ${activeFilters} فلتر نشط`}</div>
        </div>
      </div>

      {error && <div style={{ padding: 12, borderRadius: 9, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 12 }}>تعذّر تحميل السجل: {error}</div>}

      {loading ? (
        <div style={{ ...S.tableCard, padding: 18 }}>{Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} height={42} style={{ marginBottom: 7 }} />)}</div>
      ) : records.length === 0 ? (
        <EmptyState icon={<FileText size={28} />} title="لا توجد عمليات مطابقة" description="غيّر الفلاتر أو ارفع أول ملف لتظهر تفاصيله هنا" />
      ) : (
        <div style={S.tableCard}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...S.table, minWidth: 1120 }}>
              <thead><tr>{['التاريخ والوقت', 'المتجر', 'المنصة', 'نوع التقرير', 'اسم الملف', 'رفعه الموظف', 'الصفوف', 'الحالة', ''].map(header => <th key={header} style={S.th}>{header}</th>)}</tr></thead>
              <tbody>{records.map(record => {
                const status = STATUS_META[uploadDisplayStatus(record.status, record.uploaded_at)]
                const merchant = merchantMap.get(record.merchant_code)
                return (
                  <tr key={record.id} style={S.tr}>
                    <td style={{ ...S.td, whiteSpace: 'nowrap', fontSize: 11 }}><div style={{ fontWeight: 700 }}>{fullDate(record.uploaded_at)}</div><div style={{ color: 'var(--text3)', marginTop: 3 }}>{duration(record.uploaded_at, record.finished_at)}</div></td>
                    <td style={S.td}><div style={{ fontSize: 12, fontWeight: 700 }}>{merchant?.name || record.merchant_code}</div><div style={{ fontSize: 10, color: 'var(--text3)' }}>{record.merchant_code}</div></td>
                    <td style={S.td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: PLATFORM_COLORS[record.platform] || 'var(--text3)' }} />{PLATFORM_MAP[record.platform] || record.platform}</span></td>
                    <td style={{ ...S.td, fontSize: 11 }}>{record.detected_report || FILE_TYPE_LABELS[record.file_type || ''] || record.file_type || '—'}</td>
                    <td style={{ ...S.td, maxWidth: 260 }}><div title={record.file_name || ''} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><FileText size={14} style={{ flexShrink: 0, color: 'var(--text3)' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{record.file_name || '—'}</span></div><div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{fileSize(record.file_size)}</div></td>
                    <td style={{ ...S.td, fontSize: 11 }}>{employeeName(record.uploaded_by)}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}><div style={{ fontSize: 12, fontWeight: 800 }}>{(record.rows_inserted || 0).toLocaleString('ar-SA')}</div><div style={{ fontSize: 9, color: 'var(--text3)' }}>من {(record.rows_processed || 0).toLocaleString('ar-SA')} معالج</div></td>
                    <td style={S.td}><span style={{ background: status.bg, color: status.color, padding: '4px 9px', borderRadius: 20, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>{status.label}</span></td>
                    <td style={S.td}><button aria-label={`تفاصيل ${record.file_name || 'عملية الرفع'}`} onClick={() => setSelected(record)} style={{ ...S.miniBtn, display: 'flex', alignItems: 'center', gap: 5 }}><Eye size={13} /> التفاصيل</button></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      )}

      <button onClick={load} style={{ ...S.miniBtn, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6 }}><RefreshCw size={13} /> تحديث السجل</button>

      {selected && (
        <div role="dialog" aria-modal="true" aria-label="تفاصيل عملية الرفع" onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(8,12,30,.62)', display: 'grid', placeItems: 'center', padding: 18 }}>
          <div onClick={event => event.stopPropagation()} style={{ width: 'min(680px,100%)', maxHeight: '88vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, boxShadow: '0 22px 60px rgba(0,0,0,.35)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
              <div><div style={{ fontSize: 16, fontWeight: 800 }}>تفاصيل عملية الرفع</div><div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{selected.id}</div></div>
              <button aria-label="إغلاق التفاصيل" onClick={() => setSelected(null)} style={S.miniBtn}>إغلاق</button>
            </div>
            <Detail label="اسم الملف" value={selected.file_name || '—'} wide />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 9 }}>
              <Detail label="المتجر" value={`${merchantMap.get(selected.merchant_code)?.name || '—'} · ${selected.merchant_code}`} />
              <Detail label="المنصة" value={PLATFORM_MAP[selected.platform] || selected.platform} />
              <Detail label="نوع التقرير" value={selected.detected_report || FILE_TYPE_LABELS[selected.file_type || ''] || selected.file_type || '—'} />
              <Detail label="معرف نوع الملف" value={selected.file_type || '—'} />
              <Detail label="رفعه الموظف" value={employeeName(selected.uploaded_by)} />
              <Detail label="حجم الملف" value={fileSize(selected.file_size)} />
              <Detail label="بدأ في" value={fullDate(selected.uploaded_at)} />
              <Detail label="انتهى في" value={fullDate(selected.finished_at)} />
              <Detail label="مدة المعالجة" value={duration(selected.uploaded_at, selected.finished_at)} />
              <Detail label="الحالة" value={STATUS_META[uploadDisplayStatus(selected.status, selected.uploaded_at)].label} />
              <Detail label="الصفوف المعالجة" value={(selected.rows_processed || 0).toLocaleString('ar-SA')} />
              <Detail label="الصفوف المحفوظة" value={(selected.rows_inserted || 0).toLocaleString('ar-SA')} />
              <Detail label="الصفوف المحدّثة" value={(selected.rows_updated || 0).toLocaleString('ar-SA')} />
              <Detail label="بصمة الملف" value={selected.fingerprint || '—'} mono />
            </div>
            {selected.error_message && <Detail label="رسالة الخطأ" value={selected.error_message} wide danger />}
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, wide, mono, danger }: { label: string; value: string; wide?: boolean; mono?: boolean; danger?: boolean }) {
  return <div style={{ gridColumn: wide ? '1 / -1' : undefined, background: danger ? 'var(--danger-bg)' : 'var(--surface2)', borderRadius: 9, padding: '10px 12px', marginBottom: wide ? 9 : 0 }}><div style={{ fontSize: 10, color: danger ? 'var(--danger-text)' : 'var(--text3)', marginBottom: 4 }}>{label}</div><div style={{ fontSize: 12, fontWeight: 700, color: danger ? 'var(--danger-text)' : 'var(--text)', fontFamily: mono ? 'monospace' : 'inherit', overflowWrap: 'anywhere' }}>{value}</div></div>
}
