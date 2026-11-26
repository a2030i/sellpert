export const AMAZON_IMPORT_CONNECTED_MESSAGE = 'رفع ملفات أمازون متوقف لهذا الحساب بعد تفعيل الربط المباشر. البيانات السابقة محفوظة، ومزامنة الطلبات والتسويات ستتاح في تحديث لاحق.'
export const AMAZON_IMPORT_UNKNOWN_MESSAGE = 'تعذر التأكد من حالة ربط أمازون. أعد التحقق قبل رفع ملف أمازون؛ يمكنك رفع ملفات المنصات الأخرى.'

/** Unknown or malformed status must never enable Amazon file ingestion. */
export function amazonFileImportMessage(allowed: boolean | null): string | null {
  return allowed === true ? null : allowed === false ? AMAZON_IMPORT_CONNECTED_MESSAGE : AMAZON_IMPORT_UNKNOWN_MESSAGE
}

export function amazonFileImportAllowedFromStatus(status: unknown): boolean | null {
  if (!status || typeof status !== 'object') return null
  const value = status as Record<string, unknown>
  if (typeof value.app_configured !== 'boolean') return null
  if (value.connection === null) return true
  if (!value.connection || typeof value.connection !== 'object') return null
  const active = (value.connection as Record<string, unknown>).is_active
  return typeof active === 'boolean' ? !active : null
}

export async function readAmazonFileImportAllowed(merchantCode: string): Promise<boolean> {
  const { supabase } = await import('./supabase')
  const { data, error } = await supabase.rpc('amazon_file_import_allowed', { p_merchant_code: merchantCode })
  if (error || typeof data !== 'boolean') throw new Error(AMAZON_IMPORT_UNKNOWN_MESSAGE)
  return data
}
