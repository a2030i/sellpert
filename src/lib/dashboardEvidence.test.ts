import { describe, expect, it } from 'vitest'
import { dashboardEvidenceState } from './dashboardEvidence'

describe('dashboardEvidenceState', () => {
  it('reports fresh evidence only when every dated source is recent', () => {
    expect(dashboardEvidenceState([
      { key: 'brief', label: 'الملخص التنفيذي', ageDays: 1 },
      { key: 'inventory', label: 'المخزون', ageDays: 2 },
    ], false)).toMatchObject({ status: 'current', oldestAgeDays: 2 })
  })

  it('names stale sources and uses the oldest evidence age', () => {
    const result = dashboardEvidenceState([
      { key: 'brief', label: 'الملخص التنفيذي', ageDays: 1 },
      { key: 'inventory', label: 'المخزون', ageDays: 6 },
    ], false)

    expect(result.status).toBe('stale')
    expect(result.detail).toContain('المخزون')
    expect(result.oldestAgeDays).toBe(6)
  })

  it('does not present partial or undated evidence as current', () => {
    expect(dashboardEvidenceState([], false).status).toBe('unknown')
    expect(dashboardEvidenceState([
      { key: 'brief', label: 'الملخص التنفيذي', ageDays: 0 },
    ], true).status).toBe('partial')
  })
})
