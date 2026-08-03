import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'content-disposition',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EXPORT_TABLES = [
  'products', 'product_platform_listings', 'product_platform_prices', 'inventory',
  'orders', 'order_items', 'order_packages', 'returns',
  'account_transactions', 'invoices', 'merchant_payout_schedule',
  'performance_data', 'ad_metrics', 'amazon_daily_sales', 'sales_targets', 'budget_alerts',
  'platform_file_uploads', 'sync_logs', 'marketplace_action_logs',
  'merchant_requests', 'notifications', 'merchant_weekly_briefs',
] as const

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, ...headers, 'Content-Type': 'application/json; charset=utf-8' },
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

    const { data: merchant, error: merchantError } = await admin.from('merchants')
      .select('id,merchant_code,name,email,currency,whatsapp_phone,logo_url,sector,sub_sector,created_at,role,is_active')
      .eq('id', user.id).eq('role', 'merchant').maybeSingle()
    if (merchantError) throw merchantError
    if (!merchant || merchant.is_active === false) throw new HttpError(403, 'هذا الإجراء متاح لمالك المتجر النشط فقط.')

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'status')
    if (action === 'status') return json({ request: await currentRequest(admin, merchant.merchant_code) })
    if (action === 'request-closure') return json(await requestClosure(admin, merchant, user.id, body?.reason))
    if (action === 'cancel-closure') return json(await cancelClosure(admin, merchant, user.id))
    if (action === 'export') return exportData(admin, merchant)
    throw new HttpError(400, 'الإجراء المطلوب غير معروف.')
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'تعذر إكمال الإجراء.'
    return json({ error: message }, status)
  }
})

async function currentRequest(admin: any, merchantCode: string) {
  const { data, error } = await admin.from('account_closure_requests')
    .select('id,status,reason,requested_at,scheduled_for,cancelled_at,closed_at')
    .eq('merchant_code', merchantCode).eq('status', 'pending')
    .order('requested_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data || null
}

async function requestClosure(admin: any, merchant: any, userId: string, reasonValue: unknown) {
  const existing = await currentRequest(admin, merchant.merchant_code)
  if (existing) return { ok: true, request: existing, already_pending: true }
  const reason = String(reasonValue || '').trim().slice(0, 1000) || null
  const requestedAt = new Date()
  const scheduledFor = new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
  const { data, error } = await admin.from('account_closure_requests').insert({
    merchant_code: merchant.merchant_code,
    requested_by: userId,
    reason,
    requested_at: requestedAt.toISOString(),
    scheduled_for: scheduledFor.toISOString(),
  }).select('id,status,reason,requested_at,scheduled_for').single()
  if (error) throw error
  await admin.from('audit_log').insert({
    merchant_code: merchant.merchant_code,
    action: 'account_closure_requested',
    table_name: 'account_closure_requests',
    record_id: data.id,
    new_values: { scheduled_for: data.scheduled_for },
    performed_by: userId,
  })
  return { ok: true, request: data, already_pending: false }
}

async function cancelClosure(admin: any, merchant: any, userId: string) {
  const current = await currentRequest(admin, merchant.merchant_code)
  if (!current) throw new HttpError(404, 'لا يوجد طلب إغلاق معلّق.')
  const cancelledAt = new Date().toISOString()
  const { data, error } = await admin.from('account_closure_requests').update({
    status: 'cancelled', cancelled_at: cancelledAt, updated_at: cancelledAt,
  }).eq('id', current.id).eq('merchant_code', merchant.merchant_code).eq('status', 'pending')
    .select('id,status,cancelled_at').single()
  if (error) throw error
  await admin.from('audit_log').insert({
    merchant_code: merchant.merchant_code,
    action: 'account_closure_cancelled',
    table_name: 'account_closure_requests',
    record_id: current.id,
    new_values: { cancelled_at: cancelledAt },
    performed_by: userId,
  })
  return { ok: true, request: data }
}

async function exportData(admin: any, merchant: any) {
  const data: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  const truncated: string[] = []
  for (const table of EXPORT_TABLES) {
    const rows: unknown[] = []
    const pageSize = 1000
    const maxRows = 50000
    for (let from = 0; from < maxRows; from += pageSize) {
      const { data: page, error } = await admin.from(table).select('*')
        .eq('merchant_code', merchant.merchant_code).range(from, from + pageSize - 1)
      if (error) throw new HttpError(500, `تعذر تجهيز بيانات ${table}.`)
      rows.push(...(page || []))
      if (!page || page.length < pageSize) break
      if (rows.length >= maxRows) truncated.push(table)
    }
    data[table] = rows
    counts[table] = rows.length
  }
  const generatedAt = new Date().toISOString()
  return json({
    schema_version: '1.0', generated_at: generatedAt,
    merchant: {
      merchant_code: merchant.merchant_code, name: merchant.name, email: merchant.email,
      currency: merchant.currency, whatsapp_phone: merchant.whatsapp_phone,
      logo_url: merchant.logo_url, sector: merchant.sector, sub_sector: merchant.sub_sector,
      created_at: merchant.created_at,
    },
    counts, truncated, data,
  }, 200, { 'Content-Disposition': `attachment; filename="sellpert-export-${merchant.merchant_code}-${generatedAt.slice(0, 10)}.json"` })
}
