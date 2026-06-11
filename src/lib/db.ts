import { toastErr } from '../components/Toast'

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
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) {
      if (ctx) toastErr(`${ctx}: ${error.message}`)
      break
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}
