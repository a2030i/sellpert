import { createClient } from 'npm:@supabase/supabase-js@2.104.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_TOTAL_SIZE = 15 * 1024 * 1024
const ALLOWED_FILE_TYPES = new Map([
  ['application/pdf', 'pdf'], ['image/jpeg', 'jpg'], ['image/png', 'png'],
])

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  try {
    const url = new URL(req.url)
    const slug = (url.searchParams.get('slug') || 'sellpert-service-request').slice(0, 80)
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: form, error: formError } = await db.from('service_request_forms')
      .select('id,name,slug,title,description,version')
      .eq('slug', slug).eq('is_published', true).maybeSingle()
    if (formError) throw formError
    if (!form) return json({ error: 'النموذج غير متاح حالياً' }, 404)

    const { data: questions, error: questionError } = await db.from('service_request_questions')
      .select('id,key,label,type,help_text,placeholder,required,position,options,config')
      .eq('form_id', form.id).order('position')
    if (questionError) throw questionError

    if (req.method === 'GET') return json({ ok: true, form, questions: questions || [] })
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) return json({ error: 'نوع الطلب غير مدعوم' }, 415)
    const body = await req.formData()
    if (textValue(body, 'company_website')) return json({ ok: true }, 202)
    const startedAt = Number(textValue(body, 'started_at'))
    if (!Number.isFinite(startedAt) || Date.now() - startedAt < 2500) {
      return json({ error: 'تعذر التحقق من الطلب. حاول مرة أخرى.' }, 400)
    }

    let submittedAnswers: Record<string, unknown>
    try {
      const parsed = JSON.parse(textValue(body, 'answers'))
      submittedAnswers = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return json({ error: 'بيانات النموذج غير صالحة' }, 400)
    }

    const answers: Record<string, unknown> = {}
    const pendingFiles: Array<{ questionId: string; key: string; file: File }> = []
    for (const question of questions || []) {
      if (question.type === 'file') {
        const candidate = body.get(`file_${question.id}`)
        if (candidate instanceof File && candidate.size > 0) {
          if (candidate.size > MAX_FILE_SIZE) return json({ error: `ملف «${question.label}» يتجاوز 5 ميجابايت` }, 413)
          if (!ALLOWED_FILE_TYPES.has(candidate.type)) return json({ error: `صيغة ملف «${question.label}» غير مدعومة` }, 400)
          pendingFiles.push({ questionId: question.id, key: question.key, file: candidate })
        } else if (question.required) return json({ error: `الحقل «${question.label}» مطلوب` }, 400)
        continue
      }

      const value = submittedAnswers[question.key]
      const validationError = validateAnswer(question, value)
      if (validationError) return json({ error: validationError }, 400)
      if (value !== undefined && value !== null && value !== '') answers[question.key] = normalizeAnswer(question, value)
    }

    if (pendingFiles.reduce((sum, item) => sum + item.file.size, 0) > MAX_TOTAL_SIZE) {
      return json({ error: 'إجمالي الملفات يتجاوز 15 ميجابايت' }, 413)
    }

    const contactName = cleanString(answers.signer_name, 120) || firstDisplayAnswer(answers) || 'طلب جديد'
    const contactEmail = cleanString(answers.business_email, 254).toLowerCase() || null
    const contactPhone = normalizeSaudiPhone(cleanString(answers.phone, 32))

    const sourceHash = await hashSource(req)
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count, error: rateError } = await db.from('service_request_submissions')
      .select('id', { count: 'exact', head: true }).eq('source_hash', sourceHash).gte('submitted_at', windowStart)
    if (rateError) throw rateError
    if ((count || 0) >= 5) return json({ error: 'تم استلام عدة طلبات مؤخراً. حاول بعد قليل.' }, 429)

    const { data: firstStage, error: stageError } = await db.from('service_request_stages')
      .select('id').eq('form_id', form.id).order('position').limit(1).maybeSingle()
    if (stageError) throw stageError
    if (!firstStage) return json({ error: 'مسار متابعة الطلب غير مهيأ' }, 503)

    const requestId = crypto.randomUUID()
    const referenceCode = createReferenceCode()
    const uploadedPaths: string[] = []
    try {
      for (const item of pendingFiles) {
        const extension = ALLOWED_FILE_TYPES.get(item.file.type)!
        const path = `${requestId}/form/${item.questionId}-${crypto.randomUUID()}.${extension}`
        const { error } = await db.storage.from('service-request-documents').upload(path, item.file, {
          contentType: item.file.type, cacheControl: '3600', upsert: false,
        })
        if (error) throw error
        uploadedPaths.push(path)
        answers[item.key] = { path, name: safeDisplayName(item.file.name), size: item.file.size, type: item.file.type }
      }

      const { error: insertError } = await db.from('service_request_submissions').insert({
        id: requestId, form_id: form.id, reference_code: referenceCode, answers,
        contact_name: contactName, contact_email: contactEmail, contact_phone: contactPhone,
        current_stage_id: firstStage.id, source_hash: sourceHash,
      })
      if (insertError) throw insertError

      const { error: activityError } = await db.from('service_request_activities').insert({
        request_id: requestId, stage_id: firstStage.id, activity_type: 'created',
        content: 'تم تسجيل الطلب من النموذج العام',
      })
      if (activityError) throw activityError
    } catch (error) {
      await db.from('service_request_submissions').delete().eq('id', requestId)
      if (uploadedPaths.length) await db.storage.from('service-request-documents').remove(uploadedPaths)
      throw error
    }

    return json({ ok: true, reference_code: referenceCode }, 201)
  } catch (error) {
    console.error('pricing-request', error)
    return json({ error: 'تعذر تنفيذ الطلب الآن. حاول مرة أخرى.' }, 500)
  }
})

