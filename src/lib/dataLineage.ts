import { PLATFORM_MAP } from './constants'

export type LineageOrder = {
  platform: string
  upload_id?: string | null
  last_synced_at?: string | null
}

export type LineageUpload = {
  id: string
  platform: string
  file_name?: string | null
  file_type?: string | null
  uploaded_at?: string | null
}

export type DataLineage = {
  kind: 'file' | 'api' | 'unknown'
  label: string
  exportLabel: string
  title: string
  tone: 'info' | 'success' | 'warning'
  fileName: string | null
  occurredAt: string | null
}

export type LineageProduct = LineageOrder & {
  platform_source?: string | null
}

export type ProductDataLineage = Omit<DataLineage, 'kind'> & {
  kind: 'file' | 'api' | 'manual' | 'combined' | 'unknown'
}

export type LineageInventory = {
  platform: string
  upload_id?: string | null
  platform_source?: string | null
  last_updated?: string | null
  last_synced_at?: string | null
}

export type InventoryDataLineage = Omit<DataLineage, 'kind'> & {
  kind: 'file' | 'api' | 'manual' | 'manual_override' | 'combined' | 'unknown'
  apiSyncedAt: string | null
}

export type InventoryFreshness = {
  status: 'fresh' | 'aging' | 'stale' | 'unknown'
  label: string
  ageHours: number | null
  tone: 'success' | 'warning' | 'danger'
}

function sourcePlatformLabel(platformSource?: string | null) {
  const normalized = String(platformSource || '').trim().toLowerCase()
  const platform = Object.keys(PLATFORM_MAP).find(key => normalized.startsWith(key))
  return platform ? PLATFORM_MAP[platform] || platform : null
}

export function orderDataLineage(order: LineageOrder, upload?: LineageUpload | null): DataLineage {
  const platformLabel = PLATFORM_MAP[order.platform] || order.platform
  if (order.upload_id) {
    const fileName = upload?.file_name?.trim() || null
    return {
      kind: 'file',
      label: `ملف ${platformLabel}`,
      exportLabel: fileName ? `ملف ${platformLabel}: ${fileName}` : `ملف ${platformLabel}`,
      title: fileName ? `تم استيراد الطلب من الملف ${fileName}` : `تم استيراد الطلب من ملف ${platformLabel}`,
      tone: 'info',
      fileName,
      occurredAt: upload?.uploaded_at || null,
    }
  }

  if (order.last_synced_at) {
    return {
      kind: 'api',
      label: `API ${platformLabel}`,
      exportLabel: `API ${platformLabel}`,
      title: `تم سحب الطلب مباشرة من ربط ${platformLabel}`,
      tone: 'success',
      fileName: null,
      occurredAt: order.last_synced_at,
    }
  }

  return {
    kind: 'unknown',
    label: 'مصدر غير محدد',
    exportLabel: 'مصدر غير محدد',
    title: 'لا توجد بيانات كافية لتحديد مصدر هذا الطلب القديم',
    tone: 'warning',
    fileName: null,
    occurredAt: null,
  }
}

export function productDataLineage(product: LineageProduct, upload?: LineageUpload | null): ProductDataLineage {
  const filePlatform = upload ? PLATFORM_MAP[upload.platform] || upload.platform : null
  const fileName = upload?.file_name?.trim() || null
  const platformSource = String(product.platform_source || '').trim().toLowerCase()
  const apiPlatform = sourcePlatformLabel(platformSource)
  const hasFile = Boolean(product.upload_id)
  const hasApi = Boolean(product.last_synced_at) || platformSource.includes('api')

  if (hasFile && hasApi) {
    const fileLabel = filePlatform ? `ملف ${filePlatform}` : 'ملف مرفوع'
    const apiLabel = apiPlatform ? `API ${apiPlatform}` : 'API مباشر'
    return {
      kind: 'combined',
      label: `${fileLabel} + ${apiLabel}`,
      exportLabel: `${fileLabel}${fileName ? `: ${fileName}` : ''} + ${apiLabel}`,
      title: 'بدأت بيانات المنتج من ملف، ثم جرى تحديثها من الربط المباشر.',
      tone: 'success',
      fileName,
      occurredAt: product.last_synced_at || upload?.uploaded_at || null,
    }
  }

  if (hasFile) {
    const label = filePlatform ? `ملف ${filePlatform}` : 'ملف مرفوع'
    return {
      kind: 'file', label, exportLabel: fileName ? `${label}: ${fileName}` : label,
      title: fileName ? `تم استيراد المنتج من الملف ${fileName}` : 'تم استيراد المنتج من ملف مرفوع.',
      tone: 'info', fileName, occurredAt: upload?.uploaded_at || null,
    }
  }

  if (hasApi) {
    const label = apiPlatform ? `API ${apiPlatform}` : 'API مباشر'
    return {
      kind: 'api', label, exportLabel: label,
      title: apiPlatform ? `تم جلب المنتج من ربط ${apiPlatform}.` : 'تم جلب المنتج من ربط مباشر.',
      tone: 'success', fileName: null, occurredAt: product.last_synced_at || null,
    }
  }

  if (platformSource === 'manual') {
    return {
      kind: 'manual', label: 'إضافة يدوية', exportLabel: 'إضافة يدوية',
      title: 'أضاف التاجر هذا المنتج من داخل Sellpert.', tone: 'info', fileName: null, occurredAt: null,
    }
  }

  return {
    kind: 'unknown', label: 'مصدر غير موثق', exportLabel: 'مصدر غير موثق',
    title: 'هذا منتج قديم ولا توجد بيانات كافية لتحديد مصدره.', tone: 'warning', fileName: null, occurredAt: null,
  }
}

