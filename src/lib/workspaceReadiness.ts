export type WorkspaceReadinessInput = {
  sourceReady: boolean
  orderCount: number
  productCount: number
  costedProductCount: number
}

export type WorkspaceReadinessStep = {
  key: 'workspace' | 'source' | 'orders' | 'costs'
  label: string
  detail: string
  complete: boolean
  path?: string
  action?: string
}

export type WorkspaceReadiness = {
  completed: number
  total: number
  percentage: number
  ready: boolean
  nextStep: WorkspaceReadinessStep | null
  steps: WorkspaceReadinessStep[]
}

const MIN_COST_COVERAGE = 80

export function workspaceReadiness(input: WorkspaceReadinessInput): WorkspaceReadiness {
  const orderCount = Math.max(0, Number(input.orderCount || 0))
  const productCount = Math.max(0, Number(input.productCount || 0))
  const costedProductCount = Math.min(productCount, Math.max(0, Number(input.costedProductCount || 0)))
  const costCoverage = productCount > 0 ? (costedProductCount / productCount) * 100 : 0

  const steps: WorkspaceReadinessStep[] = [
    {
      key: 'workspace',
      label: 'مساحة العمل',
      detail: 'تم إنشاء مساحة مستقلة وآمنة لمتجرك.',
      complete: true,
    },
    {
      key: 'source',
      label: 'مصدر البيانات',
      detail: input.sourceReady
        ? 'تم ربط منصة أو استيراد ملف بنجاح.'
        : 'اربط Trendyol أو ارفع ملف منصة لإحضار بياناتك.',
      complete: input.sourceReady,
      path: '/integrations',
      action: 'إدارة مصادر البيانات',
    },
    {
      key: 'orders',
      label: 'الطلبات والمبيعات',
      detail: orderCount > 0
        ? `وصل ${orderCount.toLocaleString('ar-SA-u-nu-latn')} طلب إلى مساحة العمل.`
        : 'شغّل المزامنة أو أكمل استيراد ملف الطلبات.',
      complete: orderCount > 0,
      path: '/integrations',
      action: 'فحص المزامنة والاستيراد',
    },
    {
      key: 'costs',
      label: 'جاهزية الربحية',
      detail: productCount === 0
        ? 'ستظهر تغطية التكاليف بعد وصول المنتجات.'
        : costCoverage >= MIN_COST_COVERAGE
          ? `تكاليف ${costCoverage.toFixed(0)}% من المنتجات متوفرة؛ يمكن الاعتماد على تحليل الربحية.`
          : `تكاليف ${costCoverage.toFixed(0)}% فقط من المنتجات متوفرة؛ أكملها للوصول إلى ${MIN_COST_COVERAGE}%.`,
      complete: productCount > 0 && costCoverage >= MIN_COST_COVERAGE,
      path: '/products?costs=import',
      action: 'استكمال تكاليف المنتجات',
    },
  ]

  const completed = steps.filter(step => step.complete).length
  return {
    completed,
    total: steps.length,
    percentage: Math.round((completed / steps.length) * 100),
    ready: completed === steps.length,
    nextStep: steps.find(step => !step.complete) || null,
    steps,
  }
}

