export type ProductDeliveryStatus = 'draft' | 'running' | 'accepted' | 'processing' | 'success' | 'partial' | 'failed'

export type ProductContentDraft = {
  title?: string | null
  description?: string | null
  images?: string[] | null
}

export type ProductContentChange = {
  field: 'title' | 'description' | 'images'
  label: string
  before: string
  after: string
}

export type MarketplaceProductAction = {
  action?: string | null
  request?: unknown
}

const STATUS_LABELS: Record<ProductDeliveryStatus, string> = {
  draft: 'مسودة لم تُرسل',
  running: 'جارٍ الإرسال إلى Trendyol',
  accepted: 'تم الإرسال إلى Trendyol',
  processing: 'قيد مراجعة Trendyol',
  success: 'اعتمد Trendyol التعديل',
  partial: 'اعتمد Trendyol جزءًا من التعديل',
  failed: 'رفض Trendyol التعديل',
}

const ACTION_LABELS: Record<string, string> = {
  'products.v2_update_content': 'تعديل محتوى المنتج',
  'products.price_inventory': 'تحديث السعر والمخزون',
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function normalizeProductImages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(image => typeof image === 'string' ? image : (image as { url?: unknown } | null)?.url)
    .map(cleanText)
    .filter(Boolean)
}

function summarizeText(value: string) {
  if (!value) return 'غير محدد'
  return value.length > 140 ? `${value.slice(0, 137)}…` : value
}

function summarizeImages(images: string[]) {
  if (images.length === 0) return 'لا توجد صور'
  if (images.length === 1) return 'صورة واحدة'
  if (images.length === 2) return 'صورتان'
  return `${images.length.toLocaleString('ar-SA-u-nu-latn')} صور`
}

export function getProductContentChanges(current: ProductContentDraft, next: ProductContentDraft): ProductContentChange[] {
  const changes: ProductContentChange[] = []
  const currentTitle = cleanText(current.title)
  const nextTitle = cleanText(next.title)
  const currentDescription = cleanText(current.description)
  const nextDescription = cleanText(next.description)
  const currentImages = normalizeProductImages(current.images)
  const nextImages = normalizeProductImages(next.images)

  if (currentTitle !== nextTitle) changes.push({
    field: 'title', label: 'عنوان المنتج', before: summarizeText(currentTitle), after: summarizeText(nextTitle),
  })
  if (currentDescription !== nextDescription) changes.push({
    field: 'description', label: 'وصف المنتج', before: summarizeText(currentDescription), after: summarizeText(nextDescription),
  })
  if (currentImages.join('\n') !== nextImages.join('\n')) changes.push({
    field: 'images', label: 'صور المنتج',
    before: summarizeImages(currentImages),
    after: summarizeImages(nextImages),
  })
  return changes
}

export function deliveryStatusLabel(status: unknown) {
  const normalized = String(status || '').toLowerCase() as ProductDeliveryStatus
  return STATUS_LABELS[normalized] || 'حالة التعديل غير معروفة'
}

export function productActionLabel(action: unknown) {
  return ACTION_LABELS[String(action || '')] || 'تحديث المنتج'
}

export function shortDeliveryReference(value: unknown) {
  const cleaned = String(value || '').replace(/[^a-zA-Z0-9]/g, '')
  return cleaned ? `TY-${cleaned.slice(-8).toUpperCase()}` : ''
}

export function friendlyDeliveryError(value: unknown) {
  const message = cleanText(value)
  if (!message) return ''
  if (/\[object Object\]|^\{|^\[/.test(message)) return 'رفض Trendyol التعديل دون إرجاع سبب واضح. أعد المحاولة، وإذا تكرر الرفض راجع بيانات المنتج.'
  if (/401|authentication|unauthorized/i.test(message)) return 'رفض Trendyol بيانات الدخول. حدّث مفاتيح الربط ثم اختبر الاتصال.'
  if (/supplier.*not found|supplier id/i.test(message)) return 'لم يتعرّف Trendyol على معرّف البائع. تحقق من المعرّف وبيئة الحساب.'
  if (/barcode.*(invalid|required|missing)|invalid.*barcode/i.test(message)) return 'رفض Trendyol باركود المنتج. تحقق من الباركود ثم أعد الإرسال.'
  if (/timeout|timed out|504/i.test(message)) return 'تأخر رد Trendyol. لم نكرر التعديل تلقائيًا لتجنب الازدواج؛ تحقق من حالة الطلب ثم أعد المحاولة.'
  if (/row-level security|postgres|postgrest|sqlstate|function\s|table\s|http\s*\d/i.test(message)) return 'تعذّر تسجيل طلب التعديل بأمان. أعد تحميل الصفحة ثم حاول مرة أخرى.'
  if (/[\u0600-\u06ff]/.test(message)) return message.length > 320 ? `${message.slice(0, 317)}…` : message
  return 'رفض Trendyol التعديل. راجع بيانات المنتج ثم أعد المحاولة.'
}

export function productActionMatches(action: MarketplaceProductAction, product: { external_id?: unknown; barcode?: unknown; raw?: Record<string, unknown> | null }) {
  const request = action.request as { payload?: { items?: Array<Record<string, unknown>> } } | null
  const items = request?.payload?.items
  if (!Array.isArray(items)) return false

  const contentIds = new Set(
    [product.external_id, product.raw?.contentId, product.raw?.id]
      .map(value => cleanText(String(value ?? '')))
      .filter(Boolean),
  )
  const barcode = cleanText(String(product.barcode ?? ''))

  return items.some(item => {
    const itemContentId = cleanText(String(item.contentId ?? ''))
    const itemBarcode = cleanText(String(item.barcode ?? ''))
    return Boolean((itemContentId && contentIds.has(itemContentId)) || (barcode && itemBarcode === barcode))
  })
}
