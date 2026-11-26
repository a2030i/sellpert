/**
 * amazon-connect
 * ─────────────────────────────────────────────────────────────────────────────
 * Amazon SP-API website authorization workflow for a signed-in Sellpert user.
 *
 *   status      → safe connection metadata for the merchant workspace
 *   start       → single-use state + Seller Central consent URL
 *   complete    → called by the SPA redirect page with Amazon's callback
 *                 parameters; verifies the state belongs to this caller and
 *                 workspace, exchanges the code, verifies the seller, stores
 *                 the refresh token encrypted
 *   disconnect  → removes the stored credential
 *
 * The refresh token never leaves the server. Only non-PII roles are used.
 * This function does not sync orders or financial data.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { encryptCredentialPayload } from '../_shared/credentialVault.ts'
import { HttpError, json } from '../_shared/sync.ts'
import {
  AMAZON_MARKETPLACES,
  AMAZON_STATE_TTL_MINUTES,
  DEFAULT_AMAZON_MARKETPLACE,
  buildConsentUrl,
  createOAuthState,
  exchangeAuthorizationCode,
  fetchMarketplaceParticipations,
  hashOAuthState,
  isWellFormedOAuthCode,
  isWellFormedSellingPartnerId,
  isWellFormedState,
  readAmazonSpConfig,
  supportedParticipations,
} from '../_shared/amazonSpApi.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    if (!token || token === SERVICE_KEY) throw new HttpError(401, 'Unauthorized')
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) throw new HttpError(401, 'Unauthorized')
    const { data: caller } = await admin.from('merchants')
      .select('merchant_code,owner_merchant_code,permissions,role,is_active')
      .eq('id', user.id).maybeSingle()
    if (!caller || caller.is_active === false) throw new HttpError(403, 'Forbidden')

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'status')
    const merchantCode = await authorizeMerchantScope(admin, caller, user.id, body?.merchant_code)

    if (action === 'status') return json(await connectionStatus(admin, merchantCode), 200, corsHeaders)
    if (action === 'start') return json(await startAuthorization(admin, merchantCode, user.id, body?.marketplace_id), 200, corsHeaders)
    if (action === 'complete') return json(await completeAuthorization(admin, merchantCode, user.id, body), 200, corsHeaders)
    if (action === 'disconnect') return json(await disconnect(admin, merchantCode), 200, corsHeaders)
    throw new HttpError(400, 'Unsupported action')
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) console.error('[amazon-connect] unexpected failure:', error?.name || 'Error')
    return json({ error: status === 500 ? 'Unexpected error' : error.message }, status, corsHeaders)
  }
})

async function connectionStatus(admin: any, merchantCode: string) {
  const config = readAmazonSpConfig(Deno.env)
  const { data, error } = await admin.from('platform_credentials')
    .select('seller_id,is_active,test_status,last_tested_at,last_sync_at,created_at,updated_at,extra')
    .eq('merchant_code', merchantCode).eq('platform', 'amazon').maybeSingle()
  if (error) throw error
  return {
    app_configured: Boolean(config),
    connection: data ? {
      seller_id: data.seller_id,
      is_active: data.is_active,
      test_status: data.test_status,
      last_tested_at: data.last_tested_at,
      last_sync_at: data.last_sync_at,
      connected_at: data.extra?.connected_at || data.created_at,
      marketplaces: Array.isArray(data.extra?.marketplaces) ? data.extra.marketplaces : [],
    } : null,
  }
}

async function startAuthorization(admin: any, merchantCode: string, userId: string, requestedMarketplace: unknown) {
  const config = readAmazonSpConfig(Deno.env)
  if (!config) throw new HttpError(503, 'ربط أمازون غير مهيأ بعد على الخادم')
  const marketplaceId = String(requestedMarketplace || DEFAULT_AMAZON_MARKETPLACE)
  if (!AMAZON_MARKETPLACES[marketplaceId]) throw new HttpError(400, 'سوق أمازون غير مدعوم')

  // Housekeeping: expired or used states have no further purpose.
  await admin.from('amazon_oauth_states').delete().lt('expires_at', new Date().toISOString())
  await admin.from('amazon_oauth_states').delete().eq('user_id', userId).not('consumed_at', 'is', null)

  const state = createOAuthState()
  const now = new Date()
  const { error } = await admin.from('amazon_oauth_states').insert({
    state_hash: await hashOAuthState(state),
    merchant_code: merchantCode,
    user_id: userId,
    marketplace_id: marketplaceId,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + AMAZON_STATE_TTL_MINUTES * 60_000).toISOString(),
  })
  if (error) throw error
  return { ok: true, consent_url: buildConsentUrl(config, state, marketplaceId) }
}

async function completeAuthorization(admin: any, merchantCode: string, userId: string, body: any) {
  const config = readAmazonSpConfig(Deno.env)
  if (!config) throw new HttpError(503, 'ربط أمازون غير مهيأ بعد على الخادم')
  const state = body?.state
  const sellingPartnerId = body?.selling_partner_id
  const code = body?.spapi_oauth_code
  if (!isWellFormedState(state)) throw new HttpError(400, 'رابط الربط غير صالح، ابدأ الربط من جديد')
  if (!isWellFormedSellingPartnerId(sellingPartnerId) || !isWellFormedOAuthCode(code)) {
    throw new HttpError(400, 'بيانات أمازون غير مكتملة، ابدأ الربط من جديد')
  }

  // Consume the state atomically: it must exist, belong to this caller and
  // workspace, be unexpired and unused. A second request gets no row.
  const { data: consumed, error: consumeError } = await admin.from('amazon_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state_hash', await hashOAuthState(state))
    .eq('user_id', userId)
    .eq('merchant_code', merchantCode)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('marketplace_id')
    .maybeSingle()
  if (consumeError) throw consumeError
  if (!consumed) throw new HttpError(400, 'انتهت صلاحية طلب الربط أو استُخدم من قبل، ابدأ الربط من جديد')

  const tokens = await exchangeAuthorizationCode(config, code)
  const region = AMAZON_MARKETPLACES[consumed.marketplace_id]?.region || 'eu'
  const participations = supportedParticipations(await fetchMarketplaceParticipations(tokens.accessToken, region))
  if (!participations.length) {
    throw new HttpError(409, 'حساب أمازون هذا لا يبيع في سوق تدعمه سيلبرت (السعودية أو الإمارات أو مصر)')
  }

  const { data: duplicate, error: duplicateError } = await admin.from('platform_credentials')
    .select('merchant_code').eq('platform', 'amazon').eq('seller_id', sellingPartnerId)
    .neq('merchant_code', merchantCode).eq('is_active', true).limit(1).maybeSingle()
  if (duplicateError) throw duplicateError
  if (duplicate) throw new HttpError(409, 'حساب أمازون هذا مرتبط بمساحة عمل أخرى')

  const now = new Date().toISOString()
  const marketplaces = participations.map(row => ({ id: row.marketplaceId, country: row.countryCode, name: row.name }))
  const { error } = await admin.from('platform_credentials').upsert({
    merchant_code: merchantCode,
    platform: 'amazon',
    seller_id: sellingPartnerId,
    api_key: null,
    api_secret: null,
    extra: {
      secret_blob: await encryptCredentialPayload({ refresh_token: tokens.refreshToken }),
      region,
      marketplaces,
      connected_at: now,
      connected_by: userId,
    },
    is_active: true,
    test_status: 'success',
    last_tested_at: now,
    updated_at: now,
  }, { onConflict: 'merchant_code,platform' })
  if (error) throw error
  return { ok: true, seller_id: sellingPartnerId, marketplaces }
}

async function disconnect(admin: any, merchantCode: string) {
  const { error } = await admin.from('platform_credentials').delete()
    .eq('merchant_code', merchantCode).eq('platform', 'amazon')
  if (error) throw error
  return { ok: true }
}

// Same workspace rules as manage-platform-credentials.
async function authorizeMerchantScope(admin: any, caller: any, userId: string, requestedCode: unknown): Promise<string> {
  const requested = clean(requestedCode)
  if (['admin', 'super_admin'].includes(caller.role)) {
    if (!requested) throw new HttpError(400, 'merchant_code is required')
    await requireActiveWorkspace(admin, requested)
    return requested
  }
  if (caller.role === 'merchant' && caller.merchant_code) {
    if (!requested || requested === caller.merchant_code) {
      await requireActiveWorkspace(admin, caller.merchant_code)
      return caller.merchant_code
    }
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

function clean(value: unknown) { return String(value || '').trim() }
