import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, Clock3, FileText, ShieldCheck, UploadCloud, X } from 'lucide-react'
import './PricingRequest.css'

export type ServiceQuestionType = 'short_text' | 'long_text' | 'single_choice' | 'multiple_choice' | 'dropdown' | 'url' | 'file'
export interface ServiceQuestion {
  id: string; key: string; label: string; type: ServiceQuestionType; help_text: string
  placeholder: string; required: boolean; position: number; options: string[]
  config: { section?: string; format?: string; min?: number; max_mb?: number }
}
interface PublicForm { id: string; name: string; slug: string; title: string; description: string; version: number }
type Answer = string | string[]

const SECTIONS = [
  { id: 'contact', label: 'بيانات التواصل', title: 'بيانات التواصل', description: 'لنبدأ بالبيانات الأساسية حتى نتمكن من إرسال العرض المناسب لك.' },
  { id: 'business', label: 'نشاطك التجاري', title: 'أخبرنا عن نشاطك', description: 'ساعدنا على فهم حجم نشاطك والقنوات التي تريد تنميتها.' },
  { id: 'channels', label: 'قنوات البيع', title: 'روابط قنوات البيع', description: 'أضف الروابط المتوفرة فقط، ويمكنك تجاوز أي رابط لا تملكه الآن.' },
  { id: 'documents', label: 'المستندات', title: 'المستندات والتأكيد', description: 'خطوة أخيرة للتحقق من بيانات النشاط وإكمال الطلب.' },
] as const

const FALLBACK_FORM: PublicForm = {
  id: 'preview', name: 'طلب خدمة Sellpert', slug: 'sellpert-service-request', title: 'طلب عرض سعر',
  description: 'أخبرنا عن نشاطك لنجهّز لك عرضاً يناسب قنوات البيع واحتياجك.', version: 1,
}
const FALLBACK_QUESTIONS: ServiceQuestion[] = [
  q('signer_name', 'اسم الشخص المخول بالتوقيع', 'short_text', true, 0, 'contact', [], 'أدخل الاسم الكامل', 'name'),
  q('business_email', 'البريد الإلكتروني للعمل', 'short_text', true, 1, 'contact', [], 'name@company.com', 'email'),
  q('phone', 'رقم الجوال', 'short_text', true, 2, 'contact', [], '5xxxxxxxx', 'saudi_phone'),
  q('store_url', 'رابط المتجر', 'url', false, 3, 'contact', [], 'https://'),
  q('product_count', 'عدد المنتجات التي ترغب في عرضها', 'short_text', true, 4, 'business', [], 'مثال: 120', 'number'),
  q('product_category', 'تصنيف المنتجات', 'dropdown', true, 5, 'business', ['العناية والجمال','الأزياء والملابس','الأجهزة والإلكترونيات','المنزل والمطبخ','الأغذية والمشروبات','أخرى']),
  q('existing_channels', 'القنوات التي لديك حساب قائم فيها', 'multiple_choice', false, 6, 'business', ['نون','أمازون','ترنديول']),
  q('desired_channels', 'القنوات التي ترغب في العمل عليها معنا', 'multiple_choice', true, 7, 'business', ['نون','أمازون','ترنديول']),
  q('noon_url', 'رابط متجرك على نون', 'url', false, 8, 'channels', [], 'https://'),
  q('amazon_url', 'رابط متجرك على أمازون', 'url', false, 9, 'channels', [], 'https://'),
  q('trendyol_url', 'رابط متجرك على ترنديول', 'url', false, 10, 'channels', [], 'https://'),
  q('entity_type', 'نوع الكيان', 'single_choice', true, 11, 'documents', ['شركة / مؤسسة','وثيقة عمل حر']),
  q('entity_document', 'السجل التجاري / وثيقة العمل الحر', 'file', true, 12, 'documents'),
  q('trademark_status', 'هل لديك علامة تجارية خاصة؟', 'single_choice', true, 13, 'documents', ['نعم ومسجلة','نعم لكن غير مسجلة','لا توجد علامة تجارية خاصة']),
  q('trademark_certificate', 'شهادة العلامة التجارية', 'file', false, 14, 'documents'),
  q('national_address', 'العنوان الوطني للمؤسسة', 'file', false, 15, 'documents'),
  q('tax_certificate', 'الشهادة الضريبية', 'file', false, 16, 'documents'),
]

