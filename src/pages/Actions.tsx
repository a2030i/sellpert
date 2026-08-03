import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleDot, Clock3, ListChecks, RefreshCw } from 'lucide-react'
import { supabase, type Merchant } from '../lib/supabase'
import { completeMerchantAction, updateMerchantActionStatus, type ActionCompletionResult } from '../lib/merchantActions'
import { toastErr, toastOk } from '../components/Toast'
import './Actions.css'

type ActionStatus = 'pending' | 'in_progress' | 'done'
type MerchantAction = {
  id: string; title: string; note: string | null; expected_impact: string | null
  category: string | null; priority: string | null; status: ActionStatus
  due_date: string | null; source_key: string | null; created_at: string
  completion_result: ActionCompletionResult | 'unknown' | null
  completion_note: string | null; completion_recorded_at: string | null
}

const STATUS_LABEL: Record<ActionStatus, string> = {
  pending: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'مكتملة',
}
const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'عاجلة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة',
}
const RESULT_LABEL: Record<ActionCompletionResult | 'unknown', string> = {
  achieved: 'تحقق الأثر', partial: 'تحقق جزئيًا', not_achieved: 'لم يتحقق', unknown: 'لم توثّق النتيجة',
}

export default function Actions({ merchant }: { merchant: Merchant | null }) {
  const [actions, setActions] = useState<MerchantAction[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [completionId, setCompletionId] = useState<string | null>(null)
  const [completionResult, setCompletionResult] = useState<ActionCompletionResult>('achieved')
  const [completionNote, setCompletionNote] = useState('')

  const load = useCallback(async () => {
    if (!merchant?.merchant_code) {
      setActions([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase.from('merchant_requests')
      .select('id,title,note,expected_impact,category,priority,status,due_date,source_key,created_at,completion_result,completion_note,completion_recorded_at')
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
      measured: actions.filter(action => action.status === 'done' && action.completion_result && action.completion_result !== 'unknown').length,
    }
  }, [actions])

  const visible = useMemo(() => actions.filter(action => filter === 'all' || (filter === 'done' ? action.status === 'done' : action.status !== 'done')), [actions, filter])

  async function setStatus(action: MerchantAction, status: ActionStatus) {
    if (status === 'done') {
      setCompletionId(action.id)
      setCompletionResult('achieved')
      setCompletionNote('')
      return
    }
    setSavingId(action.id)
    try {
      await updateMerchantActionStatus(action.id, status)
      setActions(current => current.map(item => item.id === action.id ? { ...item, status } : item))
      toastOk('تم تحديث حالة الإجراء')
    } catch {
      toastErr('تعذر تحديث الإجراء. حاول مرة أخرى.')
    } finally {
      setSavingId(null)
    }
  }

  async function complete(action: MerchantAction) {
    if (completionNote.trim().length < 5) {
      toastErr('اكتب نتيجة مختصرة لا تقل عن 5 أحرف')
      return
    }
    setSavingId(action.id)
    try {
      await completeMerchantAction(action.id, completionResult, completionNote)
      setActions(current => current.map(item => item.id === action.id ? {
        ...item, status: 'done', completion_result: completionResult,
        completion_note: completionNote.trim(), completion_recorded_at: new Date().toISOString(),
      } : item))
      setCompletionId(null)
      setCompletionNote('')
      toastOk('تم إكمال الإجراء وتوثيق النتيجة')
    } catch {
      toastErr('تعذر توثيق نتيجة الإجراء')
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

    {stats.done > 0 ? <section className="actions-measurement" aria-label="جودة توثيق النتائج"><div><strong>{stats.measured.toLocaleString('ar-SA-u-nu-latn')} من {stats.done.toLocaleString('ar-SA-u-nu-latn')}</strong><span>إجراء مكتمل بنتيجة موثقة</span></div><div className="actions-measurement-bar"><i style={{ width: `${stats.done ? stats.measured / stats.done * 100 : 0}%` }} /></div><p>لا يكفي إغلاق المهمة؛ سجّل هل تحقق الأثر المتوقع وما الذي حدث فعليًا.</p></section> : null}

    <section className="actions-panel">
      <div className="actions-panel-head"><div><h2>الإجراءات</h2><p>تُضاف من مركز القرارات وتوصيات المخزون، ولا تتكرر المهمة المفتوحة نفسها.</p></div><div className="actions-filters">
        {([['open', 'المفتوحة'], ['done', 'المكتملة'], ['all', 'الكل']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
      </div></div>

      {visible.length ? <div className="actions-list">{visible.map(action => {
        const overdue = action.status !== 'done' && action.due_date && action.due_date < new Date().toISOString().slice(0, 10)
        return <article className="actions-row" key={action.id}>
          <div className="actions-main"><div className="actions-meta"><span className={`actions-priority actions-priority--${action.priority || 'medium'}`}>{PRIORITY_LABEL[action.priority || 'medium']}</span><span>{STATUS_LABEL[action.status]}</span>{overdue ? <span className="actions-overdue">متأخرة</span> : null}{action.status === 'done' && action.completion_result ? <span className={`actions-result actions-result--${action.completion_result}`}>{RESULT_LABEL[action.completion_result]}</span> : null}</div><h3>{action.title}</h3>{action.note ? <p>{action.note}</p> : null}</div>
          <div className="actions-impact"><small>الأثر المتوقع</small><strong>{action.expected_impact || 'تحسين التشغيل'}</strong>{action.due_date ? <span>الموعد: {new Date(`${action.due_date}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}</span> : null}</div>
          <div className="actions-controls">{action.status === 'pending' ? <button disabled={savingId === action.id} onClick={() => void setStatus(action, 'in_progress')}>بدء التنفيذ</button> : null}{action.status !== 'done' ? <button className="primary" disabled={savingId === action.id} onClick={() => void setStatus(action, 'done')}>إكمال</button> : <button onClick={() => void setStatus(action, 'pending')}>إعادة فتح</button>}</div>
          {action.status === 'done' && action.completion_note ? <div className="actions-completed-note"><small>النتيجة المسجلة</small><p>{action.completion_note}</p></div> : null}
          {completionId === action.id ? <div className="actions-completion"><div><strong>وثّق نتيجة الإجراء</strong><span>اختر النتيجة الفعلية، ثم اكتب ما حدث باختصار.</span></div><div className="actions-result-options">{([['achieved','تحقق الأثر'],['partial','تحقق جزئيًا'],['not_achieved','لم يتحقق']] as const).map(([value,label]) => <button key={value} className={completionResult === value ? 'active' : ''} onClick={() => setCompletionResult(value)}>{label}</button>)}</div><textarea value={completionNote} onChange={event => setCompletionNote(event.target.value)} maxLength={1000} placeholder="مثال: تم تحديث الأسعار وانخفضت خسارة المنتج في الطلبات الجديدة." /><div className="actions-completion-controls"><button onClick={() => setCompletionId(null)}>إلغاء</button><button className="primary" disabled={savingId === action.id} onClick={() => void complete(action)}>{savingId === action.id ? 'جارٍ الحفظ' : 'حفظ النتيجة وإكمال'}</button></div></div> : null}
        </article>
      })}</div> : <div className="actions-empty"><CheckCircle2 size={26} /><strong>{filter === 'open' ? 'لا توجد إجراءات مفتوحة' : 'لا توجد إجراءات في هذا التصنيف'}</strong><span>يمكن إضافة أي قرار من مركز القرارات أو توصيات المخزون.</span></div>}
    </section>
  </main>
}

function ActionKpi({ Icon, label, value, tone = 'normal' }: { Icon: typeof ListChecks; label: string; value: number; tone?: string }) {
  return <div className={`actions-kpi actions-kpi--${tone}`}><span><Icon size={17} /></span><div><small>{label}</small><strong>{value.toLocaleString('ar-SA-u-nu-latn')}</strong></div></div>
}
