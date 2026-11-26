import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadAmazonCaller } from '../../../supabase/functions/_shared/amazonActor'

const actor = {
  merchant_code: 'test-workspace',
  owner_merchant_code: null,
  permissions: {},
  role: 'merchant',
  is_active: true,
}

function harness(rows: unknown, status = 200) {
  // Mock the RLS-filtered Data API result, while using the real client transport.
  // Actual MFA policy enforcement still needs isolated SQL or deployed checks.
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(rows), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
  const factory = (url: string, key: string, options: Parameters<typeof createClient>[2]) =>
    createClient(url, key, {
      ...options,
      global: { ...options?.global, fetch: fetchMock },
    })
  return {
    fetchMock,
    load: (token = 'verified-user-session') => loadAmazonCaller(
      factory, 'https://example.supabase.co', 'test-server-api-key', token, 'verified-user-id',
    ),
  }
}

describe('Amazon actor access through user-context RLS', () => {
  it('sends the verified user bearer instead of the service key and scopes the actor by id', async () => {
    const { load, fetchMock } = harness([actor])
    await expect(load()).resolves.toEqual(actor)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer verified-user-session')
    expect(headers.get('apikey')).toBe('test-server-api-key')
    expect(new URL(url).pathname).toBe('/rest/v1/merchants')
    expect(new URL(url).searchParams.get('id')).toBe('eq.verified-user-id')
  })

  it('rejects an actor hidden by RLS, including an enrolled user with an AAL1 session', async () => {
    const { load, fetchMock } = harness([])
    await expect(load('verified-aal1-session')).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['verified-aal2-session', 'verified-unenrolled-session'])(
    'allows an active actor returned by RLS for %s', async token => {
      await expect(harness([actor]).load(token)).resolves.toEqual(actor)
    },
  )

  it('fails closed on a database denial without retrying as service role', async () => {
    const { load, fetchMock } = harness({ code: '42501', message: 'permission denied' }, 403)
    await expect(load()).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects inactive actors even when a row is returned', async () => {
    await expect(harness([{ ...actor, is_active: false }]).load()).rejects.toMatchObject({ status: 403 })
  })
})
