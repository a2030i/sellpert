import { describe, expect, it } from 'vitest'
import { describeBrowser, normalizeAuthenticatorCode, normalizeRecoveryCode, requiresMfaChallenge, summarizeCurrentSession } from '../accountSecurity'

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

  it('requires a second factor only when the session can reach aal2 but has not yet done so', () => {
    expect(requiresMfaChallenge({ currentLevel: 'aal1', nextLevel: 'aal2' })).toBe(true)
    expect(requiresMfaChallenge({ currentLevel: 'aal2', nextLevel: 'aal2' })).toBe(false)
    expect(requiresMfaChallenge({ currentLevel: 'aal1', nextLevel: 'aal1' })).toBe(false)
  })

  it('normalizes authenticator and recovery codes before submission', () => {
    expect(normalizeAuthenticatorCode('12 34-567')).toBe('123456')
    expect(normalizeRecoveryCode('ab12-cd34 ef56-gh78 extra')).toBe('AB12CD34EF56GH78')
  })
})
