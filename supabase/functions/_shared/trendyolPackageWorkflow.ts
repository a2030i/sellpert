export type TrendyolPackageWorkflow = {
  providerStatus: string
  closed: boolean
  canStartPicking: boolean
  canInvoice: boolean
  canUpdateTracking: boolean
  canCancel: boolean
  canSplit: boolean
  guidance: string
}

function normalized(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '')
}

export function trendyolPackageProviderStatus(packageRow: any, orderStatus?: string) {
  return String(
    packageRow?.provider_status
      || packageRow?.raw?.shipmentPackageStatus
      || packageRow?.raw?.status
      || packageRow?.status
      || orderStatus
      || '',
  )
}

export function trendyolPackageWorkflow(packageRow: any, orderStatus?: string): TrendyolPackageWorkflow {
  const providerStatus = trendyolPackageProviderStatus(packageRow, orderStatus)
  const state = normalized(providerStatus)
  const canStartPicking = ['created', 'unpacked'].includes(state)
  const canInvoice = ['picking', 'processing'].includes(state)
  const canUpdateTracking = ['picking', 'processing'].includes(state)
  const canCancel = ['created', 'unpacked', 'picking', 'processing'].includes(state)
  const canSplit = canCancel
  const closed = !canStartPicking && !canInvoice && !canUpdateTracking && !canCancel && !canSplit

  const guidance = state === 'awaiting'
    ? 'الطلب بانتظار تأكيد الدفع من Trendyol؛ لا تنفّذ أي إجراء حتى تتحول حالته إلى Created.'
    : canStartPicking
    ? 'ابدأ تجهيز الشحنة أولًا، وبعد قبول Trendyol يمكنك تسجيل الفاتورة وبيانات الشحن.'
    : canInvoice
      ? 'الشحنة قيد التجهيز؛ يمكنك الآن تسجيل الفاتورة أو تحديث رقم التتبع.'
      : state === 'invoiced'
        ? 'تم تسجيل الفاتورة. ستنتقل حالات الشحن والتسليم تلقائيًا من Trendyol.'
        : 'لا توجد إجراءات يدوية متاحة لهذه الشحنة في حالتها الحالية.'

  return { providerStatus, closed, canStartPicking, canInvoice, canUpdateTracking, canCancel, canSplit, guidance }
}

export function trendyolPackageTransitionError(packageRow: any, action: string, desiredStatus?: string) {
  const workflow = trendyolPackageWorkflow(packageRow)
  const target = normalized(desiredStatus)
  if (action === 'packages.status' && target === 'picking' && !workflow.canStartPicking) {
    return 'لا يمكن بدء التجهيز في حالة الشحنة الحالية؛ حدّث الطلب واقرأ الحالة الجديدة'
  }
  if (action === 'packages.status' && target === 'invoiced' && !workflow.canInvoice) {
    return 'يجب بدء تجهيز الشحنة وقبول حالة Picking قبل تسجيل الفاتورة'
  }
  if (action === 'packages.tracking' && !workflow.canUpdateTracking) {
    return 'يمكن تحديث رقم التتبع فقط عندما تكون الشحنة قيد التجهيز'
  }
  if (action === 'packages.cancel' && !workflow.canCancel) {
    return 'لا يمكن تسجيل تعذر توفير منتج في حالة الشحنة الحالية؛ حدّث الطلب وتحقق من حالته أولًا'
  }
  if (action === 'packages.split' && !workflow.canSplit) {
    return 'لا يمكن تقسيم الشحنة في حالتها الحالية؛ حدّث الطلب وتحقق من حالته أولًا'
  }
  return null
}