export default function PricingRequest() {
  const [form, setForm] = useState<PublicForm | null>(null)
  const [questions, setQuestions] = useState<ServiceQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [files, setFiles] = useState<Record<string, File>>({})
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [referenceCode, setReferenceCode] = useState('')
  const startedAt = useRef(Date.now())
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadPublicForm(controller.signal).then(result => {
      setForm(result.form); setQuestions(result.questions)
    }).catch(() => {
      setForm(FALLBACK_FORM); setQuestions(FALLBACK_QUESTIONS)
      setLoadError('تعذر تحديث النموذج الآن؛ يمكنك تعبئته وسنحاول الإرسال عند الانتهاء.')
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'طلب خدمة Sellpert'
    return () => { document.title = previousTitle }
  }, [])

  const sectionQuestions = useMemo(() => {
    const sectionId = SECTIONS[step].id
    return questions.filter(question => (question.config?.section || 'business') === sectionId).sort((a, b) => a.position - b.position)
  }, [questions, step])

  function setAnswer(key: string, value: Answer) {
    setAnswers(current => ({ ...current, [key]: value }))
    setErrors(current => { const next = { ...current }; delete next[key]; return next })
  }

  function validateCurrent() {
    const next: Record<string, string> = {}
    for (const question of sectionQuestions) {
      const value = answers[question.key]
      const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0)
      if (question.type === 'file') {
        if (question.required && !files[question.id]) next[question.key] = 'هذا الملف مطلوب'
        continue
      }
      if (question.required && empty) { next[question.key] = 'هذا الحقل مطلوب'; continue }
      if (empty) continue
      if (question.type === 'url' && typeof value === 'string' && !validUrl(value)) next[question.key] = 'أدخل رابطاً صحيحاً'
      if (question.config?.format === 'email' && typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) next[question.key] = 'أدخل بريداً إلكترونياً صحيحاً'
      if (question.config?.format === 'saudi_phone' && typeof value === 'string' && !/^5\d{8}$/.test(value.replace(/\D/g, ''))) next[question.key] = 'أدخل رقماً سعودياً يبدأ بـ 5'
      if (question.config?.format === 'number' && (!Number.isFinite(Number(value)) || Number(value) < 0)) next[question.key] = 'أدخل رقماً صحيحاً'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function move(nextStep: number) {
    setStep(nextStep); setErrors({}); setSubmitError('')
    setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!validateCurrent()) return
    if (step < SECTIONS.length - 1) { move(step + 1); return }
    if (!form) return
    setSubmitting(true); setSubmitError('')
    try {
      const body = new FormData()
      body.set('answers', JSON.stringify(answers)); body.set('started_at', String(startedAt.current)); body.set('company_website', '')
      Object.entries(files).forEach(([id, file]) => body.set(`file_${id}`, file))
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pricing-request?slug=${encodeURIComponent(form.slug)}`, {
        method: 'POST', headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` }, body,
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.ok) throw new Error(result.error || 'تعذر إرسال الطلب')
      setReferenceCode(result.reference_code); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) { setSubmitError(error instanceof Error ? error.message : 'تعذر إرسال الطلب الآن') }
    finally { setSubmitting(false) }
  }

  if (!form) return <PricingFrame><div className="pricing-loading"><span /><p>جاري تحميل النموذج...</p></div></PricingFrame>
  if (referenceCode) return <Success referenceCode={referenceCode} />

  return (
    <PricingFrame>
      <main className="pricing-shell" ref={topRef}>
        <Progress step={step} />
        <div className="pricing-layout">
          <form className="pricing-form" onSubmit={submit} noValidate>
            <header className="pricing-form__heading">
              <small>الخطوة {step + 1} من {SECTIONS.length}</small>
              <h1>{step === 0 ? form.title : SECTIONS[step].title}</h1>
              <p>{step === 0 ? form.description : SECTIONS[step].description}</p>
            </header>
            {loadError && <div className="pricing-notice">{loadError}</div>}
            <div className="pricing-fields">
              {sectionQuestions.map(question => <Question key={question.id} question={question} value={answers[question.key]} file={files[question.id]} error={errors[question.key]} onAnswer={value => setAnswer(question.key, value)} onFile={file => { setFiles(current => ({ ...current, [question.id]: file })); setErrors(current => { const next = { ...current }; delete next[question.key]; return next }) }} onRemoveFile={() => setFiles(current => { const next = { ...current }; delete next[question.id]; return next })} />)}
            </div>
            {submitError && <div className="pricing-submit-error" role="alert">{submitError}</div>}
            <div className="pricing-actions">
              {step > 0 && <button type="button" className="pricing-button pricing-button--secondary" onClick={() => move(step - 1)} disabled={submitting}><ArrowRight /> السابق</button>}
              <button className="pricing-button pricing-button--primary" type="submit" disabled={submitting}>
                {submitting ? <><span className="pricing-spinner" /> جارٍ الإرسال...</> : step === SECTIONS.length - 1 ? <>إرسال الطلب <Check /></> : <>التالي <ArrowLeft /></>}
              </button>
            </div>
          </form>
          <aside className="pricing-assurance">
            <section><ShieldCheck /><div><h2>نحن نهتم ببياناتك</h2><p>نستخدم معلوماتك فقط لإعداد عرض السعر، ولن نشاركها مع أي طرف ثالث.</p></div></section>
            <hr />
            <section><Clock3 /><div><p>نراجع طلبك خلال</p><strong>يوم عمل</strong></div></section>
          </aside>
        </div>
      </main>
    </PricingFrame>
  )
}

