// Amazon Selling Partner API (SP-API) authorization helpers.
//
// Sellpert uses the website authorization workflow: a signed-in Sellpert user
// starts the flow, Amazon shows the seller its consent page, and Amazon sends
// the seller back to the registered redirect URI with `state`,
// `selling_partner_id` and `spapi_oauth_code`. The code is exchanged with
// Login with Amazon (LWA) for a refresh token, which is stored encrypted.
//
// Only non-PII roles are registered for the Sellpert app. Nothing in this file
// requests a Restricted Data Token.

import { HttpError } from './sync.ts'

export const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

// Amazon.sa and the other Middle East / Europe marketplaces are served by the
// EU SP-API endpoint.
export const AMAZON_SP_REGIONS = {
  eu: 'https://sellingpartnerapi-eu.amazon.com',
} as const
export type AmazonSpRegion = keyof typeof AMAZON_SP_REGIONS

export const AMAZON_MARKETPLACES: Record<string, { country: string; sellerCentral: string; region: AmazonSpRegion }> = {
  A17E79C6D8DWNP: { country: 'SA', sellerCentral: 'https://sellercentral.amazon.sa', region: 'eu' },
  A2VIGQ35RCS4UG: { country: 'AE', sellerCentral: 'https://sellercentral.amazon.ae', region: 'eu' },
  ARBP9OOSHTCHU: { country: 'EG', sellerCentral: 'https://sellercentral.amazon.eg', region: 'eu' },
}
export const DEFAULT_AMAZON_MARKETPLACE = 'A17E79C6D8DWNP'

export const AMAZON_STATE_TTL_MINUTES = 10

export type AmazonSpConfig = {
  appId: string
  clientId: string
  clientSecret: string
  redirectUri: string
  draft: boolean
}

type Env = { get(name: string): string | undefined }

/** Reads the app configuration. Returns null when any required value is missing. */
export function readAmazonSpConfig(env: Env): AmazonSpConfig | null {
  const appId = clean(env.get('AMAZON_SP_APP_ID'))
  const clientId = clean(env.get('AMAZON_SP_LWA_CLIENT_ID'))
  const clientSecret = clean(env.get('AMAZON_SP_LWA_CLIENT_SECRET'))
  const redirectUri = clean(env.get('AMAZON_SP_REDIRECT_URI')) || 'https://app.sellpert.com/integrations/amazon/callback'
  if (!appId || !clientId || !clientSecret) return null
  if (!/^https:\/\//.test(redirectUri)) return null
  // Draft apps can only be authorized with version=beta. Keep draft mode on
  // until the app is published, then set AMAZON_SP_APP_DRAFT=false.
  const draft = clean(env.get('AMAZON_SP_APP_DRAFT')).toLowerCase() !== 'false'
  return { appId, clientId, clientSecret, redirectUri, draft }
}

/** A URL-safe random state value (256 bits). */
export function createOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64Url(bytes)
}

/** Only the SHA-256 hash of the state is stored server-side. */
export async function hashOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function isWellFormedState(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

export function isWellFormedSellingPartnerId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{8,20}$/.test(value)
}

export function isWellFormedOAuthCode(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 512 && /^[A-Za-z0-9._~+/=-]+$/.test(value)
}

export function buildConsentUrl(config: AmazonSpConfig, state: string, marketplaceId = DEFAULT_AMAZON_MARKETPLACE) {
  const marketplace = AMAZON_MARKETPLACES[marketplaceId]
  if (!marketplace) throw new HttpError(400, 'Unsupported Amazon marketplace')
  const url = new URL('/apps/authorize/consent', marketplace.sellerCentral)
  url.searchParams.set('application_id', config.appId)
  url.searchParams.set('state', state)
  if (config.draft) url.searchParams.set('version', 'beta')
  return url.toString()
}

type Fetch = typeof fetch

