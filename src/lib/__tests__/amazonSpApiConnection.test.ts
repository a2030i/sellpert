import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
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
  type AmazonSpConfig,
} from '../../../supabase/functions/_shared/amazonSpApi'
import { readAmazonCallback } from '../amazonConnection'

const config: AmazonSpConfig = {
  appId: 'amzn1.sp.solution.test',
  clientId: 'amzn1.application-oa2-client.test',
  clientSecret: 'secret',
  redirectUri: 'https://app.sellpert.com/integrations/amazon/callback',
  draft: true,
}

function env(values: Record<string, string>) {
  return { get: (name: string) => values[name] }
}

describe('Amazon SP-API configuration', () => {
  it('is unavailable until the app id and LWA credentials are all configured', () => {
    expect(readAmazonSpConfig(env({}))).toBeNull()
    expect(readAmazonSpConfig(env({ AMAZON_SP_APP_ID: 'a', AMAZON_SP_LWA_CLIENT_ID: 'b' }))).toBeNull()
    expect(readAmazonSpConfig(env({ AMAZON_SP_APP_ID: 'a', AMAZON_SP_LWA_CLIENT_ID: 'b', AMAZON_SP_LWA_CLIENT_SECRET: 'c' })))
      .toMatchObject({ redirectUri: 'https://app.sellpert.com/integrations/amazon/callback', draft: true })
  })

  it('rejects a non-HTTPS redirect URI and leaves draft mode only when explicitly published', () => {
    const base = { AMAZON_SP_APP_ID: 'a', AMAZON_SP_LWA_CLIENT_ID: 'b', AMAZON_SP_LWA_CLIENT_SECRET: 'c' }
    expect(readAmazonSpConfig(env({ ...base, AMAZON_SP_REDIRECT_URI: 'http://app.sellpert.com/cb' }))).toBeNull()
    expect(readAmazonSpConfig(env({ ...base, AMAZON_SP_APP_DRAFT: 'false' }))?.draft).toBe(false)
  })
})

describe('Amazon OAuth state', () => {
  it('creates unguessable URL-safe states and stores only a hash', async () => {
    const first = createOAuthState()
    const second = createOAuthState()
    expect(first).not.toBe(second)
    expect(isWellFormedState(first)).toBe(true)
    const hash = await hashOAuthState(first)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(first)
  })

  it('validates Amazon callback parameters before they reach the token exchange', () => {
    expect(isWellFormedState('short')).toBe(false)
    expect(isWellFormedSellingPartnerId('A1B2C3D4E5F6G7')).toBe(true)
    expect(isWellFormedSellingPartnerId('a1;drop')).toBe(false)
    expect(isWellFormedOAuthCode('ANDbGzYpTqLQsCOVjHkCvFwR')).toBe(true)
    expect(isWellFormedOAuthCode('<script>')).toBe(false)
  })

  it('builds the Saudi Seller Central consent URL and marks draft apps as beta', () => {
    const url = new URL(buildConsentUrl(config, 'state-value'))
    expect(url.origin).toBe('https://sellercentral.amazon.sa')
    expect(url.pathname).toBe('/apps/authorize/consent')
    expect(url.searchParams.get('application_id')).toBe(config.appId)
    expect(url.searchParams.get('state')).toBe('state-value')
    expect(url.searchParams.get('version')).toBe('beta')
    expect(new URL(buildConsentUrl({ ...config, draft: false }, 's')).searchParams.has('version')).toBe(false)
    expect(() => buildConsentUrl(config, 's', 'ATVPDKIKX0DER')).toThrow()
  })
})

describe('Amazon provider calls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exchanges the code with the registered redirect URI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'Atza|a', refresh_token: 'Atzr|r' }), { status: 200 }))
    await expect(exchangeAuthorizationCode(config, 'code-123456', fetchMock)).resolves.toEqual({ accessToken: 'Atza|a', refreshToken: 'Atzr|r' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.amazon.com/auth/o2/token')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('redirect_uri')).toBe(config.redirectUri)
  })

  it('does not echo provider error bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'secret-echo' }), { status: 400 }))
    await expect(exchangeAuthorizationCode(config, 'code-123456', fetchMock)).rejects.toMatchObject({ status: 400, message: 'Amazon authorization code exchange failed' })
  })

  it('verifies the seller through marketplace participations and keeps supported markets only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: [
      { marketplace: { id: 'A17E79C6D8DWNP', countryCode: 'SA', name: 'Amazon.sa' }, participation: { isParticipating: true } },
      { marketplace: { id: 'A2VIGQ35RCS4UG', countryCode: 'AE', name: 'Amazon.ae' }, participation: { isParticipating: false } },
      { marketplace: { id: 'A1RKKUPIHCS9HS', countryCode: 'ES', name: 'Amazon.es' }, participation: { isParticipating: true } },
    ] }), { status: 200 }))
    const rows = await fetchMarketplaceParticipations('Atza|a', 'eu', fetchMock)
    expect(fetchMock.mock.calls[0][0]).toBe('https://sellingpartnerapi-eu.amazon.com/sellers/v1/marketplaceParticipations')
    expect(fetchMock.mock.calls[0][1].headers['x-amz-access-token']).toBe('Atza|a')
    expect(supportedParticipations(rows).map(row => row.marketplaceId)).toEqual(['A17E79C6D8DWNP'])
  })
})

describe('Amazon redirect page', () => {
  it('only reads parameters on the registered callback path', () => {
    expect(readAmazonCallback('/integrations', '?state=a&selling_partner_id=b&spapi_oauth_code=c')).toBeNull()
    expect(readAmazonCallback('/integrations/amazon/callback', '?state=a')).toBe('incomplete')
    expect(readAmazonCallback('/integrations/amazon/callback/', '?state=a&selling_partner_id=b&spapi_oauth_code=c'))
      .toEqual({ state: 'a', selling_partner_id: 'b', spapi_oauth_code: 'c' })
  })
})

describe('amazon-connect security contract', () => {
  const source = readFileSync('supabase/functions/amazon-connect/index.ts', 'utf8')
  const migration = readFileSync('supabase/migrations/20261126120000_amazon_sp_api_connection.sql', 'utf8')

  it('consumes a state only for the same user, workspace, unexpired and unused', () => {
    expect(source).toContain(".eq('user_id', userId)")
    expect(source).toContain(".eq('merchant_code', merchantCode)")
    expect(source).toContain(".is('consumed_at', null)")
    expect(source).toContain(".gt('expires_at'")
  })

  it('never returns the refresh token and stores it encrypted', () => {
    expect(source).toContain('encryptCredentialPayload({ refresh_token: tokens.refreshToken })')
    expect(source).not.toMatch(/json\([^)]*refresh/i)
    expect(source).not.toContain('restrictedDataToken')
  })

  it('rejects the service key as a browser caller', () => {
    expect(source).toContain('token === SERVICE_KEY')
  })

  it('keeps OAuth states server-only and Amazon out of automatic sync', () => {
    expect(migration).toContain('revoke all on table public.amazon_oauth_states from public, anon, authenticated')
    expect(migration).toContain('using (false)')
    expect(migration).not.toMatch(/enqueue_active_marketplace_syncs/)
    expect(migration).not.toMatch(/insert into public\.orders/i)
  })
})
