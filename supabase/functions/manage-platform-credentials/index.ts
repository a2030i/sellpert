import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { encryptCredentialPayload } from '../_shared/credentialVault.ts'
import { HttpError, json } from '../_shared/sync.ts'
import { ensureTrendyolWebhook, verifyTrendyolCredentials } from '../_shared/trendyolConnection.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PLATFORMS = new Set(['trendyol'])

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token) throw new HttpError(401, 'Unauthorized')
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) throw new HttpError(401, 'Unauthorized')
    const { data: caller } = await admin.from('merchants').select('merchant_code,owner_merchant_code,permissions,role,is_active')
      .eq('id', user.id).maybeSingle()
    if (!caller || caller.is_active === false) throw new HttpError(403, 'Forbidden')

    const body = await req.json()
    const action = String(body?.action || 'list')
    const merchantCode = await authorizeMerchantScope(admin, caller, user.id, body?.merchant_code)
    if (action === 'list') return json(await listCredentials(admin, merchantCode), 200, corsHeaders)
    if (action === 'save') return json(await saveCredential(admin, { ...body, merchant_code: merchantCode }), 200, corsHeaders)
    if (action === 'delete') return json(await deleteCredential(admin, { ...body, merchant_code: merchantCode }), 200, corsHeaders)
    if (action === 'sync') return json(await enqueueSync(admin, { ...body, merchant_code: merchantCode }), 200, corsHeaders)
    if (action === 'sync-status') return json(await getSyncStatus(admin, { ...body, merchant_code: merchantCode }), 200, corsHeaders)
    throw new HttpError(400, 'Unsupported action')
  } catch (error: any) {
    return json({ error: error.message }, error instanceof HttpError ? error.status : 500, corsHeaders)
  }
})

async function listCredentials(admin: any, merchantCode: string | null) {
  let query = admin.from('platform_credentials')
    .select('id,merchant_code,platform,seller_id,api_key,api_secret,is_active,last_sync_at,last_tested_at,test_status,records_synced,created_at,updated_at,extra')
    .in('platform', [...PLATFORMS])
  if (merchantCode) query = query.eq('merchant_code', merchantCode)
  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) throw error
  return {
    credentials: (data || []).map((row: any) => ({
      id: row.id,
      merchant_code: row.merchant_code,
      platform: row.platform,
      seller_id: row.seller_id,
      is_active: row.is_active,
      last_sync_at: row.last_sync_at,
      last_tested_at: row.last_tested_at,
      test_status: row.test_status,
      records_synced: row.records_synced,
      created_at: row.created_at,
      updated_at: row.updated_at,
      configured: Boolean(row.extra?.secret_blob || row.api_key || row.api_secret || row.extra?.service_account),
    })),
  }
}

async function authorizeMerchantScope(admin: any, caller: any, userId: string, requestedCode: unknown): Promise<string | null> {
  const requested = clean(requestedCode)
  if (['admin', 'super_admin'].includes(caller.role)) return requested || null
  if (caller.role === 'merchant' && caller.merchant_code) {
    if (!requested || requested === caller.merchant_code) return caller.merchant_code
    const { data: link } = await admin.from('merchant_account_links').select('id')
      .eq('user_id', userId).eq('merchant_code', requested).maybeSingle()
    if (!link) throw new HttpError(403, 'Forbidden')
    await requireActiveWorkspace(admin, requested)
    return requested
  }
  if (caller.role === 'employee' && caller.owner_merchant_code && permissionEnabled(caller.permissions, 'integrations')) {
    if (requested && requested !== caller.owner_merchant_code) throw new HttpError(403, 'Forbidden')
    await requireActiveWorkspace(admin, caller.owner_merchant_code)
    return caller.owner_merchant_code
  }
  throw new HttpError(403, 'Forbidden')
}

async function requireActiveWorkspace(admin: any, merchantCode: string) {
  const { data: workspace, error } = await admin.from('merchants')
    .select('is_active').eq('merchant_code', merchantCode).eq('role', 'merchant').maybeSingle()
  if (error) throw error
  if (!workspace || workspace.is_active === false) throw new HttpError(403, 'Merchant account is inactive')
}

function permissionEnabled(value: unknown, permission: string): boolean {
  if (Array.isArray(value)) return value.includes(permission)
  return !!value && typeof value === 'object' && (value as Record<string, unknown>)[permission] === true
}

