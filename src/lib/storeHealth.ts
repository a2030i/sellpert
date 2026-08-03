export type HealthLevel = 'healthy' | 'attention' | 'action' | 'setup'

export type HealthCredential = {
  platform: string
  is_active?: boolean | null
  test_status?: string | null
  last_sync_at?: string | null
}

export type HealthLog = {
  id: string
  platform: string
  status?: string | null
  started_at?: string | null
  finished_at?: string | null
  error_message?: string | null
  records_synced?: number | null
}

export type HealthJob = {
  id: number
  platform: string
  status: string
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  error_message?: string | null
  attempts?: number
  max_attempts?: number
}

export type HealthUpload = {
  id: string
  platform: string
  status?: string | null
  uploaded_at?: string | null
  finished_at?: string | null
  error_message?: string | null
  rows_processed?: number | null
}

export type HealthIssue = {
  id: string
  level: 'attention' | 'action'
  platform?: string
  title: string
  description: string
  destination: '/integrations' | '/requests'
}

export type StoreHealth = {
  level: HealthLevel
  title: string
  description: string
  issues: HealthIssue[]
  activeSources: number
  runningOperations: number
  lastSuccessfulAt: string | null
}

const SUCCESS = new Set(['success', 'completed', 'done'])
const RUNNING = new Set(['pending', 'processing', 'running', 'queued'])
const FAILED = new Set(['error', 'failed', 'stalled', 'dead'])

function ageMinutes(value: string | null | undefined, now: number) {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 60000) : Number.POSITIVE_INFINITY
}

export function friendlyOperationError(value?: string | null) {
  const text = String(value || '').toLowerCase()
  if (/401|403|auth|credential|unauthor|forbidden/.test(text)) return 'بيانات الربط تحتاج مراجعة أو إعادة حفظ.'
  if (/429|rate.?limit|too many/.test(text)) return 'منصة البيع أخّرت الطلبات مؤقتًا، وسيحاول النظام مجددًا.'
  if (/timeout|timed out|network|fetch|connection/.test(text)) return 'تعذر الوصول إلى منصة البيع مؤقتًا.'
  if (/format|column|header|worksheet|sheet|parse/.test(text)) return 'تنسيق الملف لا يطابق أحد التقارير المدعومة.'
  return 'لم تكتمل العملية. يمكنك إعادة المحاولة من صفحة الربط ورفع الملفات.'
}

