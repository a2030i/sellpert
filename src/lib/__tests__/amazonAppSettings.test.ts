import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AMAZON_APP_REDIRECT_URI, loadAmazonAppSettings, saveAmazonAppSettings } from '../amazonAppSettings'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { auth: { getSession } } }))

const safe = {
  configured: true,
  fields: { appId: true, clientId: true, clientSecret: true },
  redirectUri: AMAZON_APP_REDIRECT_URI,
  draft: true,
}
const values = { appId: 'test-app-id', clientId: 'test-client-id', clientSecret: 'test-client-secret' }

describe('Amazon app settings browser boundary', () => {
  beforeEach(() => { getSession.mockResolvedValue({ data: { session: { access_token: 'test-user-session' } } }) })
  afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

  it('loads only configured flags and strips unexpected secret properties', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...safe, clientSecret: 'never-display-this' })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadAmazonAppSettings()).resolves.toEqual(safe)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ action: 'amazon_status' })
    expect(init.headers.Authorization).toBe('Bearer test-user-session')
  })

  it('saves all three values together and returns only safe status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...safe, ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(saveAmazonAppSettings(values)).resolves.toEqual(safe)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'save_amazon_config', ...values })
  })

  it('does not send an incomplete credential set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(saveAmazonAppSettings({ ...values, clientSecret: ' ' })).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a signed-in session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadAmazonAppSettings()).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([400, 403, 500])('does not echo submitted values from an HTTP %i error', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: values.clientSecret }), { status })))
    await expect(saveAmazonAppSettings(values)).rejects.not.toThrow(values.clientSecret)
  })

  it('rejects malformed configuration status instead of implying readiness', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true }))))
    await expect(loadAmazonAppSettings()).rejects.toThrow('تعذر التحقق')
  })

  it('preserves the explicit repair signal without exposing unreadable configuration', async () => {
    const invalid = { ...safe, configured: false, fields: { appId: false, clientId: false, clientSecret: false }, needsReplacement: true }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid))))
    await expect(loadAmazonAppSettings()).resolves.toEqual(invalid)
  })

  it('rejects an unexpected callback or publishing mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...safe, draft: false }))))
    await expect(loadAmazonAppSettings()).rejects.toThrow('تعذر التحقق')
  })
})
