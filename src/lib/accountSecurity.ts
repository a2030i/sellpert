import type { Session, User } from '@supabase/supabase-js'

export type CurrentSessionSummary = {
  sessionId: string | null
  signedInAt: string | null
  expiresAt: string | null
  authenticationLevel: 'standard' | 'verified'
}

export function summarizeCurrentSession(session: Session | null, user?: User | null): CurrentSessionSummary | null {
  if (!session) return null
  const aal = readJwtClaim(session.access_token, 'aal')
  return {
    sessionId: typeof session.access_token === 'string' ? readJwtClaim(session.access_token, 'session_id') : null,
    signedInAt: user?.last_sign_in_at || session.user?.last_sign_in_at || null,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    authenticationLevel: aal === 'aal2' ? 'verified' : 'standard',
  }
}

export function describeBrowser(userAgent: string) {
  const value = userAgent.toLowerCase()
  const browser = value.includes('edg/') ? 'Microsoft Edge'
    : value.includes('opr/') || value.includes('opera') ? 'Opera'
      : value.includes('firefox/') ? 'Firefox'
        : value.includes('chrome/') ? 'Google Chrome'
          : value.includes('safari/') ? 'Safari'
            : 'متصفح ويب'
  const system = value.includes('windows') ? 'Windows'
    : value.includes('iphone') || value.includes('ipad') ? 'iOS'
      : value.includes('android') ? 'Android'
        : value.includes('mac os') || value.includes('macintosh') ? 'macOS'
          : value.includes('linux') ? 'Linux'
            : ''
  return system ? `${browser} على ${system}` : browser
}

function readJwtClaim(token: string, key: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(normalized)) as Record<string, unknown>
    return typeof decoded[key] === 'string' ? decoded[key] as string : null
  } catch {
    return null
  }
}
