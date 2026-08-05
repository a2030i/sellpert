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