function Question({ question, value, file, error, onAnswer, onFile, onRemoveFile }: { question: ServiceQuestion; value?: Answer; file?: File; error?: string; onAnswer: (value: Answer) => void; onFile: (file: File) => void; onRemoveFile: () => void }) {
  const label = <span className="pricing-field__label">{question.label}{question.required && <b>*</b>}{question.help_text && <small>{question.help_text}</small>}</span>
  if (question.type === 'file') return <FileQuestion question={question} file={file} error={error} onFile={onFile} onRemove={onRemoveFile} />
  if (question.type === 'single_choice') return <fieldset className={`pricing-choice-group ${error ? 'is-invalid' : ''}`}><legend>{label}</legend>{question.options.map(option => <label className="pricing-radio" key={option}><input type="radio" name={question.id} checked={value === option} onChange={() => onAnswer(option)} /><span>{option}</span></label>)}{error && <em>{error}</em>}</fieldset>
  if (question.type === 'multiple_choice') {
    const selected = Array.isArray(value) ? value : []
    return <fieldset className={`pricing-choice-group ${error ? 'is-invalid' : ''}`}><legend>{label}</legend><div className="pricing-check-grid">{question.options.map(option => <label className="pricing-check" key={option}><input type="checkbox" checked={selected.includes(option)} onChange={() => onAnswer(selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option])} /><span>{option}</span></label>)}</div>{error && <em>{error}</em>}</fieldset>
  }
  return <label className={`pricing-field ${error ? 'is-invalid' : ''}`}>{label}{question.type === 'long_text' ? <textarea value={typeof value === 'string' ? value : ''} placeholder={question.placeholder} onChange={event => onAnswer(event.target.value)} /> : question.type === 'dropdown' ? <select value={typeof value === 'string' ? value : ''} onChange={event => onAnswer(event.target.value)}><option value="">اختر الإجابة</option>{question.options.map(option => <option key={option}>{option}</option>)}</select> : <input type={question.type === 'url' ? 'url' : question.config?.format === 'email' ? 'email' : 'text'} inputMode={question.config?.format === 'saudi_phone' || question.config?.format === 'number' ? 'numeric' : undefined} dir={question.type === 'url' || question.config?.format === 'email' ? 'ltr' : undefined} value={typeof value === 'string' ? value : ''} placeholder={question.placeholder} onChange={event => onAnswer(question.config?.format === 'saudi_phone' ? event.target.value.replace(/\D/g, '').slice(0, 9) : event.target.value)} />}{error && <em>{error}</em>}</label>
}

function FileQuestion({ question, file, error, onFile, onRemove }: { question: ServiceQuestion; file?: File; error?: string; onFile: (file: File) => void; onRemove: () => void }) {
  function pick(event: ChangeEvent<HTMLInputElement>) { const next = event.target.files?.[0]; if (next) onFile(next) }
  return <div className={`pricing-file ${error ? 'is-invalid' : ''}`}><div>{question.label}{question.required && <b>*</b>}<small>{question.help_text || 'PDF أو صورة · حتى 5 MB'}</small></div>{file ? <div className="pricing-file__selected"><FileText /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span><button type="button" onClick={onRemove} aria-label="إزالة الملف"><X /></button></div> : <label><UploadCloud /> إضافة ملف<input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={pick} /></label>}{error && <em>{error}</em>}</div>
}

function Progress({ step }: { step: number }) { return <ol className="pricing-progress">{SECTIONS.map((section, index) => <li key={section.id} className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}><span>{index < step ? <Check /> : index + 1}</span><b>{section.label}</b></li>)}</ol> }
function PricingFrame({ children }: { children: ReactNode }) { return <div className="pricing-page" dir="rtl"><header className="pricing-header"><a className="pricing-brand" href="/"><span>S</span><b>Sellpert</b></a><strong>طلب خدمة Sellpert</strong></header>{children}<footer className="pricing-footer">&copy; {new Date().getFullYear()} Sellpert · <a href="/privacy">سياسة الخصوصية</a></footer></div> }
function Success({ referenceCode }: { referenceCode: string }) { return <PricingFrame><main className="pricing-success"><span><Check /></span><h1>وصلنا طلبك بنجاح</h1><p>سيراجع فريق Sellpert تفاصيل نشاطك ويتواصل معك خلال يوم عمل.</p><div><small>رقم الطلب</small><strong dir="ltr">{referenceCode}</strong></div><a className="pricing-button pricing-button--primary" href="/">العودة إلى Sellpert <ArrowLeft /></a></main></PricingFrame> }

async function loadPublicForm(signal: AbortSignal): Promise<{ form: PublicForm; questions: ServiceQuestion[] }> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pricing-request?slug=sellpert-service-request`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }, signal })
  if (!response.ok) throw new Error('load failed')
  const result = await response.json()
  return { form: result.form, questions: result.questions }
}
function q(key: string, label: string, type: ServiceQuestionType, required: boolean, position: number, section: string, options: string[] = [], placeholder = '', format?: string): ServiceQuestion { return { id: `preview-${key}`, key, label, type, help_text: '', placeholder, required, position, options, config: { section, format } } }
function validUrl(value: string) { try { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') } catch { return false } }