export function buildStoreHealth(input: {
  credentials: HealthCredential[]
  logs: HealthLog[]
  jobs: HealthJob[]
  uploads: HealthUpload[]
  now?: number
}): StoreHealth {
  const now = input.now ?? Date.now()
  const activeCredentials = input.credentials.filter(item => item.is_active !== false)
  const sourcePlatforms = new Set([
    ...activeCredentials.map(item => item.platform),
    ...input.uploads.map(item => item.platform),
  ])
  const issues: HealthIssue[] = []

  for (const credential of activeCredentials) {
    if (credential.test_status && !SUCCESS.has(credential.test_status.toLowerCase())) {
      issues.push({ id: `credential-${credential.platform}`, level: 'action', platform: credential.platform, title: `ربط ${platformLabel(credential.platform)} يحتاج مراجعة`, description: 'آخر اختبار للاتصال لم ينجح. حدّث بيانات الربط ثم اختبر الاتصال.', destination: '/integrations' })
    } else if (!credential.last_sync_at) {
      issues.push({ id: `never-synced-${credential.platform}`, level: 'attention', platform: credential.platform, title: `لم تبدأ مزامنة ${platformLabel(credential.platform)} بعد`, description: 'الاتصال محفوظ، لكن لا توجد مزامنة مكتملة حتى الآن.', destination: '/integrations' })
    } else if (ageMinutes(credential.last_sync_at, now) > 24 * 60) {
      issues.push({ id: `stale-${credential.platform}`, level: 'attention', platform: credential.platform, title: `بيانات ${platformLabel(credential.platform)} متأخرة`, description: 'مرّ أكثر من 24 ساعة على آخر مزامنة ناجحة.', destination: '/integrations' })
    }
  }

  const latestLogByPlatform = latestByPlatform(input.logs, item => item.finished_at || item.started_at)
  for (const log of latestLogByPlatform) {
    const status = String(log.status || '').toLowerCase()
    if (FAILED.has(status)) {
      issues.push({ id: `log-${log.platform}`, level: 'action', platform: log.platform, title: `تعذّر آخر تحديث لـ${platformLabel(log.platform)}`, description: friendlyOperationError(log.error_message), destination: '/integrations' })
    } else if (status === 'partial') {
      issues.push({ id: `partial-${log.platform}`, level: 'attention', platform: log.platform, title: `اكتمل تحديث ${platformLabel(log.platform)} جزئيًا`, description: 'وصلت بعض البيانات، لكن توجد عناصر لم تكتمل معالجتها.', destination: '/integrations' })
    } else if (RUNNING.has(status) && ageMinutes(log.started_at, now) > 15) {
      issues.push({ id: `slow-log-${log.platform}`, level: 'attention', platform: log.platform, title: `تحديث ${platformLabel(log.platform)} يستغرق وقتًا أطول`, description: 'العملية ما زالت جارية منذ أكثر من 15 دقيقة.', destination: '/integrations' })
    }
  }

  const latestJobByPlatform = latestByPlatform(input.jobs, item => item.finished_at || item.started_at || item.created_at)
  for (const job of latestJobByPlatform) {
    const status = job.status.toLowerCase()
    if (FAILED.has(status)) {
      issues.push({ id: `job-${job.id}`, level: 'action', platform: job.platform, title: `عملية ${platformLabel(job.platform)} لم تكتمل`, description: friendlyOperationError(job.error_message), destination: '/integrations' })
    } else if (RUNNING.has(status) && ageMinutes(job.started_at || job.created_at, now) > 15) {
      issues.push({ id: `slow-job-${job.id}`, level: 'attention', platform: job.platform, title: `عملية ${platformLabel(job.platform)} ما زالت قيد التنفيذ`, description: 'لا تحتاج إلى الضغط مرة أخرى؛ يتابع النظام العملية الحالية.', destination: '/integrations' })
    }
  }

  const latestUploadByPlatform = latestByPlatform(input.uploads, item => item.finished_at || item.uploaded_at)
  for (const upload of latestUploadByPlatform) {
    const status = String(upload.status || '').toLowerCase()
    if (FAILED.has(status)) {
      issues.push({ id: `upload-${upload.id}`, level: 'action', platform: upload.platform, title: `تعذّر استيراد ملف ${platformLabel(upload.platform)}`, description: friendlyOperationError(upload.error_message), destination: '/integrations' })
    } else if (RUNNING.has(status) && ageMinutes(upload.uploaded_at, now) > 15) {
      issues.push({ id: `upload-running-${upload.id}`, level: 'attention', platform: upload.platform, title: `ملف ${platformLabel(upload.platform)} ما زال قيد المعالجة`, description: 'لا ترفع الملف نفسه مرة أخرى؛ يتابع النظام المعالجة الحالية.', destination: '/integrations' })
    }
  }

  const uniqueIssues = Array.from(new Map(issues.map(issue => [issue.id, issue])).values())
  const runningOperations = input.jobs.filter(item => RUNNING.has(item.status.toLowerCase())).length
    + input.logs.filter(item => RUNNING.has(String(item.status || '').toLowerCase())).length
    + input.uploads.filter(item => RUNNING.has(String(item.status || '').toLowerCase())).length
  const successfulDates = [
    ...input.logs.filter(item => SUCCESS.has(String(item.status || '').toLowerCase())).map(item => item.finished_at || item.started_at),
    ...input.uploads.filter(item => SUCCESS.has(String(item.status || '').toLowerCase())).map(item => item.finished_at || item.uploaded_at),
    ...activeCredentials.map(item => item.last_sync_at),
  ].filter((value): value is string => !!value).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())

  if (sourcePlatforms.size === 0) return { level: 'setup', title: 'أكمل مصدر البيانات الأول', description: 'اربط منصة بيع أو ارفع ملفًا مدعومًا حتى يبدأ النظام في متابعة صحة متجرك.', issues: [], activeSources: 0, runningOperations, lastSuccessfulAt: null }
  if (uniqueIssues.some(issue => issue.level === 'action')) return { level: 'action', title: 'يوجد إجراء مطلوب', description: 'بعض البيانات لم تُحدّث كما ينبغي. نفّذ الإجراءات المقترحة أدناه.', issues: uniqueIssues, activeSources: sourcePlatforms.size, runningOperations, lastSuccessfulAt: successfulDates[0] || null }
  if (uniqueIssues.length) return { level: 'attention', title: 'المتجر يعمل مع ملاحظات', description: 'البيانات متاحة، لكن توجد عمليات متأخرة أو غير مكتملة تحتاج المتابعة.', issues: uniqueIssues, activeSources: sourcePlatforms.size, runningOperations, lastSuccessfulAt: successfulDates[0] || null }
  return { level: 'healthy', title: 'بيانات المتجر تعمل بصورة طبيعية', description: 'لا توجد عمليات متعثرة أو مصادر بيانات تحتاج تدخلًا حاليًا.', issues: [], activeSources: sourcePlatforms.size, runningOperations, lastSuccessfulAt: successfulDates[0] || null }
}

function latestByPlatform<T extends { platform: string }>(items: T[], dateOf: (item: T) => string | null | undefined) {
  const map = new Map<string, T>()
  for (const item of items) {
    const current = map.get(item.platform)
    if (!current || new Date(dateOf(item) || 0).getTime() > new Date(dateOf(current) || 0).getTime()) map.set(item.platform, item)
  }
  return [...map.values()]
}

export function platformLabel(platform: string) {
  return ({ trendyol: 'Trendyol', amazon: 'Amazon', noon: 'Noon', salla: 'سلة', zid: 'زد' } as Record<string, string>)[platform] || platform
}
