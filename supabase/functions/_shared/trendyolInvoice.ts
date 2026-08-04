export const TRENDYOL_INVOICE_MAX_BYTES = 10 * 1024 * 1024

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

export type TrendyolInvoiceFile = {
  shipmentPackageId: string
  fileName: string
  contentType: string
  bytes: Uint8Array
  invoiceNumber?: string
  invoiceDateTime?: string
}

export type TrendyolInvoiceLink = {
  shipmentPackageId: string
  invoiceLink: string
  invoiceNumber?: string
  invoiceDateTime?: string
}

export function normalizeTrendyolInvoiceLink(payload: any): TrendyolInvoiceLink {
  const shipmentPackageId = String(payload?.shipmentPackageId || '').trim()
  if (!/^\d+$/.test(shipmentPackageId)) throw new Error('رقم شحنة Trendyol غير صالح')

  const invoiceLink = String(payload?.invoiceLink || '').trim()
  let parsed: URL
  try { parsed = new URL(invoiceLink) } catch { throw new Error('رابط الفاتورة غير صالح') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('رابط الفاتورة يجب أن يكون آمنًا ويبدأ بـ https')
  }

  const invoiceNumber = String(payload?.invoiceNumber || '').trim()
  if (invoiceNumber && !/^[A-Za-z0-9]{3}\d{13}$/.test(invoiceNumber)) {
    throw new Error('رقم فاتورة التصدير يجب أن يكون 16 خانة: 3 أحرف أو أرقام ثم 13 رقمًا')
  }
  const invoiceDateTime = String(payload?.invoiceDateTime || '').trim()
  if (invoiceDateTime) validateInvoiceDateTime(invoiceDateTime)

  return {
    shipmentPackageId,
    invoiceLink:parsed.toString(),
    ...(invoiceNumber ? { invoiceNumber } : {}),
    ...(invoiceDateTime ? { invoiceDateTime } : {}),
  }
}

export function decodeTrendyolInvoiceFile(payload: any, maxBytes = TRENDYOL_INVOICE_MAX_BYTES): TrendyolInvoiceFile {
  const shipmentPackageId = String(payload?.shipmentPackageId || '').trim()
  if (!/^\d+$/.test(shipmentPackageId)) throw new Error('رقم شحنة Trendyol غير صالح')

  const contentType = String(payload?.contentType || '').trim().toLowerCase()
  if (!ALLOWED_TYPES.has(contentType)) throw new Error('صيغة الفاتورة يجب أن تكون PDF أو JPG أو PNG')

  const dataBase64 = String(payload?.dataBase64 || '').trim()
  if (!dataBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) {
    throw new Error('ملف الفاتورة غير صالح')
  }

  let binary = ''
  try { binary = atob(dataBase64) } catch { throw new Error('ملف الفاتورة غير صالح') }
  if (!binary.length) throw new Error('ملف الفاتورة فارغ')
  if (binary.length > maxBytes) throw new Error('حجم ملف الفاتورة يتجاوز 10 ميجابايت')

  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  if (!matchesSignature(bytes, contentType)) throw new Error('محتوى ملف الفاتورة لا يطابق الصيغة المختارة')

  const suppliedName = String(payload?.fileName || '').trim().split(/[\\/]/).pop() || 'invoice'
  const safeName = suppliedName.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 160) || 'invoice'
  const invoiceNumber = String(payload?.invoiceNumber || '').trim()
  if (invoiceNumber && !/^[A-Za-z0-9]{3}\d{13}$/.test(invoiceNumber)) {
    throw new Error('رقم فاتورة التصدير يجب أن يكون 16 خانة: 3 أحرف أو أرقام ثم 13 رقمًا')
  }

  const invoiceDateTime = String(payload?.invoiceDateTime || '').trim()
  if (invoiceDateTime) validateInvoiceDateTime(invoiceDateTime)

  return {
    shipmentPackageId,
    fileName:safeName,
    contentType,
    bytes,
    ...(invoiceNumber ? { invoiceNumber } : {}),
    ...(invoiceDateTime ? { invoiceDateTime } : {}),
  }
}

function validateInvoiceDateTime(invoiceDateTime: string) {
  if (!/^(\d{10}|\d{13})$/.test(invoiceDateTime) || Number(invoiceDateTime) <= 0) {
    throw new Error('تاريخ فاتورة التصدير غير صالح')
  }
  const milliseconds = invoiceDateTime.length === 10 ? Number(invoiceDateTime) * 1000 : Number(invoiceDateTime)
  if (milliseconds > Date.now() + 5 * 60_000) throw new Error('لا يمكن أن يكون تاريخ الفاتورة في المستقبل')
}

function matchesSignature(bytes: Uint8Array, contentType: string) {
  if (contentType === 'application/pdf') return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index) => bytes[index] === value)
}
