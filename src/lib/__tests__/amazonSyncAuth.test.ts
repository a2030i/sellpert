import { describe, expect, it, vi } from 'vitest'
import { authorizeAmazonSync } from '../../../supabase/functions/_shared/amazonSyncAuth'

const actor = { role: 'merchant', merchant_code: 'M-TEST', is_active: true }

function harness(visible = true, validUser = true) {
  const userRead = vi.fn(async () => ({ data: visible ? actor : null, error: null }))
  const factory = vi.fn(() => ({ from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: userRead }
    return query
  } }))
  const adminRead = vi.fn(() => {
    const filters: Record<string, unknown> = {}
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query },
      maybeSingle: async () => ({ data: filters.id ? actor : { is_active: true, workspace_status: 'active' }, error: null }),
    }
    return query
  })
  const getUser = vi.fn(async () => ({ data: { user: validUser ? { id: 'test-user' } : null }, error: null }))
  const authorize = (token: string) => authorizeAmazonSync(
    new Request('https://test.invalid', { headers: { Authorization: `Bearer ${token}` } }),
    { auth: { getUser }, from: adminRead }, 'test-service', 'https://test.invalid', factory, 'M-TEST',
  )
  return { authorize, factory, adminRead, getUser }
}

describe('Amazon synchronization actor gate', () => {
  it('rejects an enrolled AAL1 actor hidden by RLS before privileged database reads', async () => {
    const h = harness(false)
    await expect(h.authorize('verified-aal1')).rejects.toMatchObject({ status: 403 })
    expect(h.adminRead).not.toHaveBeenCalled()
    expect(h.factory.mock.calls[0]).toEqual([
      'https://test.invalid', 'test-service', expect.objectContaining({
        global: { headers: { Authorization: 'Bearer verified-aal1' } },
      }),
    ])
  })

  it.each(['verified-aal2', 'verified-unenrolled'])(
    'authorizes %s only after its RLS actor read', async token => {
      const h = harness()
      await expect(h.authorize(token)).resolves.toMatchObject({ kind: 'merchant' })
      expect(h.factory).toHaveBeenCalledOnce()
      expect(h.adminRead).toHaveBeenCalled()
    },
  )

  it('rejects an invalid bearer before the actor or service database read', async () => {
    const h = harness(true, false)
    await expect(h.authorize('invalid')).rejects.toMatchObject({ status: 401 })
    expect(h.factory).not.toHaveBeenCalled()
    expect(h.adminRead).not.toHaveBeenCalled()
  })

  it('preserves internal queue authorization and its active workspace check', async () => {
    const h = harness(false)
    await expect(h.authorize('test-service')).resolves.toMatchObject({ kind: 'service' })
    expect(h.getUser).not.toHaveBeenCalled()
    expect(h.factory).not.toHaveBeenCalled()
    expect(h.adminRead).toHaveBeenCalledOnce()
  })
})