export function inventoryDataLineage(item: LineageInventory, upload?: LineageUpload | null): InventoryDataLineage {
  const source = String(item.platform_source || '').trim().toLowerCase()
  const platformLabel = PLATFORM_MAP[item.platform] || item.platform
  const filePlatform = upload ? PLATFORM_MAP[upload.platform] || upload.platform : platformLabel
  const fileName = upload?.file_name?.trim() || null
  const hasFile = Boolean(item.upload_id)
  const hasApi = Boolean(item.last_synced_at) || source.includes('api')
  const base = { fileName, occurredAt: item.last_updated || upload?.uploaded_at || null, apiSyncedAt: item.last_synced_at || null }

  if (source === 'manual_override') {
    return {
      ...base, kind: 'manual_override', label: 'تعديل يدوي', exportLabel: 'تعديل يدوي', tone: 'info',
      title: item.last_synced_at
        ? `عدّل التاجر الكمية بعد آخر مزامنة من ${platformLabel}.`
        : 'عدّل التاجر الكمية يدويًا من داخل Sellpert.',
    }
  }
  if (source === 'manual') {
    return { ...base, kind: 'manual', label: 'إضافة يدوية', exportLabel: 'إضافة يدوية', tone: 'info', title: 'أضاف التاجر سجل المخزون من داخل Sellpert.' }
  }
  if (hasFile && hasApi) {
    const label = `ملف ${filePlatform} + API ${platformLabel}`
    return { ...base, kind: 'combined', label, exportLabel: fileName ? `${label}: ${fileName}` : label, tone: 'success', title: 'بدأ سجل الكمية من ملف ثم جرى تحديثه من الربط المباشر.' }
  }
  if (hasApi) {
    const label = `API ${platformLabel}`
    return { ...base, kind: 'api', label, exportLabel: label, tone: 'success', title: `تم تحديث الكمية من ربط ${platformLabel}.` }
  }
  if (hasFile) {
    const label = `ملف ${filePlatform}`
    return { ...base, kind: 'file', label, exportLabel: fileName ? `${label}: ${fileName}` : label, tone: 'info', title: fileName ? `تم تحديث الكمية من الملف ${fileName}.` : `تم تحديث الكمية من ملف ${filePlatform}.` }
  }
  return { ...base, kind: 'unknown', label: 'مصدر غير موثق', exportLabel: 'مصدر غير موثق', tone: 'warning', title: 'هذا سجل قديم ولا توجد بيانات كافية لتحديد مصدر الكمية.' }
}

export function inventoryFreshness(lastUpdated?: string | null, now = new Date()): InventoryFreshness {
  const timestamp = lastUpdated ? new Date(lastUpdated) : null
  if (!timestamp || Number.isNaN(timestamp.getTime())) return { status: 'unknown', label: 'وقت التحديث غير معروف', ageHours: null, tone: 'danger' }
  const ageHours = Math.max(0, Math.floor((now.getTime() - timestamp.getTime()) / 3_600_000))
  if (ageHours <= 24) return { status: 'fresh', label: ageHours < 1 ? 'محدث الآن' : `محدث منذ ${ageHours} ساعة`, ageHours, tone: 'success' }
  const ageDays = Math.floor(ageHours / 24)
  if (ageHours <= 72) return { status: 'aging', label: `محدث منذ ${ageDays} يوم`, ageHours, tone: 'warning' }
  return { status: 'stale', label: `قديم منذ ${ageDays} يوم`, ageHours, tone: 'danger' }
}