export async function exchangeAuthorizationCode(config: AmazonSpConfig, code: string, fetchImpl: Fetch = fetch) {
  const response = await fetchImpl(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  })
  const body = await response.json().catch(() => ({}))
  // Never include provider bodies in errors: they can echo request material.
  if (!response.ok || typeof body?.refresh_token !== 'string' || typeof body?.access_token !== 'string') {
    throw new HttpError(response.status === 400 ? 400 : 502, 'Amazon authorization code exchange failed')
  }
  return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string }
}

export async function refreshAccessToken(config: AmazonSpConfig, refreshToken: string, fetchImpl: Fetch = fetch) {
  const response = await fetchImpl(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body?.access_token !== 'string') {
    throw new HttpError(response.status === 400 || response.status === 401 ? 401 : 502, 'Amazon access token refresh failed')
  }
  return { accessToken: body.access_token as string, expiresIn: Number(body.expires_in) || 3600 }
}

export function spApiHeaders(accessToken: string, now = new Date()) {
  return {
    'x-amz-access-token': accessToken,
    'x-amz-date': now.toISOString().replace(/[:-]|\.\d{3}/g, ''),
    'user-agent': 'Sellpert/2.0 (Language=Deno; Platform=SupabaseEdge)',
    Accept: 'application/json',
  }
}

export type AmazonParticipation = { marketplaceId: string; countryCode: string; name: string; isParticipating: boolean }

/** Verifies the token by reading the seller's marketplace participations (Sellers API). */
export async function fetchMarketplaceParticipations(
  accessToken: string,
  region: AmazonSpRegion = 'eu',
  fetchImpl: Fetch = fetch,
): Promise<AmazonParticipation[]> {
  const response = await fetchImpl(`${AMAZON_SP_REGIONS[region]}/sellers/v1/marketplaceParticipations`, {
    headers: spApiHeaders(accessToken),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new HttpError(response.status === 403 ? 403 : 502, 'Amazon seller verification failed')
  const rows: any[] = Array.isArray(body?.payload) ? body.payload : []
  return rows
    .map(row => ({
      marketplaceId: String(row?.marketplace?.id || ''),
      countryCode: String(row?.marketplace?.countryCode || ''),
      name: String(row?.marketplace?.name || ''),
      isParticipating: row?.participation?.isParticipating === true,
    }))
    .filter(row => row.marketplaceId)
}

/** Marketplaces Sellpert supports that the seller actively participates in. */
export function supportedParticipations(rows: AmazonParticipation[]) {
  return rows.filter(row => row.isParticipating && AMAZON_MARKETPLACES[row.marketplaceId])
}

/**
 * Confirm the token can access the supplied seller's own listings route.
 * Requires Product Listing or Inventory and Order Tracking. Empty listings
 * are valid; the authorization check does not require an existing SKU.
 * Listing data is discarded and must never be returned or persisted here.
 */
export async function verifyAmazonSellerIdentity(
  accessToken: string,
  sellerId: string,
  marketplaceId: string,
  region: AmazonSpRegion = 'eu',
  fetchImpl: Fetch = fetch,
): Promise<void> {
  const url = new URL(`${AMAZON_SP_REGIONS[region]}/listings/2021-08-01/items/${encodeURIComponent(sellerId)}`)
  url.searchParams.set('marketplaceIds', marketplaceId)
  url.searchParams.set('pageSize', '1')
  url.searchParams.set('includedData', 'summaries')
  let response: Response
  try {
    response = await fetchImpl(url.toString(), {
      headers: spApiHeaders(accessToken),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new HttpError(502, 'Amazon seller identity verification failed')
  }
  // Do not echo provider errors: even error bodies may contain request material.
  if (response.status !== 200) {
    throw new HttpError(response.status === 403 ? 403 : 502, 'Amazon seller identity verification failed')
  }
  const body = await response.json().catch(() => null)
  if (!body || !Number.isInteger(body.numberOfResults) || body.numberOfResults < 0
    || !Array.isArray(body.items) || body.items.length > 1
    || body.numberOfResults < body.items.length
    || !body.items.every((item: any) => item && typeof item.sku === 'string' && item.sku.length > 0)) {
    throw new HttpError(502, 'Amazon seller identity verification failed')
  }
}

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