function validateAnswer(question: any, value: unknown): string | null {
  const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  if (empty) return question.required ? `الحقل «${question.label}» مطلوب` : null
  if (question.type === 'multiple_choice') {
    if (!Array.isArray(value)) return `إجابة «${question.label}» غير صالحة`
    const allowed = new Set((question.options || []).filter((item: unknown) => typeof item === 'string'))
    if (value.some(item => typeof item !== 'string' || !allowed.has(item))) return `إجابة «${question.label}» غير صالحة`
    const min = Number(question.config?.min || 0)
    if (min && value.length < min) return `اختر ${min} على الأقل في «${question.label}»`
    return null
  }
  if (typeof value !== 'string') return `إجابة «${question.label}» غير صالحة`
  if (value.length > (question.type === 'long_text' ? 4000 : 1000)) return `إجابة «${question.label}» طويلة جداً`
  if (['single_choice', 'dropdown'].includes(question.type) && !(question.options || []).includes(value)) return `إجابة «${question.label}» غير صالحة`
  if (question.type === 'url' && !validUrl(value)) return `الرابط في «${question.label}» غير صالح`
  if (question.config?.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'البريد الإلكتروني غير صالح'
  if (question.config?.format === 'saudi_phone' && !normalizeSaudiPhone(value)) return 'رقم الجوال غير صالح'
  if (question.config?.format === 'number' && (!Number.isFinite(Number(value)) || Number(value) < 0)) return `القيمة في «${question.label}» غير صالحة`
  return null
}

function normalizeAnswer(question: any, value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 50).map(item => cleanString(item, 200))
  const cleaned = cleanString(value, question.type === 'long_text' ? 4000 : 1000)
  if (question.config?.format === 'saudi_phone') return normalizeSaudiPhone(cleaned)
  if (question.type === 'url') return normalizedUrl(cleaned)
  return cleaned
}

function textValue(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function firstDisplayAnswer(answers: Record<string, unknown>): string {
  for (const value of Object.values(answers)) {
    if (typeof value === 'string' && value.trim().length >= 2) return cleanString(value, 120)
  }
  return ''
}

function normalizeSaudiPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  const local = digits.startsWith('966') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits
  return /^5\d{8}$/.test(local) ? `+966${local}` : null
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 1000) : null
  } catch { return null }
}

function validUrl(value: string) { return normalizedUrl(value) !== null }
function safeDisplayName(name: string) { return name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 160) }

async function hashSource(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const agent = req.headers.get('user-agent') || 'unknown'
  const salt = Deno.env.get('RATE_LIMIT_SALT') || Deno.env.get('SUPABASE_URL') || 'sellpert'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${ip}|${agent}`))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function createReferenceCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `SP-${date}-${crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}
