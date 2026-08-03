import { describe, expect, it } from 'vitest'
import { describeBrowser, summarizeCurrentSession } from '../accountSecurity'

function token(payload: Record<string, unknown>) {
  return `x.${btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.x`
}

describe('session security helpers', () => {
  it('summarizes the current session without exposing the token', () => {
    const session = {
      access_token: token({ session_id: 'session-123', aal: 'aal2' }), expires_at: 2_000_000_000,
      user: { last_sign_in_at: '2026-08-03T09:00:00Z', app_metadata: {} },
    } as any
    expect(summarizeCurrentSession(session)).toEqual({
      sessionId: 'session-123', signedInAt: '2026-08-03T09:00:00Z',
      expiresAt: new Date(2_000_000_000 * 1000).toISOString(), authenticationLevel: 'verified',
    })
  })

  it('returns null when no authenticated session exists', () => {
    expect(summarizeCurrentSession(null)).toBeNull()
  })

  it('describes common browsers in merchant-friendly language', () => {
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36')).toBe('Google Chrome على Windows')
    expect(describeBrowser('Mozilla/5.0 (iPhone) Version/17 Safari/605.1')).toBe('Safari على iOS')
  })
})
