import { createClient } from 'npm:@supabase/supabase-js@2.104.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ALLOWED_TABLES = new Set([
  'merchants', 'platform_credentials', 'platform_connections',
  'merchant_account_links', 'platform_file_uploads', 'merchant_requests',
  'payment_requests', 'account_closure_requests', 'merchant_data_export',
  'auth_security',
])
const IGNORED_FIELDS = new Set([
  'updated_at', 'created_at', 'last_sync_at', 'last_tested_at',
  'api_key', 'api_secret', 'secret', 'access_token', 'refresh_token',
  'authorization', 'password', 'encrypted_payload', 'credential_payload',
  'client_secret', 'webhook_secret', 'extra', 'raw', 'payload',
])

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
})

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'الطلب غير مدعوم.' }, 405)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token) throw new HttpError(401, 'يرجى تسجيل الدخول من جديد.')
    const { data: { user }, error: userError } = await admin.auth.getUser(token)
    if (userError || !user) throw new HttpError(401, 'انتهت جلسة الدخول. يرجى تسجيل الدخول من جديد.')
    const { data: caller, error: callerError } = await admin.from('merchants')
      .select('merchant_code,owner_merchant_code,permissions,role,is_active')
      .eq('id', user.id).maybeSingle()
    if (callerError) throw callerError
    if (!caller || caller.is_active === false) throw new HttpError(403, 'الحساب غير مخوّل بعرض سجل النشاط.')

    const body = await req.json().catch(() => ({}))
    const scope = await authorizeScope(admin, caller, user.id, body?.merchant_code)
    const page = clampInt(body?.page, 1, 100000, 1)
    const limit = clampInt(body?.limit, 10, 100, 30)
    const from = (page - 1) * limit
    const action = clean(body?.action).toLowerCase()
    const table = clean(body?.table)
    if (action && !['insert', 'update', 'delete', 'account_closure_requested', 'account_closure_cancelled', 'account_closure_completed', 'account_data_export_started', 'mfa_enabled', 'mfa_disabled', 'mfa_recovery_codes_regenerated', 'mfa_recovered'].includes(action)) throw new HttpError(400, 'مرشح الإجراء غير صالح.')
    if (table && !ALLOWED_TABLES.has(table)) throw new HttpError(400, 'مرشح نوع النشاط غير صالح.')

    let query = admin.from('audit_log')
      .select('id,merchant_code,action,table_name,old_values,new_values,performed_by,performed_at', { count: 'exact' })
      .order('performed_at', { ascending: false })
      .range(from, from + limit - 1)
    if (scope.merchantCode) query = query.eq('merchant_code', scope.merchantCode)
    if (action) query = query.eq('action', action)
    if (table) query = query.eq('table_name', table)
    const { data, count, error } = await query
    if (error) throw error

    return json({
      page, limit, total: count || 0,
      scope: scope.kind,
      entries: (data || []).map(row => sanitizeEntry(row)),
    })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'تعذر تحميل سجل النشاط.'
    return json({ error: message }, status)
  }
})

async function authorizeScope(admin: any, caller: any, userId: string, requestedValue: unknown) {
  const requested = clean(requestedValue)
  if (['admin', 'super_admin'].includes(caller.role) || (caller.role === 'staff' && permissionEnabled(caller.permissions, 'view_audit'))) {
    return { kind: 'platform', merchantCode: requested || null }
  }
  if (caller.role === 'employee') {
    if (!caller.owner_merchant_code || !permissionEnabled(caller.permissions, 'settings')) throw new HttpError(403, 'سجل النشاط متاح لمالك المتجر أو الموظف المخوّل بالإعدادات.')
    if (requested && requested !== caller.owner_merchant_code) throw new HttpError(403, 'لا يمكنك عرض نشاط متجر آخر.')
    await requireActiveWorkspace(admin, caller.owner_merchant_code)
    return { kind: 'merchant', merchantCode: caller.owner_merchant_code }
  }
  if (caller.role !== 'merchant' || !caller.merchant_code) throw new HttpError(403, 'الحساب غير مخوّل بعرض سجل النشاط.')
  if (!requested || requested === caller.merchant_code) return { kind: 'merchant', merchantCode: caller.merchant_code }
  const { data: link } = await admin.from('merchant_account_links').select('id')
    .eq('user_id', userId).eq('merchant_code', requested).maybeSingle()
  if (!link) throw new HttpError(403, 'لا يمكنك عرض نشاط متجر آخر.')
  await requireActiveWorkspace(admin, requested)
  return { kind: 'merchant', merchantCode: requested }
}

async function requireActiveWorkspace(admin: any, merchantCode: string) {
  const { data: workspace, error } = await admin.from('merchants')
    .select('is_active').eq('merchant_code', merchantCode).eq('role', 'merchant').maybeSingle()
  if (error) throw error
  if (!workspace || workspace.is_active === false) throw new HttpError(403, 'Merchant account is inactive')
}

function sanitizeEntry(row: any) {
  const before = objectValue(row.old_values)
  const after = objectValue(row.new_values)
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changedFields = [...keys].filter(key => !IGNORED_FIELDS.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
  return {
    id: row.id,
    merchant_code: row.merchant_code,
    action: row.action,
    entity: ALLOWED_TABLES.has(row.table_name) ? row.table_name : 'operational_record',
    actor: safeActor(row.performed_by),
    occurred_at: row.performed_at,
    changed_fields_count: changedFields.length,
  }
}

function safeActor(value: unknown) {
  const actor = clean(value)
  if (!actor || ['postgres', 'service_role', 'supabase_admin'].includes(actor.toLowerCase())) return 'النظام'
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(actor)) return 'مستخدم المتجر'
  return actor.slice(0, 160)
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function permissionEnabled(value: unknown, permission: string) {
  if (Array.isArray(value)) return value.includes(permission)
  return !!value && typeof value === 'object' && (value as Record<string, unknown>)[permission] === true
}
function clean(value: unknown) { return String(value || '').trim() }
function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}
