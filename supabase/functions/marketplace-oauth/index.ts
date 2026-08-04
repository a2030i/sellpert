import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.104.0'
import { encryptCredentialPayload } from '../_shared/credentialVault.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://sellpert.vercel.app'
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/marketplace-oauth`
class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  try {
    if (req.method === 'POST') return await startAuthorization(req, admin)
    if (req.method === 'GET') return await finishAuthorization(req, admin)
    return respond({ error: 'Method not allowed' }, 405)
  } catch (error: any) {
    if (req.method === 'GET') return redirectResult('error', error.message || 'oauth_failed')
    return respond({ error: error.message || 'تعذر بدء التفويض' }, error instanceof HttpError ? error.status : 400)
  }
})

async function startAuthorization(req: Request, admin: any) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user?.email) throw new HttpError(401, 'يرجى تسجيل الدخول من جديد')

  const body = await req.json()
  const platform = String(body?.platform || '')
  const requestedCode = String(body?.merchant_code || '')

  const { data: caller } = await admin.from('merchants').select('merchant_code,owner_merchant_code,permissions,role,is_active')
    .eq('id', user.id).maybeSingle()
  if (!caller || caller.is_active === false) throw new HttpError(403, 'غير مصرح')
  const isAdmin = ['admin', 'super_admin'].includes(caller.role)
  const effectiveCode = caller.role === 'employee' ? caller.owner_merchant_code : caller.merchant_code
  const employeeAllowed = caller.role !== 'employee' || permissionEnabled(caller.permissions, 'integrations')
  const merchantCode = isAdmin ? requestedCode : effectiveCode
  if (!employeeAllowed || !merchantCode || (!isAdmin && requestedCode !== merchantCode)) {
    throw new HttpError(403, 'غير مصرح لهذا المتجر')
  }

  const { data: workspace } = await admin.from('merchants')
    .select('is_active').eq('merchant_code', merchantCode).eq('role', 'merchant').maybeSingle()
  if (!workspace || workspace.is_active === false) throw new HttpError(403, 'Merchant account is inactive')

  if (body?.action === 'capabilities') {
    return respond({
      providers: {
        amazon: { enabled: amazonOAuthConfigured() },
        noon: { enabled: noonOAuthConfigured() },
      },
    })
  }
  if (!['amazon', 'noon'].includes(platform)) throw new Error('المنصة غير مدعومة')

  const state = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const { error: stateError } = await admin.from('marketplace_oauth_states').insert({
    state, user_id: user.id, merchant_code: merchantCode, platform,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  if (stateError) throw stateError

  if (platform === 'amazon' && body?.amazon_callback_uri && body?.amazon_state) {
    const callback = new URL(String(body.amazon_callback_uri))
    if (callback.protocol !== 'https:' || !(callback.hostname === 'amazon.com' || callback.hostname.endsWith('.amazon.com'))) {
      throw new Error('عنوان متابعة Amazon غير صالح')
    }
    callback.searchParams.set('amazon_state', String(body.amazon_state))
    callback.searchParams.set('state', state)
    callback.searchParams.set('redirect_uri', CALLBACK_URL)
    if (body?.version === 'beta') callback.searchParams.set('version', 'beta')
    return respond({ authorization_url: callback.toString() })
  }

  const authorizationUrl = platform === 'amazon' ? amazonAuthorizationUrl(state) : noonAuthorizationUrl(state)
  return respond({ authorization_url: authorizationUrl })
}

function permissionEnabled(value: unknown, permission: string): boolean {
  if (Array.isArray(value)) return value.includes(permission)
  return !!value && typeof value === 'object' && (value as Record<string, unknown>)[permission] === true
}

async function finishAuthorization(req: Request, admin: any) {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') || ''
  const code = url.searchParams.get('spapi_oauth_code') || url.searchParams.get('code') || ''
  if (!state || !code) throw new Error(url.searchParams.get('error_description') || 'بيانات التفويض غير مكتملة')

  // Consume the state atomically before exchanging the provider code. Only one
  // concurrent callback can receive the deleted row and reach credential write.
  const { data: pending, error: consumeError } = await admin.from('marketplace_oauth_states')
    .delete()
    .eq('state', state)
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()
  if (consumeError) throw consumeError
  if (!pending) throw new Error('انتهت جلسة التفويض أو تم استخدامها، حاول مرة أخرى')

  const { data: workspace } = await admin.from('merchants')
    .select('is_active').eq('merchant_code', pending.merchant_code).eq('role', 'merchant').maybeSingle()
  if (!workspace || workspace.is_active === false) throw new Error('Merchant account is inactive')

  const tokenData = pending.platform === 'amazon' ? await exchangeAmazonCode(code) : await exchangeNoonCode(code)
  const sellerId = url.searchParams.get('selling_partner_id') || tokenData.seller_id || tokenData.account_id || null
  const secret = pending.platform === 'amazon'
    ? { refresh_token: tokenData.refresh_token }
    : { refresh_token: tokenData.refresh_token || null, access_token: tokenData.access_token, expires_in: tokenData.expires_in,
        token_expires_at: tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null }
  const secretBlob = await encryptCredentialPayload(secret)

  const { error: saveError } = await admin.from('platform_credentials').upsert({
    merchant_code: pending.merchant_code,
    platform: pending.platform,
    seller_id: sellerId,
    api_key: null,
    api_secret: null,
    extra: {
      secret_blob: secretBlob,
      auth_type: 'oauth',
      ...(pending.platform === 'amazon'
        ? { marketplace_id: 'A17E79C6D8DWNP', endpoint: 'https://sellingpartnerapi-eu.amazon.com' }
        : {}),
    },
    is_active: true,
    test_status: 'success',
    last_tested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'merchant_code,platform' })
  if (saveError) throw saveError
  return redirectResult('success', pending.platform)
}

function amazonAuthorizationUrl(state: string) {
  const applicationId = Deno.env.get('AMAZON_SPAPI_APPLICATION_ID')
  if (!applicationId) throw new Error('ربط Amazon غير مفعّل بعد: أضف AMAZON_SPAPI_APPLICATION_ID')
  const base = Deno.env.get('AMAZON_SELLER_CENTRAL_URL') || 'https://sellercentral.amazon.sa'
  const url = new URL('/apps/authorize/consent', base)
  url.searchParams.set('application_id', applicationId)
  url.searchParams.set('state', state)
  if (Deno.env.get('AMAZON_SPAPI_DRAFT') === 'true') url.searchParams.set('version', 'beta')
  return url.toString()
}

function amazonOAuthConfigured() {
  return Boolean(
    Deno.env.get('AMAZON_SPAPI_APPLICATION_ID') &&
    Deno.env.get('AMAZON_LWA_CLIENT_ID') &&
    Deno.env.get('AMAZON_LWA_CLIENT_SECRET')
  )
}

function noonAuthorizationUrl(state: string) {
  const authorizationUrl = Deno.env.get('NOON_OAUTH_AUTHORIZATION_URL')
  const clientId = Deno.env.get('NOON_OAUTH_CLIENT_ID')
  if (!authorizationUrl || !clientId) throw new Error('ربط نون غير مفعّل بعد: أضف إعدادات OAuth المعتمدة من نون')
  const url = new URL(authorizationUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', CALLBACK_URL)
  url.searchParams.set('state', state)
  const scope = Deno.env.get('NOON_OAUTH_SCOPE')
  if (scope) url.searchParams.set('scope', scope)
  return url.toString()
}

function noonOAuthConfigured() {
  return Boolean(
    Deno.env.get('NOON_OAUTH_AUTHORIZATION_URL') &&
    Deno.env.get('NOON_OAUTH_TOKEN_URL') &&
    Deno.env.get('NOON_OAUTH_CLIENT_ID') &&
    Deno.env.get('NOON_OAUTH_CLIENT_SECRET')
  )
}

async function exchangeAmazonCode(code: string) {
  const clientId = Deno.env.get('AMAZON_LWA_CLIENT_ID')
  const clientSecret = Deno.env.get('AMAZON_LWA_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('إعدادات Amazon LWA غير مكتملة')
  return exchangeToken('https://api.amazon.com/auth/o2/token', {
    grant_type: 'authorization_code', code, redirect_uri: CALLBACK_URL,
    client_id: clientId, client_secret: clientSecret,
  })
}

async function exchangeNoonCode(code: string) {
  const tokenUrl = Deno.env.get('NOON_OAUTH_TOKEN_URL')
  const clientId = Deno.env.get('NOON_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('NOON_OAUTH_CLIENT_SECRET')
  if (!tokenUrl || !clientId || !clientSecret) throw new Error('إعدادات OAuth الخاصة بنون غير مكتملة')
  return exchangeToken(tokenUrl, {
    grant_type: 'authorization_code', code, redirect_uri: CALLBACK_URL,
    client_id: clientId, client_secret: clientSecret,
  })
}

async function exchangeToken(url: string, body: Record<string, string>) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'فشل استبدال رمز التفويض')
  return data
}

function redirectResult(result: 'success' | 'error', detail: string) {
  const url = new URL('/integrations', APP_URL)
  url.searchParams.set('oauth', result)
  url.searchParams.set(result === 'success' ? 'platform' : 'message', detail)
  return Response.redirect(url.toString(), 302)
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}
