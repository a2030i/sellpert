import { supabase } from './supabase'

export type ActivityEntry = {
  id: string
  merchant_code: string | null
  action: string
  entity: string
  actor: string
  occurred_at: string
  changed_fields_count: number
}

export type ActivityResponse = {
  page: number
  limit: number
  total: number
  scope: 'merchant' | 'platform'
  entries: ActivityEntry[]
}

export const ACTIVITY_ENTITIES: Record<string, string> = {
  merchants: 'إعدادات الحساب والفريق',
  platform_credentials: 'ربط منصات البيع',
  platform_connections: 'اتصالات المنصات',
  merchant_account_links: 'المتاجر المرتبطة',
  platform_file_uploads: 'ملفات البيانات',
  merchant_requests: 'طلبات المتجر',
  payment_requests: 'التحويلات',
  account_closure_requests: 'دورة حياة الحساب',
  auth_security: 'أمان الحساب',
  operational_record: 'سجل تشغيلي',
}

export const ACTIVITY_ACTIONS: Record<string, string> = {
  insert: 'إضافة', update: 'تعديل', delete: 'حذف',
  account_closure_requested: 'طلب إغلاق الحساب',
  account_closure_cancelled: 'إلغاء إغلاق الحساب',
  account_closure_completed: 'إغلاق الحساب',
  mfa_enabled: 'تفعيل التحقق بخطوتين',
  mfa_disabled: 'إيقاف التحقق بخطوتين',
  mfa_recovery_codes_regenerated: 'إنشاء رموز استرداد جديدة',
  mfa_recovered: 'استرداد الوصول للحساب',
}

export function activitySummary(entry: ActivityEntry) {
  if (entry.action === 'insert') return 'تم إنشاء سجل جديد'
  if (entry.action === 'delete') return 'تم حذف السجل'
  if (entry.action === 'update') return entry.changed_fields_count > 0
    ? `تم تحديث ${entry.changed_fields_count.toLocaleString('ar-SA')} ${entry.changed_fields_count === 1 ? 'حقل' : 'حقول'}`
    : 'تم تحديث السجل'
  return ACTIVITY_ACTIONS[entry.action] || 'تم تنفيذ إجراء على المتجر'
}

export async function fetchActivityFeed(input: {
  merchantCode?: string
  page?: number
  limit?: number
  action?: string
  table?: string
} = {}): Promise<ActivityResponse> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('انتهت جلسة الدخول. يرجى تسجيل الدخول من جديد.')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activity-feed`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      merchant_code: input.merchantCode || undefined,
      page: input.page || 1,
      limit: input.limit || 30,
      action: input.action || undefined,
      table: input.table || undefined,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `تعذر تحميل سجل النشاط (${response.status}).`)
  return payload as ActivityResponse
}
