import { describe, expect, it } from 'vitest'
import { UPLOAD_STALLED_AFTER_MS, isStalledUpload, uploadDisplayStatus } from '../uploadStatus'

const NOW = Date.parse('2026-08-02T12:00:00.000Z')

describe('uploadDisplayStatus', () => {
  it('groups equivalent terminal statuses', () => {
    expect(uploadDisplayStatus('completed', null, NOW)).toBe('success')
    expect(uploadDisplayStatus('error', null, NOW)).toBe('failed')
    expect(uploadDisplayStatus('partial', null, NOW)).toBe('partial')
  })

  it('marks old active uploads as stalled', () => {
    const oldUpload = new Date(NOW - UPLOAD_STALLED_AFTER_MS).toISOString()
    expect(isStalledUpload('processing', oldUpload, NOW)).toBe(true)
    expect(uploadDisplayStatus('running', oldUpload, NOW)).toBe('stalled')
  })

  it('keeps recent uploads processing', () => {
    const recentUpload = new Date(NOW - UPLOAD_STALLED_AFTER_MS + 1).toISOString()
    expect(uploadDisplayStatus('processing', recentUpload, NOW)).toBe('processing')
  })
})
