import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptCredentialPayload } from '../_shared/credentialVault.ts'
import { HttpError, json } from '../_shared/sync.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PLATFORMS = new Set(['amazon', 'noon', 'trendyol'])

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token) throw new HttpError(401, 'Unauthorized')
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user?.email) throw new HttpError(401, 'Unauthorized')
    const { data: caller } = await admin.from('merchants').select('merchant_code,role,is_active')
      .eq('email', user.email).maybeSingle()
    if (!caller || caller.is_active === false) throw new HttpError(403, 'Forbidden')

    const body = await req.json()
    const action = String(body?.action || 'list')
    const merchantCode = authorizeMerchantScope(caller, body?.merchant_code)
    if (action === 'list') return json(await listCredentials(admin, merchantCode), 200, corsHeaders)
    if (action === 'save') return json(await saveCredential(admin, { ...body, merchant_code: merchantCode }), 200, corsHeaders)
    if (action === 'delete') return json(await deleteCredential(admin, { ...body, merchant_code: merchantCode }), 200, corsHeaders)
    throw new HttpError(400, 'Unsupported action')
  } catch (error: any) {
    return json({ error: error.message }, error instanceof HttpError ? error.status : 500, corsHeaders)
  }
})

async function listCredentials(admin: any, merchantCode: string | null) {
  let query = admin.from('platform_credentials')
    .select('id,merchant_code,platform,seller_id,api_key,api_secret,is_active,last_sync_at,last_tested_at,test_status,records_synced,updated_at,extra')
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
      updated_at: row.updated_at,
      configured: Boolean(row.extra?.secret_blob || row.api_key || row.api_secret || row.extra?.service_account),
    })),
  }
}

function authorizeMerchantScope(caller: any, requestedCode: unknown): string | null {
  const requested = clean(requestedCode)
  if (['admin', 'super_admin'].includes(caller.role)) return requested || null
  if (caller.role === 'merchant' && caller.merchant_code) {
    if (requested && requested !== caller.merchant_code) throw new HttpError(403, 'Forbidden')
    return caller.merchant_code
  }
  throw new HttpError(403, 'Forbidden')
}

async function saveCredential(admin: any, body: any) {
  const merchantCode = String(body?.merchant_code || '')
  const platform = String(body?.platform || '')
  if (!merchantCode || !PLATFORMS.has(platform)) throw new HttpError(400, 'Invalid merchant or platform')
  const { data: merchant } = await admin.from('merchants').select('merchant_code')
    .eq('merchant_code', merchantCode).eq('role', 'merchant').maybeSingle()
  if (!merchant) throw new HttpError(404, 'Merchant not found')

  const credentials = validateCredentials(platform, body?.credentials || {})
  const secretBlob = await encryptCredentialPayload(credentials.secret)
  const extra = { ...credentials.publicExtra, secret_blob: secretBlob }
  const row = {
    merchant_code: merchantCode,
    platform,
    seller_id: credentials.sellerId,
    api_key: null,
    api_secret: null,
    extra,
    is_active: body?.verified === true,
    test_status: body?.verified === true ? 'success' : 'untested',
    last_tested_at: body?.verified === true ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await admin.from('platform_credentials').upsert(row, {
    onConflict: 'merchant_code,platform',
  }).select('id,merchant_code,platform,seller_id,is_active,test_status,updated_at').single()
  if (error) throw error
  return { ok: true, credential: data }
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

function validateCredentials(platform: string, input: any) {
  const sellerId = clean(input.seller_id)
  if (!sellerId) throw new HttpError(400, 'Seller ID مطلوب')
  if (platform === 'trendyol') {
    const apiKey = clean(input.api_key); const apiSecret = clean(input.api_secret)
    if (!apiKey || !apiSecret) throw new HttpError(400, 'API Key وAPI Secret مطلوبان')
    return { sellerId, secret: { api_key: apiKey, api_secret: apiSecret }, publicExtra: {} }
  }
  if (platform === 'amazon') {
    const apiKey = clean(input.api_key); const apiSecret = clean(input.api_secret)
    const refreshToken = clean(input.refresh_token)
    if (!apiKey || !apiSecret || !refreshToken) throw new HttpError(400, 'بيانات LWA كاملة مطلوبة')
    return {
      sellerId,
      secret: { api_key: apiKey, api_secret: apiSecret, refresh_token: refreshToken },
      publicExtra: {
        marketplace_id: clean(input.marketplace_id) || 'A17E79C6D8DWNP',
        endpoint: clean(input.endpoint) || 'https://sellingpartnerapi-eu.amazon.com',
      },
    }
  }
  const raw = typeof input.service_account === 'string'
    ? parseJson(input.service_account)
    : input.service_account
  if (!raw?.client_email || !raw?.private_key) throw new HttpError(400, 'Service Account JSON غير صالح')
  return {
    sellerId,
    secret: { service_account: raw },
    publicExtra: {
      token_endpoint: clean(input.token_endpoint) || 'https://idp.noon.partners/token',
      orders_endpoint: clean(input.orders_endpoint) || 'https://api.noon.partners/seller/v1/order',
    },
  }
}

function parseJson(value: string) {
  try { return JSON.parse(value) } catch { throw new HttpError(400, 'Service Account JSON غير صالح') }
}
function clean(value: unknown) { return String(value || '').trim() }
