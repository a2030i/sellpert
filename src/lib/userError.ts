type ErrorLike = {
  message?: unknown
  code?: unknown
  status?: unknown
  error?: unknown
} | null | undefined

const DEFAULT_MESSAGE = 'تعذّر إتمام العملية الآن. حاول مرة أخرى.'

function errorParts(value: unknown) {
  if (value instanceof Error) return { message: value.message, code: '', status: '' }
  if (typeof value === 'string') return { message: value, code: '', status: '' }
  if (!value || typeof value !== 'object') return { message: '', code: '', status: '' }

  const candidate = value as ErrorLike
  const nested = candidate?.error
  const nestedMessage = nested && typeof nested === 'object'
    ? String((nested as { message?: unknown }).message || '')
    : typeof nested === 'string' ? nested : ''

  return {
    message: String(candidate?.message || nestedMessage || ''),
    code: String(candidate?.code || ''),
    status: String(candidate?.status || ''),
  }
}

/** Converts infrastructure failures into merchant-safe Arabic copy. */
export function userErrorMessage(value: unknown, fallback = DEFAULT_MESSAGE) {
  const { message, code, status } = errorParts(value)
  const normalized = `${code} ${status} ${message}`.trim().toLowerCase()

  if (!normalized) return fallback
  if (/failed to fetch|network|networkerror|load failed|offline|connection/.test(normalized)) {
    return 'تعذّر الاتصال بالخدمة. تحقق من الإنترنت ثم أعد المحاولة.'
  }
  if (/timeout|timed out|gateway timeout|504/.test(normalized)) {
    return 'استغرقت العملية وقتًا أطول من المعتاد. أعد المحاولة بعد لحظات.'
  }
  if (/jwt|refresh token|session.*expired|invalid.*token|401|not authenticated|auth_required/.test(normalized)) {
    return 'انتهت جلسة الدخول. سجّل الدخول من جديد لإكمال العملية.'
  }
  if (/row-level security|permission denied|insufficient_privilege|forbidden|42501|not authorized|unauthorized/.test(normalized)) {
    return 'لا تملك صلاحية تنفيذ هذه العملية على المتجر المحدد.'
  }
  if (/duplicate|unique constraint|already exists|23505/.test(normalized)) {
    return 'هذا السجل موجود مسبقًا. حدّث الصفحة وتحقق من البيانات.'
  }
  if (/invalid input syntax|violates.*constraint|not-null|23502|23503|23514|22p02/.test(normalized)) {
    return 'بعض البيانات غير مكتملة أو غير صالحة. راجع الحقول ثم أعد المحاولة.'
  }
  if (/rate limit|too many requests|429/.test(normalized)) {
    return 'تم تنفيذ محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.'
  }

  const compact = message.trim().replace(/\s+/g, ' ')
  const containsArabic = /[\u0600-\u06ff]/.test(compact)
  const looksTechnical = /\[object object\]|^[{[]|postgres|postgrest|supabase|sqlstate|stack|function\s|table\s|column\s|schema\s|http\s*\d/i.test(compact)
  if (containsArabic && !looksTechnical && compact.length <= 240) return compact

  return fallback
}

