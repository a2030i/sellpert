import { fetchAllStrict } from '../../lib/db'
import { userErrorMessage } from '../../lib/userError'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import {
  ArrowDown, ArrowUp, Check, ChevronLeft, ClipboardList, Copy, ExternalLink,
  FileText, GripVertical, Link2, ListFilter, Paperclip, Plus,
  Save, Search, Settings2, Trash2, X,
} from 'lucide-react'
import type { ServiceQuestion, ServiceQuestionType } from '../PricingRequest'
import './ServiceRequestsView.css'

type Stage = { id: string; form_id: string; name: string; color: string; position: number; is_terminal: boolean }
type RequestRow = { id: string; form_id: string; reference_code: string; answers: Record<string, unknown>; contact_name: string; contact_email?: string | null; contact_phone?: string | null; current_stage_id: string; submitted_at: string; updated_at: string }
type Activity = { id: string; request_id: string; stage_id?: string | null; activity_type: string; content: string; link_url?: string | null; attachments: Array<{ path: string; name: string }>; created_at: string }
type FormRow = { id: string; name: string; slug: string; title: string; description: string; is_published: boolean; version: number }

const TYPES: Array<{ value: ServiceQuestionType; label: string }> = [
  { value: 'short_text', label: 'إجابة قصيرة' }, { value: 'long_text', label: 'إجابة طويلة' },
  { value: 'single_choice', label: 'اختيار متعدد' }, { value: 'multiple_choice', label: 'مربعات اختيار' },
  { value: 'dropdown', label: 'قائمة منسدلة' }, { value: 'url', label: 'رابط' }, { value: 'file', label: 'رفع ملف' },
]
const COLORS = ['#2f80ed','#d99a17','#8767c7','#178f88','#db7b32','#2d9b5f','#64748b','#be3d3d']

