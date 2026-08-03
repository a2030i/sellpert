import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleDot, Clock3, ListChecks, RefreshCw } from 'lucide-react'
import { supabase, type Merchant } from '../lib/supabase'
import { updateMerchantActionStatus } from '../lib/merchantActions'
import { toastErr, toastOk } from '../components/Toast'
import './Actions.css'

type ActionStatus = 'pending' | 'in_progress' | 'done'
type MerchantAction = {
  id: string; title: string; note: string | null; expected_impact: string | null
  category: string | null; priority: string | null; status: ActionStatus
  due_date: string | null; source_key: string | null; created_at: string
}

const STATUS_LABEL: Record<ActionStatus, string> = {
  pending: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'مكتملة',
}
const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'عاجلة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة',
}

export default function Actions({ merchant }: { merchant: Merchant | null }) {
  const [actions, setActions] = useState<MerchantAction[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!merchant?.merchant_code) {
      setActions([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase.from('merchant_requests')
      .select('id,title,note,expected_impact,category,priority,status,due_date,source_key,created_at')
      .eq('merchant_code', merchant.merchant_code).eq('request_kind', 'action')
      .order('created_at', { ascending: false })
    if (error) toastErr('تعذر تحميل خطة العمل')
    setActions((data || []) as MerchantAction[])
    setLoading(false)
  }, [merchant?.merchant_code])

  useEffect(() => { void load() }, [load])

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return {
      open: actions.filter(action => action.status !== 'done').length,
      inProgress: actions.filter(action => action.status === 'in_progress').length,
      overdue: actions.filter(action => action.status !== 'done' && action.due_date && action.due_date < today).length,
      done: actions.filter(action => action.status === 'done').length,
    }
  }, [actions])

  const visible = useMemo(() => actions.filter(action => filter === 'all' || (filter === 'done' ? action.status === 'done' : action.status !== 'done')), [actions, filter])

  async function setStatus(action: MerchantAction, status: ActionStatus) {
    setSavingId(action.id)
    try {
      await updateMerchantActionStatus(action.id, status)
      setActions(current => current.map(item => item.id === action.id ? { ...item, status } : item))
      toastOk(status === 'done' ? 'تم إكمال الإجراء' : 'تم تحديث حالة الإجراء')
    } catch {
      toastErr('تعذر تحديث الإجراء. حاول مرة أخرى.')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) return <div className="actions-loading"><RefreshCw size={19} className="actions-spin" /> جارٍ تحميل خطة العمل…</div>

  return <main className="actions-page">
    <header className="actions-header"><div><h1>خطة العمل</h1><p>حوّل قرارات المتجر إلى إجراءات واضحة، وراقب ما بدأ وما اكتمل.</p></div></header>

    <section className="actions-kpis" aria-label="ملخص خطة العمل">
      <ActionKpi Icon={ListChecks} label="إجراءات مفتوحة" value={stats.open} />
      <ActionKpi Icon={CircleDot} label="قيد التنفيذ" value={stats.inProgress} tone="info" />
      <ActionKpi Icon={Clock3} label="متأخرة" value={stats.overdue} tone={stats.overdue ? 'danger' : 'normal'} />
      <ActionKpi Icon={CheckCircle2} label="مكتملة" value={stats.done} tone="success" />
    </section>

    <section className="actions-panel">
      <div className="actions-panel-head"><div><h2>الإجراءات</h2><p>تُضاف من مركز القرارات وتوصيات المخزون، ولا تتكرر المهمة المفتوحة نفسها.</p></div><div className="actions-filters">
        {([['open', 'المفتوحة'], ['done', 'المكتملة'], ['all', 'الكل']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
      </div></div>

      {visible.length ? <div className="actions-list">{visible.map(action => {
        const overdue = action.status !== 'done' && action.due_date && action.due_date < new Date().toISOString().slice(0, 10)
        return <article className="actions-row" key={action.id}>
          <div className="actions-main"><div className="actions-meta"><span className={`actions-priority actions-priority--${action.priority || 'medium'}`}>{PRIORITY_LABEL[action.priority || 'medium']}</span><span>{STATUS_LABEL[action.status]}</span>{overdue ? <span className="actions-overdue">متأخرة</span> : null}</div><h3>{action.title}</h3>{action.note ? <p>{action.note}</p> : null}</div>
          <div className="actions-impact"><small>الأثر المتوقع</small><strong>{action.expected_impact || 'تحسين التشغيل'}</strong>{action.due_date ? <span>الموعد: {new Date(`${action.due_date}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}</span> : null}</div>
          <div className="actions-controls">{action.status === 'pending' ? <button disabled={savingId === action.id} onClick={() => void setStatus(action, 'in_progress')}>بدء التنفيذ</button> : null}{action.status !== 'done' ? <button className="primary" disabled={savingId === action.id} onClick={() => void setStatus(action, 'done')}>إكمال</button> : <button onClick={() => void setStatus(action, 'pending')}>إعادة فتح</button>}</div>
        </article>
      })}</div> : <div className="actions-empty"><CheckCircle2 size={26} /><strong>{filter === 'open' ? 'لا توجد إجراءات مفتوحة' : 'لا توجد إجراءات في هذا التصنيف'}</strong><span>يمكن إضافة أي قرار من مركز القرارات أو توصيات المخزون.</span></div>}
    </section>
  </main>
}

function ActionKpi({ Icon, label, value, tone = 'normal' }: { Icon: typeof ListChecks; label: string; value: number; tone?: string }) {
  return <div className={`actions-kpi actions-kpi--${tone}`}><span><Icon size={17} /></span><div><small>{label}</small><strong>{value.toLocaleString('ar-SA-u-nu-latn')}</strong></div></div>
}
