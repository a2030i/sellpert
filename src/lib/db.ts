import { toastErr } from '../components/Toast'
import { userErrorMessage } from './userError'

const PAGE = 1000

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

// يجلب كل الصفوف عبر صفحات متتالية. PostgREST يقتطع أي استعلام بلا حدود
// عند 1000 صف بصمت، والأرقام المالية تُحسب في المتصفح — أي اقتطاع يعني
// أرقاماً خاطئة بلا أي خطأ ظاهر بمجرد تجاوز التاجر 1000 صف.
// مهم: مرّر استعلاماً بترتيب حتمي (order على عمود/أعمدة فريدة) وإلا
// قد تتكرر صفوف أو تسقط بين الصفحات.
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  ctx?: string,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withTimeout(build(from, from + PAGE - 1))
    if (error) {
      if (ctx) toastErr(userErrorMessage(error, `${ctx}. حاول مرة أخرى.`))
      break
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

/** Reject the entire dataset on any failed page: partial financial totals are unsafe. */
export async function fetchAllStrict<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  ctx = 'تعذّر تحميل البيانات',
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withTimeout(build(from, from + PAGE - 1))
    if (error) throw new Error(userErrorMessage(error, `${ctx}. حاول مرة أخرى.`))
    if (!data) throw new Error(`${ctx}. لم تصل نتيجة مكتملة.`)
    all.push(...data)
    if (data.length < PAGE) return all
  }
}

/** Bound UI waiting even when a transport never settles; callers ignore late results. */
export async function withTimeout<T>(request: PromiseLike<T>, milliseconds = 25000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('انتهت مهلة تحميل البيانات. أعد المحاولة.')), milliseconds) }),
    ])
  } finally { clearTimeout(timer) }
}
