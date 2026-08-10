import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ensureTrendyolWebhook,
  trendyolHeaders,
  verifyTrendyolCredentials,
} from '../../../supabase/functions/_shared/trendyolConnection'

describe('Trendyol connection security boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the required Saudi storefront and stable integrator identity', () => {
    expect(trendyolHeaders('1148158', 'key', 'secret')).toMatchObject({
      Authorization: `Basic ${btoa('key:secret')}`,
      'User-Agent': '1148158 - Sellpert',
      storeFrontCode: 'SA',
      Accept: 'application/json',
    })
  })

  it('rejects provider authentication failure instead of activating the account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ exception: 'ClientApiAuthenticationException' }),
      { status: 401 },
    )))
    await expect(verifyTrendyolCredentials('1148158', 'bad', 'bad')).rejects.toMatchObject({ status: 401 })
  })

  it('registers an API-key webhook when no matching webhook exists', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'hook-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(ensureTrendyolWebhook(
      '1148158', 'key', 'secret', 'webhook-secret',
      'https://example.supabase.co/functions/v1/trendyol-webhook',
    )).resolves.toMatchObject({ created: true, id: 'hook-1' })

    const createRequest = fetchMock.mock.calls[1][1]
    expect(JSON.parse(String(createRequest.body))).toMatchObject({
      authenticationType: 'API_KEY',
      apiKey: 'webhook-secret',
      subscribedStatuses: [],
    })
  })

  it('does not trust a browser supplied verified flag', () => {
    const source = readFileSync('supabase/functions/manage-platform-credentials/index.ts', 'utf8')
    expect(source).not.toContain("is_active: body?.verified === true")
    expect(source).toContain('await verifyTrendyolCredentials(')
  })
})