async function saveCredential(admin: any, body: any) {
  const merchantCode = String(body?.merchant_code || '')
  const platform = String(body?.platform || '')
  if (!merchantCode || !PLATFORMS.has(platform)) throw new HttpError(400, 'Invalid merchant or platform')
  const { data: merchant } = await admin.from('merchants').select('merchant_code')
    .eq('merchant_code', merchantCode).eq('role', 'merchant').maybeSingle()
  if (!merchant) throw new HttpError(404, 'Merchant not found')

  const credentials = validateCredentials(platform, body?.credentials || {})
  let serverVerified = false
  let webhook: Record<string, unknown> | null = null
  let webhookWarning = ''
  let trendyolApiKey = ''
  let trendyolApiSecret = ''
  trendyolApiKey = String(credentials.secret.api_key || '')
  trendyolApiSecret = String(credentials.secret.api_secret || '')
  await verifyTrendyolCredentials(credentials.sellerId, trendyolApiKey, trendyolApiSecret)
  serverVerified = true
  const { data: duplicate, error: duplicateError } = await admin.from('platform_credentials')
    .select('merchant_code').eq('platform', 'trendyol').eq('seller_id', credentials.sellerId)
    .neq('merchant_code', merchantCode).eq('is_active', true).limit(1).maybeSingle()
  if (duplicateError) throw duplicateError
  if (duplicate) throw new HttpError(409, 'حساب Trendyol هذا مرتبط بمساحة عمل أخرى')
  const secretBlob = await encryptCredentialPayload(credentials.secret)
  const extra = { ...credentials.publicExtra, secret_blob: secretBlob }
  const row = {
    merchant_code: merchantCode,
    platform,
    seller_id: credentials.sellerId,
    api_key: null,
    api_secret: null,
    extra,
    is_active: serverVerified,
    test_status: serverVerified ? 'success' : 'untested',
    last_tested_at: serverVerified ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await admin.from('platform_credentials').upsert(row, {
    onConflict: 'merchant_code,platform',
  }).select('id,merchant_code,platform,seller_id,is_active,test_status,updated_at').single()
  if (error) throw error
  if (serverVerified) {
    try {
      const webhookSecret = await resolveTrendyolWebhookSecret(admin)
      webhook = await ensureTrendyolWebhook(
        credentials.sellerId,
        trendyolApiKey,
        trendyolApiSecret,
        webhookSecret,
        `${SUPABASE_URL}/functions/v1/trendyol-webhook`,
      )
    } catch (webhookError: any) {
      webhookWarning = webhookError?.message || 'تعذر تسجيل Webhook تلقائيًا'
    }
  }
  return { ok: true, credential: data, webhook, webhook_warning: webhookWarning || null }
}

async function resolveTrendyolWebhookSecret(admin: any) {
  const fromEnv = String(Deno.env.get('TRENDYOL_WEBHOOK_SECRET') || '').trim()
  if (fromEnv) return fromEnv
  const { data, error } = await admin.from('app_settings').select('value')
    .eq('key', 'TRENDYOL_WEBHOOK_SECRET').maybeSingle()
  if (error) throw error
  const value = typeof data?.value === 'string' ? data.value : String(data?.value?.secret || '')
  if (!value.trim()) throw new Error('TRENDYOL_WEBHOOK_SECRET غير مضبوط')
  return value.trim()
}

async function deleteCredential(admin: any, body: any) {
  const merchantCode = String(body?.merchant_code || '')
  const platform = String(body?.platform || '')
  if (!merchantCode || !PLATFORMS.has(platform)) throw new HttpError(400, 'Invalid merchant or platform')
  const { error } = await admin.from('platform_credentials').delete()
    .eq('merchant_code', merchantCode).eq('platform', platform)
  if (error) throw error
  return { ok: true }
}

async function enqueueSync(admin: any, body: any) {
  const merchantCode = String(body?.merchant_code || '')
  const platform = String(body?.platform || '')
  if (!merchantCode || !PLATFORMS.has(platform)) throw new HttpError(400, 'Invalid merchant or platform')

  const { data: credential, error: credentialError } = await admin.from('platform_credentials')
    .select('id').eq('merchant_code', merchantCode).eq('platform', platform).eq('is_active', true).maybeSingle()
  if (credentialError) throw credentialError
  if (!credential) throw new HttpError(409, 'يجب تفعيل ربط المنصة قبل المزامنة')

  const { data: queued, error: queueLookupError } = await admin.from('sync_queue').select('id')
    .eq('merchant_code', merchantCode).eq('platform', platform).in('status', ['pending', 'processing']).limit(1).maybeSingle()
  if (queueLookupError) throw queueLookupError
  if (queued) return { ok: true, already_queued: true }

  const { error } = await admin.from('sync_queue').insert({
    merchant_code: merchantCode,
    platform,
    job_type: 'sync_all',
    priority: 1,
    status: 'pending',
    scheduled_at: new Date().toISOString(),
  })
  if (error) throw error
  return { ok: true, already_queued: false }
}

async function getSyncStatus(admin: any, body: any) {
  const merchantCode = String(body?.merchant_code || '')
  const platform = String(body?.platform || '')
  if (!merchantCode || !PLATFORMS.has(platform)) throw new HttpError(400, 'Invalid merchant or platform')

  const { data: job, error } = await admin.from('sync_queue')
    .select('id,status,attempts,error_message,created_at,started_at,finished_at')
    .eq('merchant_code', merchantCode).eq('platform', platform)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const { data: log, error: logError } = await admin.from('sync_logs')
    .select('status,records_synced,details,finished_at,error_message')
    .eq('merchant_code', merchantCode).eq('platform', platform)
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (logError) throw logError
  return { ok: true, job: job || null, log: log || null }
}

function validateCredentials(platform: string, input: any) {
  const sellerId = clean(input.seller_id)
  if (!sellerId) throw new HttpError(400, 'Seller ID مطلوب')
  if (platform !== 'trendyol') throw new HttpError(400, 'منصة الربط المباشر غير مدعومة')
  const apiKey = clean(input.api_key); const apiSecret = clean(input.api_secret)
  if (!apiKey || !apiSecret) throw new HttpError(400, 'API Key وAPI Secret مطلوبان')
  return { sellerId, secret: { api_key: apiKey, api_secret: apiSecret }, publicExtra: {} }
}
function clean(value: unknown) { return String(value || '').trim() }
