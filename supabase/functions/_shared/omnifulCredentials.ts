export type OmnifulCredentials = {
  client_id: string
  client_secret: string
  refresh_token: string
  access_token: string
  access_token_expires_at: string | null
  refresh_token_expires_at: string | null
}

export function buildOmnifulCredentials(input: Record<string, unknown>): OmnifulCredentials {
  const accessToken = cleanToken(input.access_token)
  const refreshToken = cleanToken(input.refresh_token)
  return {
    client_id: clean(input.client_id),
    client_secret: clean(input.client_secret),
    refresh_token: refreshToken,
    access_token: accessToken,
    access_token_expires_at: tokenExpiryIso(accessToken),
    refresh_token_expires_at: tokenExpiryIso(refreshToken),
  }
}

export function mergeOmnifulTokenResponse(
  current: OmnifulCredentials,
  payload: unknown,
  refreshedAt = Date.now(),
): OmnifulCredentials | null {
  const body = recordValue(payload)
  const data = recordValue(body.data)
  const source = Object.keys(data).length > 0 ? data : body
  const accessToken = firstString(source.access_token, source.accessToken, source.token)
  if (!accessToken) return null
  const refreshToken = firstString(source.refresh_token, source.refreshToken) || current.refresh_token
  const accessExpiresIn = positiveNumber(source.expires_in, source.access_token_expires_in)
  const refreshExpiresIn = positiveNumber(source.refresh_expires_in, source.refresh_token_expires_in)
  return {
    ...current,
    access_token: cleanToken(accessToken),
    refresh_token: cleanToken(refreshToken),
    access_token_expires_at: tokenExpiryIso(accessToken)
      || secondsFromIso(refreshedAt, accessExpiresIn)
      || current.access_token_expires_at,
    refresh_token_expires_at: tokenExpiryIso(refreshToken)
      || secondsFromIso(refreshedAt, refreshExpiresIn)
      || current.refresh_token_expires_at,
  }
}

export function credentialsAreComplete(credentials: OmnifulCredentials): boolean {
  return credentials.client_id.length >= 4
    && credentials.client_secret.length >= 8
    && credentials.refresh_token.length >= 20
    && credentials.access_token.length >= 20
}

export function accessTokenExpiresSoon(credentials: OmnifulCredentials, windowMs = 10 * 60_000): boolean {
  if (!credentials.access_token_expires_at) return false
  const expiresAt = Date.parse(credentials.access_token_expires_at)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + windowMs
}

export function tokenExpiryIso(token: string): string | null {
  const parts = cleanToken(token).split('.')
  if (parts.length < 2) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>
    const expiresAt = Number(payload.exp)
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null
    return new Date(expiresAt * 1000).toISOString()
  } catch {
    return null
  }
}

function secondsFromIso(start: number, seconds: number): string | null {
  return seconds > 0 ? new Date(start + seconds * 1000).toISOString() : null
}

function positiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = clean(value)
    if (text) return text
  }
  return ''
}

function clean(value: unknown): string {
  return String(value ?? '').trim()
}

function cleanToken(value: unknown): string {
  return clean(value).replace(/^Bearer\s+/i, '').trim()
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
