import { describe, expect, it, vi } from 'vitest'
import { createMonitoredFetch } from '../apiMonitoring'

describe('central API monitoring', () => {
  it('reports server failures without copying response bodies or URLs', async () => {
    const emit = vi.fn()
    const monitored = createMonitoredFetch(vi.fn(async () => new Response('private details', { status: 503 })) as typeof fetch, emit)
    const response = await monitored('https://example.test/rest/v1/orders?customer=private')

    expect(response.status).toBe(503)
    expect(emit).toHaveBeenCalledWith({
      category: 'api', severity: 'error', component: 'api', action: 'load', errorCode: 'api_failure', httpStatus: 503,
    })
    expect(JSON.stringify(emit.mock.calls)).not.toContain('customer')
    expect(JSON.stringify(emit.mock.calls)).not.toContain('private details')
  })

  it('reports network failures and preserves the original rejection', async () => {
    const emit = vi.fn()
    const failure = new TypeError('Failed to fetch a sensitive URL')
    const monitored = createMonitoredFetch(vi.fn(async () => { throw failure }) as typeof fetch, emit)

    await expect(monitored('https://secret.example/token', { method: 'POST' })).rejects.toBe(failure)
    expect(emit).toHaveBeenCalledWith({
      category: 'network', severity: 'error', component: 'api', action: 'save', errorCode: 'network_failure',
    })
  })

  it('does not report successful or expected client responses', async () => {
    const emit = vi.fn()
    const monitored = createMonitoredFetch(vi.fn(async () => new Response('{}', { status: 401 })) as typeof fetch, emit)
    await monitored('https://example.test/auth/v1/user')
    expect(emit).not.toHaveBeenCalled()
  })
})
