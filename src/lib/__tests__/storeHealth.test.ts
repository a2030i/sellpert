import { describe, expect, it } from 'vitest'
import { buildStoreHealth, friendlyOperationError } from '../storeHealth'

const now = Date.parse('2026-08-03T12:00:00Z')

describe('buildStoreHealth', () => {
  it('asks for setup when no source exists', () => {
    expect(buildStoreHealth({ credentials: [], logs: [], jobs: [], uploads: [], now }).level).toBe('setup')
  })

  it('reports healthy data when the latest sync succeeded', () => {
    const result = buildStoreHealth({
      credentials: [{ platform: 'trendyol', is_active: true, test_status: 'success', last_sync_at: '2026-08-03T11:00:00Z' }],
      logs: [{ id: '1', platform: 'trendyol', status: 'success', started_at: '2026-08-03T10:50:00Z', finished_at: '2026-08-03T11:00:00Z' }],
      jobs: [], uploads: [], now,
    })
    expect(result.level).toBe('healthy')
    expect(result.activeSources).toBe(1)
    expect(result.lastSuccessfulAt).toBe('2026-08-03T11:00:00Z')
  })

  it('does not tell the merchant to click again for a long-running job', () => {
    const result = buildStoreHealth({
      credentials: [], logs: [], uploads: [{ id: 'u1', platform: 'amazon', status: 'success', uploaded_at: '2026-08-03T09:00:00Z' }],
      jobs: [{ id: 4, platform: 'amazon', status: 'processing', created_at: '2026-08-03T10:00:00Z' }], now,
    })
    expect(result.level).toBe('attention')
    expect(result.issues[0].description).toContain('لا تحتاج إلى الضغط مرة أخرى')
  })

  it('turns technical authentication failures into a merchant action', () => {
    const result = buildStoreHealth({
      credentials: [{ platform: 'trendyol', is_active: true, test_status: 'success', last_sync_at: '2026-08-03T11:00:00Z' }],
      logs: [{ id: '2', platform: 'trendyol', status: 'error', started_at: '2026-08-03T11:30:00Z', error_message: 'HTTP 401 TrendyolAuthenticationException' }],
      jobs: [], uploads: [], now,
    })
    expect(result.level).toBe('action')
    expect(result.issues[0].description).toContain('بيانات الربط')
    expect(result.issues[0].description).not.toContain('401')
  })

  it('does not keep an old failed queue job after a newer success', () => {
    const result = buildStoreHealth({
      credentials: [], logs: [],
      uploads: [{ id: 'u2', platform: 'noon', status: 'success', uploaded_at: '2026-08-03T11:00:00Z' }],
      jobs: [
        { id: 1, platform: 'noon', status: 'failed', created_at: '2026-08-01T09:00:00Z', finished_at: '2026-08-01T09:05:00Z' },
        { id: 2, platform: 'noon', status: 'success', created_at: '2026-08-03T10:00:00Z', finished_at: '2026-08-03T10:05:00Z' },
      ], now,
    })
    expect(result.level).toBe('healthy')
  })
})

describe('friendlyOperationError', () => {
  it('does not expose internal database policy errors', () => {
    expect(friendlyOperationError('new row violates row-level security policy')).not.toContain('row-level')
  })
})
