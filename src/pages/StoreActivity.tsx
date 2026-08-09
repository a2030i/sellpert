import { useCallback, useEffect, useState } from 'react'
import { Activity, Filter, History, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Merchant } from '../lib/supabase'
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITIES, activitySummary, fetchActivityFeed, type ActivityEntry } from '../lib/activityFeed'
import { Card, EmptyState, PageHeader, Pagination, Skeleton } from '../components/UI'
import { fmtDate, fmtRelative } from '../lib/formatters'
import './StoreActivity.css'

const PAGE_SIZE = 30

export default function StoreActivity({ merchant }: { merchant: Merchant | null }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!merchant?.merchant_code) return
    setLoading(true); setError('')
    try {
      const result = await fetchActivityFeed({ merchantCode: merchant.merchant_code, page, limit: PAGE_SIZE, action, table: entity })
      setEntries(result.entries); setTotal(result.total)
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل سجل النشاط.')
    }
    setLoading(false)
  }, [merchant?.merchant_code, page, action, entity])

  useEffect(() => { load() }, [load])

  return (
    <div className="merchant-activity-page">
      <PageHeader title="سجل النشاط" description="تابع التغييرات الحساسة التي نُفذت على حساب المتجر والربط والملفات." icon={History} action={<button className="activity-refresh" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'is-spinning' : ''} /> تحديث</button>} />

      <div className="activity-privacy-note"><ShieldCheck size={18} /><div><strong>سجل آمن وغير قابل للتعديل</strong><span>يعرض نوع الإجراء ومن نفذه ووقته فقط. كلمات المرور ومفاتيح API وقيم الحقول لا تظهر هنا.</span></div></div>

      <Card style={{ padding: 14, marginBottom: 16 }}>
        <div className="activity-filters"><span className="activity-filters__label"><Filter size={15} /> تصفية</span><select aria-label="تصفية حسب الإجراء" value={action} onChange={e => { setAction(e.target.value); setPage(1) }}><option value="">كل الإجراءات</option><option value="insert">إضافة</option><option value="update">تعديل</option><option value="delete">حذف</option></select><select aria-label="تصفية حسب نوع السجل" value={entity} onChange={e => { setEntity(e.target.value); setPage(1) }}><option value="">كل أنواع النشاط</option>{Object.entries(ACTIVITY_ENTITIES).filter(([key]) => key !== 'operational_record').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><span className="activity-filters__count">{total.toLocaleString('ar-SA-u-nu-latn')} عملية</span></div>
      </Card>

      {error ? <div className="activity-error" role="alert">{error}<button onClick={load}>إعادة المحاولة</button></div> : null}
      {loading ? <ActivitySkeleton /> : entries.length === 0 ? <EmptyState icon={<Activity size={23} />} title="لا يوجد نشاط مطابق" description="ستظهر هنا تغييرات الحساب والربط والملفات فور تنفيذها." /> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="activity-list">
            {entries.map(entry => <div className="activity-row" key={entry.id}><span className={`activity-row__icon action-${entry.action}`}><Activity size={17} /></span><div className="activity-row__copy"><div><strong>{ACTIVITY_ACTIONS[entry.action] || 'إجراء'}</strong><span>على {ACTIVITY_ENTITIES[entry.entity] || 'سجل تشغيلي'}</span></div><p>{activitySummary(entry)}</p><small>بواسطة {entry.actor || 'النظام'}</small></div><time title={fmtDate(entry.occurred_at)}>{fmtRelative(entry.occurred_at)}</time></div>)}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </Card>
      )}
    </div>
  )
}

function ActivitySkeleton() {
  return <Card>{[1, 2, 3, 4].map(i => <div key={i} style={{ display: 'flex', gap: 12, marginBottom: i === 4 ? 0 : 18 }}><Skeleton width={38} height={38} radius={10} /><div style={{ flex: 1 }}><Skeleton width="45%" height={14} style={{ marginBottom: 7 }} /><Skeleton width="70%" height={11} /></div></div>)}</Card>
}
