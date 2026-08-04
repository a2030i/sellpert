import { describe, expect, it } from 'vitest'
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITIES, activitySummary, parseActivityResponse, type ActivityEntry } from '../activityFeed'

function entry(partial: Partial<ActivityEntry> = {}): ActivityEntry {
  return { id: '1', merchant_code: 'M-1', action: 'update', entity: 'platform_credentials', actor: 'owner@test.invalid', occurred_at: '2026-08-03T12:00:00Z', changed_fields_count: 2, ...partial }
}

describe('merchant activity presentation', () => {
  it('describes a change without values or technical field names', () => {
    const summary = activitySummary(entry())
    expect(summary).toBe('تم تحديث ٢ حقول')
    expect(summary).not.toContain('api')
  })

  it('uses merchant-facing labels for sensitive entities', () => {
    expect(ACTIVITY_ENTITIES.platform_credentials).toBe('ربط منصات البيع')
    expect(ACTIVITY_ACTIONS.delete).toBe('حذف')
  })

  it('describes account lifecycle actions clearly', () => {
    expect(activitySummary(entry({ action: 'account_closure_requested', changed_fields_count: 0 }))).toBe('طلب إغلاق الحساب')
  })

  it('rejects malformed service responses before they can crash the page', () => {
    expect(() => parseActivityResponse({}, 1, 30)).toThrow('تعذر قراءة سجل النشاط')
    expect(parseActivityResponse({ entries: [], total: 0 }, 2, 15)).toEqual({
      page: 2, limit: 15, total: 0, scope: 'merchant', entries: [],
    })
  })
})
