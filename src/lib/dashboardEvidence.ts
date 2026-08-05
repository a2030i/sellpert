export type DashboardEvidenceStatus = 'current' | 'stale' | 'partial' | 'unknown'

export type DashboardEvidenceSource = {
  key: string
  label: string
  ageDays: number | null | undefined
}

export type DashboardEvidenceState = {
  status: DashboardEvidenceStatus
  title: string
  detail: string
  staleSources: DashboardEvidenceSource[]
  oldestAgeDays: number | null
}

const FRESHNESS_LIMIT_DAYS = 2

export function dashboardEvidenceState(
  sources: DashboardEvidenceSource[],
  partialData: boolean,
): DashboardEvidenceState {
  const available = sources.filter(source => Number.isFinite(source.ageDays) && Number(source.ageDays) >= 0)
  const staleSources = available.filter(source => Number(source.ageDays) > FRESHNESS_LIMIT_DAYS)
  const oldestAgeDays = available.length
    ? Math.max(...available.map(source => Number(source.ageDays)))
    : null

  if (partialData) {
    return {
      status: 'partial',
      title: 'البيانات جزئية',
      detail: 'تعذر تحميل جزء من الأدلة. تظهر آخر نتيجة ناجحة، وقد تكون بعض المؤشرات ناقصة.',
      staleSources,
      oldestAgeDays,
    }
  }

  if (!available.length) {
    return {
      status: 'unknown',
      title: 'حداثة الأدلة غير معروفة',
      detail: 'لا توجد تواريخ كافية للتحقق من حداثة التحليل. حدّث مصادر البيانات قبل اتخاذ قرار مالي مهم.',
      staleSources: [],
      oldestAgeDays: null,
    }
  }

  if (staleSources.length) {
    const labels = staleSources.map(source => source.label).join('، ')
    return {
      status: 'stale',
      title: 'تحتاج البيانات إلى تحديث',
      detail: `بيانات ${labels} أقدم من يومين. تبقى النتائج ظاهرة للمراجعة، لكن يفضل التحديث قبل التنفيذ.`,
      staleSources,
      oldestAgeDays,
    }
  }

  return {
    status: 'current',
    title: 'أدلة القرار محدثة',
    detail: 'مصادر التحليل المتاحة محدثة خلال آخر يومين.',
    staleSources: [],
    oldestAgeDays,
  }
}