export default function ServiceRequestsView({ currentUserId }: { currentUserId?: string }) {
  const [mode, setMode] = useState<'pipeline' | 'builder'>('pipeline')
  const [builderTab, setBuilderTab] = useState<'questions' | 'stages'>('questions')
  const [form, setForm] = useState<FormRow | null>(null)
  const [questions, setQuestions] = useState<ServiceQuestion[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [initialQuestionIds, setInitialQuestionIds] = useState<string[]>([])
  const [initialStageIds, setInitialStageIds] = useState<string[]>([])
  const [stageFilter, setStageFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [activityFile, setActivityFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [notice, setNotice] = useState('')

  const selected = requests.find(item => item.id === selectedId) || null
  const selectedQuestion = questions.find(item => item.id === selectedQuestionId) || null

  async function load() {
    setLoading(true); setError(''); setUnavailable(false)
    try {
      const { data: formData, error: formError } = await supabase.from('service_request_forms').select('*').eq('slug', 'sellpert-service-request').maybeSingle()
      if (formError) { setUnavailable(['42P01','PGRST205'].includes(formError.code)); throw formError }
      if (!formData) { setUnavailable(true); throw new Error('نموذج طلبات الخدمة غير متاح حاليًا. يحتاج إكمال التهيئة من إدارة المنصة.') }
      const [questionResult, stageResult, requestResult] = await Promise.all([
        supabase.from('service_request_questions').select('*').eq('form_id', formData.id).order('position'),
        supabase.from('service_request_stages').select('*').eq('form_id', formData.id).order('position'),
        fetchAllStrict<RequestRow>((f,t) => supabase.from('service_request_submissions').select('*').eq('form_id', formData.id).order('submitted_at', { ascending: false }).order('id').range(f,t)).then(data => ({data,error:null})),
      ])
      if (questionResult.error) throw questionResult.error
      if (stageResult.error) throw stageResult.error
      if (requestResult.error) throw requestResult.error
      setForm(formData as FormRow)
      setQuestions((questionResult.data || []) as ServiceQuestion[]); setInitialQuestionIds((questionResult.data || []).map(item => item.id))
      setStages((stageResult.data || []) as Stage[]); setInitialStageIds((stageResult.data || []).map(item => item.id))
      setRequests((requestResult.data || []) as RequestRow[])
    } catch (err) { setError(userErrorMessage(err, 'تعذر تحميل طلبات الخدمة. تحقق من الاتصال والصلاحية ثم أعد المحاولة.')) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!selectedId) { setActivities([]); return }
    supabase.from('service_request_activities').select('*').eq('request_id', selectedId).order('created_at', { ascending: false })
      .then(({ data, error }) => error ? setError(error.message) : setActivities((data || []) as Activity[]))
  }, [selectedId])

  const filteredRequests = useMemo(() => requests.filter(item => {
    const matchesStage = stageFilter === 'all' || item.current_stage_id === stageFilter
    const needle = search.trim().toLowerCase()
    const matchesSearch = !needle || `${item.contact_name} ${item.contact_phone || ''} ${item.contact_email || ''} ${item.reference_code}`.toLowerCase().includes(needle)
    return matchesStage && matchesSearch
  }), [requests, search, stageFilter])
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const request of requests) counts[request.current_stage_id] = (counts[request.current_stage_id] || 0) + 1
    return counts
  }, [requests])
  const stageById = useMemo(() => new Map(stages.map(stage => [stage.id, stage])), [stages])
  const desiredQuestionKey = useMemo(
    () => questions.find(question => question.key === 'desired_channels')?.key,
    [questions],
  )

  async function changeStage(request: RequestRow, stageId: string) {
    const previous = stages.find(stage => stage.id === request.current_stage_id)
    const next = stages.find(stage => stage.id === stageId)
    if (!next || next.id === previous?.id) return
    const { error: updateError } = await supabase.from('service_request_submissions').update({ current_stage_id: stageId }).eq('id', request.id)
    if (updateError) { setError(updateError.message); return }
    await supabase.from('service_request_activities').insert({ request_id: request.id, stage_id: stageId, activity_type: 'stage_changed', content: `تم نقل الطلب من «${previous?.name || '—'}» إلى «${next.name}»`, actor_id: currentUserId })
    setRequests(current => current.map(item => item.id === request.id ? { ...item, current_stage_id: stageId, updated_at: new Date().toISOString() } : item))
    if (selectedId === request.id) {
      const { data } = await supabase.from('service_request_activities').select('*').eq('request_id', request.id).order('created_at', { ascending: false })
      setActivities((data || []) as Activity[])
    }
  }

  async function addActivity() {
    if (!selected || (!note.trim() && !link.trim() && !activityFile)) return
    setSaving(true); setError('')
    try {
      const attachments: Array<{ path: string; name: string }> = []
      if (activityFile) {
        if (activityFile.size > 5 * 1024 * 1024) throw new Error('حجم المرفق يتجاوز 5 ميجابايت')
        const extension = activityFile.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'file'
        const path = `${selected.id}/activity/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage.from('service-request-documents').upload(path, activityFile, { contentType: activityFile.type, upsert: false })
        if (uploadError) throw uploadError
        attachments.push({ path, name: activityFile.name })
      }
      const type = attachments.length ? 'attachment' : link.trim() ? 'link' : 'note'
      const { error: insertError } = await supabase.from('service_request_activities').insert({ request_id: selected.id, stage_id: selected.current_stage_id, activity_type: type, content: note.trim(), link_url: link.trim() || null, attachments, actor_id: currentUserId })
      if (insertError) throw insertError
      setNote(''); setLink(''); setActivityFile(null)
      const { data } = await supabase.from('service_request_activities').select('*').eq('request_id', selected.id).order('created_at', { ascending: false })
      setActivities((data || []) as Activity[])
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر إضافة السجل') }
    finally { setSaving(false) }
  }

  function updateQuestion(id: string, patch: Partial<ServiceQuestion>) { setQuestions(current => current.map(item => item.id === id ? { ...item, ...patch } : item)) }
  function moveQuestion(id: string, direction: -1 | 1) { setQuestions(current => moveItem(current, id, direction).map((item, position) => ({ ...item, position }))) }
  function addQuestion() {
    const id = crypto.randomUUID()
    setQuestions(current => [...current, { id, key: `field_${Date.now()}`, label: 'سؤال جديد', type: 'short_text', help_text: '', placeholder: '', required: false, position: current.length, options: [], config: { section: 'business' } }])
    setSelectedQuestionId(id)
  }
  function duplicateQuestion(question: ServiceQuestion) {
    const id = crypto.randomUUID()
    setQuestions(current => [...current, { ...question, id, key: `field_${Date.now()}`, label: `${question.label} - نسخة`, position: current.length }])
    setSelectedQuestionId(id)
  }

  async function saveBuilder() {
    if (!form) return
    if (questions.some(question => question.label.trim().length < 2)) { setError('كل سؤال يحتاج عنواناً واضحاً'); return }
    if (new Set(questions.map(question => question.key)).size !== questions.length) { setError('مفاتيح الأسئلة يجب أن تكون فريدة'); return }
    if (!stages.length) { setError('أضف مرحلة متابعة واحدة على الأقل'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const deletedQuestionIds = initialQuestionIds.filter(id => !questions.some(question => question.id === id))
      if (deletedQuestionIds.length) { const { error } = await supabase.from('service_request_questions').delete().in('id', deletedQuestionIds); if (error) throw error }
      const { error: questionError } = await supabase.from('service_request_questions').upsert(questions.map((question, position) => ({ ...question, form_id: form.id, position })), { onConflict: 'id' })
      if (questionError) throw questionError

      const deletedStageIds = initialStageIds.filter(id => !stages.some(stage => stage.id === id))
      for (const id of deletedStageIds) {
        const replacement = stages[0]
        if (!replacement) throw new Error('لا يمكن حذف كل المراحل')
        const { error: moveError } = await supabase.from('service_request_submissions').update({ current_stage_id: replacement.id }).eq('current_stage_id', id)
        if (moveError) throw moveError
        const { error: deleteError } = await supabase.from('service_request_stages').delete().eq('id', id)
        if (deleteError) throw deleteError
      }
      const { error: stageError } = await supabase.from('service_request_stages').upsert(stages.map((stage, position) => ({ ...stage, form_id: form.id, position })), { onConflict: 'id' })
      if (stageError) throw stageError
      const { error: formError } = await supabase.from('service_request_forms').update({ title: form.title, description: form.description, is_published: true, version: form.version + 1 }).eq('id', form.id)
      if (formError) { setUnavailable(['42P01','PGRST205'].includes(formError.code)); throw formError }
      setForm({ ...form, is_published: true, version: form.version + 1 })
      setInitialQuestionIds(questions.map(item => item.id)); setInitialStageIds(stages.map(item => item.id)); setNotice('تم حفظ النموذج ونشره بنجاح')
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر حفظ النموذج') }
    finally { setSaving(false) }
  }

  function addStage() { const id = crypto.randomUUID(); setStages(current => [...current, { id, form_id: form?.id || '', name: 'مرحلة جديدة', color: COLORS[current.length % COLORS.length], position: current.length, is_terminal: false }]) }
  function updateStage(id: string, patch: Partial<Stage>) { setStages(current => current.map(stage => stage.id === id ? { ...stage, ...patch } : stage)) }
  function moveStage(id: string, direction: -1 | 1) { setStages(current => moveItem(current, id, direction).map((stage, position) => ({ ...stage, position }))) }

  if (loading) return <div className="sr-loading"><span /> جاري تحميل نظام الطلبات...</div>
  if (!form) return <div className="sr-empty"><ClipboardList /><h2>{unavailable ? 'طلبات الخدمة غير متاحة حاليًا' : 'تعذر تحميل طلبات الخدمة'}</h2><p>{error}</p><button onClick={() => void load()}>إعادة المحاولة</button></div>

  return <div className="sr-page" dir="rtl">
    <header className="sr-topbar"><div>{mode === 'builder' && <h2>إعداد نموذج طلب الخدمة</h2>}<p>{mode === 'pipeline' ? 'تابع طلبات التجار من التسجيل حتى توقيع العقد.' : 'عدّل الأسئلة ومراحل المتابعة ثم انشر التغييرات.'}</p></div><div>{mode === 'pipeline' ? <button className="sr-button sr-button--primary" onClick={() => setMode('builder')}><Settings2 /> إعداد النموذج</button> : <><a className="sr-button" href="/pricing-request" target="_blank" rel="noreferrer"><ExternalLink /> معاينة</a><button className="sr-button sr-button--primary" onClick={() => void saveBuilder()} disabled={saving}><Save /> {saving ? 'جارٍ الحفظ...' : 'حفظ ونشر'}</button></>}</div></header>
    {error && <div className="sr-alert">{error}<button onClick={() => setError('')}><X /></button></div>}{notice && <div className="sr-notice"><Check />{notice}</div>}
    {mode === 'pipeline' ? <>
      <section className="sr-stage-rail"><button className={stageFilter === 'all' ? 'is-active' : ''} onClick={() => setStageFilter('all')}><span>إجمالي الطلبات</span><strong>{requests.length}</strong></button>{stages.map(stage => <button key={stage.id} className={stageFilter === stage.id ? 'is-active' : ''} style={{ '--stage': stage.color } as CSSProperties} onClick={() => setStageFilter(stage.id)}><span>{stage.name}</span><strong>{stageCounts[stage.id] || 0}</strong></button>)}</section>
      <section className="sr-workspace"><div className="sr-list"><div className="sr-filters"><label><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الجوال أو رقم الطلب" /></label><span><ListFilter /> {filteredRequests.length} طلب</span></div><div className="sr-table"><div className="sr-table__head"><span>التاجر / الشخص</span><span>الجوال</span><span>القنوات المطلوبة</span><span>المرحلة الحالية</span><span>آخر نشاط</span><span /></div>{filteredRequests.length ? filteredRequests.map(request => <RequestItem key={request.id} request={request} stage={stageById.get(request.current_stage_id)} desiredKey={desiredQuestionKey} onOpen={() => setSelectedId(request.id)} />) : <div className="sr-table__empty">لا توجد طلبات مطابقة.</div>}</div></div>{selected && <RequestDrawer request={selected} questions={questions} stages={stages} activities={activities} note={note} link={link} file={activityFile} saving={saving} onClose={() => setSelectedId(null)} onStage={stageId => void changeStage(selected, stageId)} onNote={setNote} onLink={setLink} onFile={setActivityFile} onAdd={() => void addActivity()} onOpenFile={path => void openPrivateFile(path)} />}</section>
    </> : <Builder form={form} setForm={setForm} tab={builderTab} setTab={setBuilderTab} questions={questions} selectedQuestion={selectedQuestion} stages={stages} requestCounts={stageCounts} onSelectQuestion={setSelectedQuestionId} onUpdateQuestion={updateQuestion} onMoveQuestion={moveQuestion} onAddQuestion={addQuestion} onDuplicateQuestion={duplicateQuestion} onDeleteQuestion={id => { setQuestions(current => current.filter(item => item.id !== id).map((item, position) => ({ ...item, position }))); if (selectedQuestionId === id) setSelectedQuestionId(null) }} onAddStage={addStage} onUpdateStage={updateStage} onMoveStage={moveStage} onDeleteStage={id => setStages(current => current.filter(stage => stage.id !== id).map((stage, position) => ({ ...stage, position })))} onBack={() => setMode('pipeline')} />}
  </div>
}

function RequestItem({ request, stage, desiredKey, onOpen }: { request: RequestRow; stage?: Stage; desiredKey?: string; onOpen: () => void }) {
  const channels = desiredKey && Array.isArray(request.answers[desiredKey]) ? (request.answers[desiredKey] as string[]).join('، ') : '—'
  return <button className="sr-row" onClick={onOpen}><span><strong>{request.contact_name}</strong><small>{request.reference_code}</small></span><span dir="ltr">{request.contact_phone || '—'}</span><span>{channels}</span><span><i style={{ background: stage?.color }} />{stage?.name || '—'}</span><span>{formatRelative(request.updated_at)}</span><ChevronLeft /></button>
}

function RequestDrawer({ request, questions, stages, activities, note, link, file, saving, onClose, onStage, onNote, onLink, onFile, onAdd, onOpenFile }: { request: RequestRow; questions: ServiceQuestion[]; stages: Stage[]; activities: Activity[]; note: string; link: string; file: File | null; saving: boolean; onClose: () => void; onStage: (id: string) => void; onNote: (v: string) => void; onLink: (v: string) => void; onFile: (v: File | null) => void; onAdd: () => void; onOpenFile: (path: string) => void }) {
  return <aside className="sr-drawer"><header><div><h2>تفاصيل الطلب</h2><span dir="ltr">{request.reference_code}</span></div><button onClick={onClose}><X /></button></header><section><h3>بيانات الطلب</h3><dl>{questions.map(question => request.answers[question.key] != null && <div key={question.id}><dt>{question.label}</dt><dd>{displayAnswer(request.answers[question.key], onOpenFile)}</dd></div>)}</dl></section><section><h3>المرحلة الحالية</h3><select value={request.current_stage_id} onChange={event => onStage(event.target.value)}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></section><section className="sr-timeline"><h3>سجل النشاط</h3>{activities.map(activity => <article key={activity.id}><i /><div><strong>{activity.content || activityLabel(activity.activity_type)}</strong>{activity.link_url && <a href={activity.link_url} target="_blank" rel="noreferrer"><Link2 /> {activity.link_url}</a>}{activity.attachments?.map(attachment => <button key={attachment.path} onClick={() => onOpenFile(attachment.path)}><Paperclip /> {attachment.name}</button>)}<small>{new Date(activity.created_at).toLocaleString('ar-SA-u-ca-gregory-nu-latn')}</small></div></article>)}</section><section className="sr-composer"><h3>أضف إلى السجل</h3><textarea value={note} onChange={event => onNote(event.target.value)} placeholder="اكتب ملاحظة عن هذه المرحلة..." /><label><Link2 /><input value={link} onChange={event => onLink(event.target.value)} placeholder="رابط الاجتماع أو العقد (اختياري)" dir="ltr" /></label><div>{file ? <span><FileText />{file.name}<button onClick={() => onFile(null)}><X /></button></span> : <label className="sr-file-pick"><Paperclip /> إرفاق ملف<input type="file" onChange={event => onFile(event.target.files?.[0] || null)} /></label>}<button className="sr-button sr-button--primary" onClick={onAdd} disabled={saving}>إضافة للسجل</button></div></section></aside>
}

function Builder(props: { form: FormRow; setForm: (v: FormRow) => void; tab: 'questions'|'stages'; setTab: (v:'questions'|'stages') => void; questions: ServiceQuestion[]; selectedQuestion: ServiceQuestion | null; stages: Stage[]; requestCounts: Record<string,number>; onSelectQuestion:(id:string)=>void; onUpdateQuestion:(id:string,p:Partial<ServiceQuestion>)=>void; onMoveQuestion:(id:string,d:-1|1)=>void; onAddQuestion:()=>void; onDuplicateQuestion:(q:ServiceQuestion)=>void; onDeleteQuestion:(id:string)=>void; onAddStage:()=>void; onUpdateStage:(id:string,p:Partial<Stage>)=>void; onMoveStage:(id:string,d:-1|1)=>void; onDeleteStage:(id:string)=>void; onBack:()=>void }) {
  const { form, setForm, tab, setTab, questions, selectedQuestion, stages } = props
  return <div className="sr-builder"><nav><button className={tab === 'questions' ? 'is-active' : ''} onClick={() => setTab('questions')}>أسئلة النموذج</button><button className={tab === 'stages' ? 'is-active' : ''} onClick={() => setTab('stages')}>مراحل المتابعة</button><button onClick={props.onBack}>العودة للطلبات</button></nav><div className="sr-builder__grid"><section className="sr-builder__canvas"><div className="sr-form-meta"><label>عنوان النموذج<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label><label>الوصف<textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label></div>{tab === 'questions' ? <><p className="sr-builder__hint">أضف الأسئلة وعدّل ترتيبها وطريقة الإجابة.</p>{questions.map((question, index) => <div className={`sr-question-row ${selectedQuestion?.id === question.id ? 'is-selected' : ''}`} key={question.id} onClick={() => props.onSelectQuestion(question.id)}><GripVertical /><b>{index + 1}</b><input value={question.label} onChange={event => props.onUpdateQuestion(question.id,{label:event.target.value})} /><select value={question.type} onChange={event => props.onUpdateQuestion(question.id,{type:event.target.value as ServiceQuestionType})}>{TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select><label className="sr-switch"><input type="checkbox" checked={question.required} onChange={event => props.onUpdateQuestion(question.id,{required:event.target.checked})} /><span /> مطلوب</label><div><button onClick={event => { event.stopPropagation(); props.onMoveQuestion(question.id,-1) }} disabled={index === 0}><ArrowUp /></button><button onClick={event => { event.stopPropagation(); props.onMoveQuestion(question.id,1) }} disabled={index === questions.length - 1}><ArrowDown /></button><button onClick={event => { event.stopPropagation(); props.onDuplicateQuestion(question) }}><Copy /></button><button className="is-danger" onClick={event => { event.stopPropagation(); props.onDeleteQuestion(question.id) }}><Trash2 /></button></div></div>)}<button className="sr-add-row" onClick={props.onAddQuestion}><Plus /> إضافة سؤال</button></> : <><p className="sr-builder__hint">يمكنك إضافة مرحلة أو تعديلها أو إعادة ترتيبها. عند حذف مرحلة، تُنقل طلباتها إلى أول مرحلة متبقية.</p>{stages.map((stage,index) => <div className="sr-stage-row" key={stage.id}><GripVertical /><b>{index+1}</b><input type="color" value={stage.color} onChange={event => props.onUpdateStage(stage.id,{color:event.target.value})} /><input value={stage.name} onChange={event => props.onUpdateStage(stage.id,{name:event.target.value})} /><span>{props.requestCounts[stage.id] || 0} طلب</span><label><input type="checkbox" checked={stage.is_terminal} onChange={event => props.onUpdateStage(stage.id,{is_terminal:event.target.checked})} /> مرحلة نهائية</label><div><button onClick={() => props.onMoveStage(stage.id,-1)} disabled={index===0}><ArrowUp /></button><button onClick={() => props.onMoveStage(stage.id,1)} disabled={index===stages.length-1}><ArrowDown /></button><button className="is-danger" onClick={() => props.onDeleteStage(stage.id)} disabled={stages.length===1}><Trash2 /></button></div></div>)}<button className="sr-add-row" onClick={props.onAddStage}><Plus /> إضافة مرحلة</button></>}</section>{tab === 'questions' && <aside className="sr-inspector">{selectedQuestion ? <><h2>خصائص السؤال</h2><label>عنوان السؤال<input value={selectedQuestion.label} onChange={event => props.onUpdateQuestion(selectedQuestion.id,{label:event.target.value})} /></label><label>نص مساعد<textarea value={selectedQuestion.help_text} onChange={event => props.onUpdateQuestion(selectedQuestion.id,{help_text:event.target.value})} /></label><label>القسم<select value={selectedQuestion.config?.section || 'business'} onChange={event => props.onUpdateQuestion(selectedQuestion.id,{config:{...selectedQuestion.config,section:event.target.value}})}><option value="contact">بيانات التواصل</option><option value="business">النشاط التجاري</option><option value="channels">قنوات البيع</option><option value="documents">المستندات</option></select></label>{['single_choice','multiple_choice','dropdown'].includes(selectedQuestion.type) && <label>الخيارات<textarea value={selectedQuestion.options.join('\n')} onChange={event => props.onUpdateQuestion(selectedQuestion.id,{options:event.target.value.split('\n').map(v=>v.trim()).filter(Boolean)})} placeholder="خيار في كل سطر" /></label>}<label>النص داخل الحقل<input value={selectedQuestion.placeholder} onChange={event => props.onUpdateQuestion(selectedQuestion.id,{placeholder:event.target.value})} /></label></> : <div className="sr-inspector__empty">اختر سؤالاً لتعديل خصائصه.</div>}<div className="sr-public-link"><strong>رابط النموذج العام</strong><span dir="ltr">request.sellpert.com</span><button onClick={() => navigator.clipboard.writeText('https://request.sellpert.com')}><Copy /> نسخ الرابط</button></div></aside>}</div></div>
}

function moveItem<T extends { id: string }>(items: T[], id: string, direction: -1|1) { const index=items.findIndex(item=>item.id===id); const next=index+direction; if(index<0||next<0||next>=items.length)return items; const copy=[...items]; [copy[index],copy[next]]=[copy[next],copy[index]]; return copy }
function displayAnswer(value: unknown, openFile: (path:string)=>void) { if(Array.isArray(value)) return value.join('، '); if(value && typeof value==='object' && 'path' in value) { const file=value as {path:string;name?:string}; return <button className="sr-answer-file" onClick={()=>openFile(file.path)}><FileText />{file.name||'فتح الملف'}</button> } return String(value) }
async function openPrivateFile(path: string) { const { data, error }=await supabase.storage.from('service-request-documents').createSignedUrl(path,300); if(error) throw error; window.open(data.signedUrl,'_blank','noopener,noreferrer') }
function activityLabel(type:string){return ({created:'تم تسجيل الطلب',stage_changed:'تم تغيير المرحلة',note:'ملاحظة',link:'تمت إضافة رابط',attachment:'تمت إضافة مرفق'} as Record<string,string>)[type]||'تحديث'}
function formatRelative(date:string){const diff=Date.now()-new Date(date).getTime();const hours=Math.floor(diff/3600000);if(hours<1)return 'منذ قليل';if(hours<24)return `منذ ${hours} س`;return new Date(date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}
