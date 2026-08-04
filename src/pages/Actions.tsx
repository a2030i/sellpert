import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpLeft, BarChart3, CheckCircle2, CircleDot, Clock3, ListChecks, RefreshCw, Target, Timer } from 'lucide-react'
import { supabase, type Merchant } from '../lib/supabase'
import {
  actionDestination,
  completeMerchantAction,
  getMyActionEffectiveness,
  updateMerchantActionStatus,
  type ActionCompletionResult,
  type ActionEffectiveness,
} from '../lib/merchantActions'
import { toastErr, toastOk } from '../components/Toast'
import './Actions.css'

type ActionStatus = 'pending' | 'in_progress' | 'done'
type MerchantAction = {
  id: string; title: string; note: string | null; expected_impact: string | null
  category: string | null; priority: string | null; status: ActionStatus
  due_date: string | null; source_key: string | null; created_at: string
  details: unknown
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
const CATEGORY_LABEL: Record<string, string> = {
  operations: 'التشغيل', profitability: 'الربحية', inventory: 'المخزون',
  marketing: 'الإعلانات', finance: 'المال', data_quality: 'جودة البيانات',
}
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export default function Actions({ merchant }: { merchant: Merchant | null }) {
  const [actions, setActions] = useState<MerchantAction[]>([])
  const [effectiveness, setEffectiveness] = useState<ActionEffectiveness | null>(null)
  const [effectivenessUnavailable, setEffectivenessUnavailable] = useState(false)
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
    const [actionsResult, effectivenessResult] = await Promise.allSettled([
      supabase.from('merchant_requests')
        .select('id,title,note,expected_impact,category,priority,status,due_date,source_key,created_at,details,completion_result,completion_note,completion_recorded_at')
        .eq('merchant_code', merchant.merchant_code).eq('request_kind', 'action')
        .order('created_at', { ascending: false }),
      getMyActionEffectiveness(90),
    ])
    if (actionsResult.status === 'rejected' || actionsResult.value.error) {
      toastErr('تعذر تحميل خطة العمل')
      setActions([])
    } else {
      setActions((actionsResult.value.data || []) as MerchantAction[])
    }
    if (effectivenessResult.status === 'fulfilled') {
      setEffectiveness(effectivenessResult.value)
      setEffectivenessUnavailable(false)
    } else {
      setEffectiveness(null)
      setEffectivenessUnavailable(true)
    }
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

  const visible = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return actions
      .filter(action => filter === 'all' || (filter === 'done' ? action.status === 'done' : action.status !== 'done'))
      .sort((a, b) => {
        if (a.status === 'done' || b.status === 'done') return a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === 'done' ? 1 : -1
        const aOverdue = Boolean(a.due_date && a.due_date < today)
        const bOverdue = Boolean(b.due_date && b.due_date < today)
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
        const priority = (PRIORITY_RANK[a.priority || 'medium'] ?? 2) - (PRIORITY_RANK[b.priority || 'medium'] ?? 2)
        if (priority) return priority
        return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31')
      })
  }, [actions, filter])

  function goToExecution(action: MerchantAction) {
    const destination = actionDestination(action.details)
    if (!destination) return
    window.history.pushState(null, '', destination)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

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

    {effectiveness ? <EffectivenessPanel data={effectiveness} /> : effectivenessUnavailable ? <section className="actions-effectiveness-unavailable"><BarChart3 size={18} /><div><strong>تحليل فعالية التنفيذ غير متاح الآن</strong><span>خطة العمل ما زالت تعمل ويمكنك تحديث التحليل لاحقًا.</span></div><button onClick={() => void load()}>إعادة المحاولة</button></section> : null}

    <section className="actions-panel">
      <div className="actions-panel-head"><div><h2>الإجراءات</h2><p>تُضاف من مركز القرارات وتوصيات المخزون، ولا تتكرر المهمة المفتوحة نفسها.</p></div><div className="actions-filters">
        {([['open', 'المفتوحة'], ['done', 'المكتملة'], ['all', 'الكل']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
      </div></div>

      {visible.length ? <div className="actions-list">{visible.map(action => {
        const overdue = action.status !== 'done' && action.due_date && action.due_date < new Date().toISOString().slice(0, 10)
        return <article className="actions-row" key={action.id}>
          <div className="actions-main"><div className="actions-meta"><span className={`actions-priority actions-priority--${action.priority || 'medium'}`}>{PRIORITY_LABEL[action.priority || 'medium']}</span><span>{STATUS_LABEL[action.status]}</span>{overdue ? <span className="actions-overdue">متأخرة</span> : null}{action.status === 'done' && action.completion_result ? <span className={`actions-result actions-result--${action.completion_result}`}>{RESULT_LABEL[action.completion_result]}</span> : null}</div><h3>{action.title}</h3>{action.note ? <p>{action.note}</p> : null}</div>
          <div className="actions-impact"><small>الأثر المتوقع</small><strong>{action.expected_impact || 'تحسين التشغيل'}</strong>{action.due_date ? <span>الموعد: {new Date(`${action.due_date}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}</span> : null}</div>
          <div className="actions-controls">{actionDestination(action.details) ? <button className="execution" onClick={() => goToExecution(action)}>فتح صفحة التنفيذ <ArrowUpLeft size={14} /></button> : null}{action.status === 'pending' ? <button disabled={savingId === action.id} onClick={() => void setStatus(action, 'in_progress')}>بدء التنفيذ</button> : null}{action.status !== 'done' ? <button className="primary" disabled={savingId === action.id} onClick={() => void setStatus(action, 'done')}>إكمال</button> : <button onClick={() => void setStatus(action, 'pending')}>إعادة فتح</button>}</div>
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

function EffectivenessPanel({ data }: { data: ActionEffectiveness }) {
  const maxCompleted = Math.max(1, ...data.weeks.map(week => week.completed))
  const measured = data.completed.measured
  const formatRate = (value: number | null) => value == null ? '—' : `${value.toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 1 })}%`
  const formatDays = (value: number | null) => value == null ? '—' : `${value.toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 1 })} يوم`

  return <section className="actions-effectiveness" aria-labelledby="action-effectiveness-title">
    <div className="actions-effectiveness-head"><div><span className="actions-section-icon"><BarChart3 size={18} /></span><div><h2 id="action-effectiveness-title">فعالية التنفيذ</h2><p>نتائج الإجراءات المكتملة خلال آخر {data.period_days.toLocaleString('ar-SA-u-nu-latn')} يومًا، وليست تقديرات مبيعات.</p></div></div><small>{measured.toLocaleString('ar-SA-u-nu-latn')} نتيجة موثقة</small></div>

    <div className="actions-effectiveness-kpis">
      <EffectivenessKpi Icon={Target} label="تحقق الأثر بالكامل" value={formatRate(data.completed.achieved_rate_pct)} note={`${data.completed.achieved.toLocaleString('ar-SA-u-nu-latn')} من ${measured.toLocaleString('ar-SA-u-nu-latn')} نتيجة`} />
      <EffectivenessKpi Icon={CheckCircle2} label="نتيجة إيجابية كليًا أو جزئيًا" value={formatRate(data.completed.positive_rate_pct)} note={`${(data.completed.achieved + data.completed.partial).toLocaleString('ar-SA-u-nu-latn')} إجراء`} />
      <EffectivenessKpi Icon={Timer} label="متوسط دورة التنفيذ" value={formatDays(data.completed.average_cycle_days)} note="من الإنشاء حتى توثيق النتيجة" />
      <EffectivenessKpi Icon={Clock3} label="متأخرة الآن" value={data.open.overdue.toLocaleString('ar-SA-u-nu-latn')} note={`${data.open.due_next_7_days.toLocaleString('ar-SA-u-nu-latn')} مستحقة خلال 7 أيام`} danger={data.open.overdue > 0} />
    </div>

    <div className="actions-effectiveness-body">
      <div className="actions-weekly"><div className="actions-subhead"><strong>الإكمال الأسبوعي</strong><span>8 أسابيع</span></div><div className="actions-week-bars" role="img" aria-label="عدد الإجراءات المكتملة ونتائجها خلال آخر ثمانية أسابيع">
        {data.weeks.map(week => {
          const height = week.completed ? Math.max(12, week.completed / maxCompleted * 100) : 3
          const date = new Date(`${week.week_start}T00:00:00`)
          return <div className="actions-week" key={week.week_start} title={`${week.completed} مكتملة · ${week.achieved} تحقق أثرها`}><div className="actions-week-track"><div className="actions-week-column" style={{ height: `${height}%` }}>{week.completed ? <><i className="achieved" style={{ flex: week.achieved }} /><i className="partial" style={{ flex: week.partial }} /><i className="missed" style={{ flex: week.not_achieved }} /><i className="unknown" style={{ flex: Math.max(0, week.completed - week.achieved - week.partial - week.not_achieved) }} /></> : null}</div></div><span>{date.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' })}</span></div>
        })}
      </div><div className="actions-week-legend"><span><i className="achieved" /> تحقق</span><span><i className="partial" /> جزئي</span><span><i className="missed" /> لم يتحقق</span></div></div>

      <div className="actions-category"><div className="actions-subhead"><strong>النتائج حسب القسم</strong><span>الأكثر تنفيذًا</span></div>{data.categories.length ? <div className="actions-category-list">{data.categories.map(row => <div key={row.category}><span><strong>{CATEGORY_LABEL[row.category] || row.category}</strong><small>{row.completed.toLocaleString('ar-SA-u-nu-latn')} مكتملة</small></span><b>{formatRate(row.achieved_rate_pct)}</b></div>)}</div> : <p className="actions-category-empty">أكمل أول إجراء ووثّق نتيجته لبدء المقارنة بين الأقسام.</p>}</div>
    </div>
  </section>
}

function EffectivenessKpi({ Icon, label, value, note, danger = false }: { Icon: typeof Target; label: string; value: string; note: string; danger?: boolean }) {
  return <div className={`actions-effectiveness-kpi${danger ? ' danger' : ''}`}><span><Icon size={16} /></span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></div>
}
