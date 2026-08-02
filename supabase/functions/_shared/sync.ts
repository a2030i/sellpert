export type SyncActor = { kind: 'service' | 'staff' | 'merchant'; email?: string }

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function authorizeMerchantSync(
  req: Request,
  admin: any,
  serviceKey: string,
  merchantCode: string,
): Promise<SyncActor> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!token) throw new HttpError(401, 'Unauthorized')

  // Queue workers and scheduled jobs use the service key. Never accept it from
  // the request body or a public environment variable.
  if (token === serviceKey) return { kind: 'service' }

  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user?.email) throw new HttpError(401, 'Unauthorized')

  const { data: caller } = await admin
    .from('merchants')
    .select('role,merchant_code,owner_merchant_code,is_active,permissions')
    .eq('email', user.email)
    .maybeSingle()

  if (!caller || caller.is_active === false) throw new HttpError(403, 'Forbidden')
  if (['admin', 'super_admin'].includes(caller.role)) {
    return { kind: 'staff', email: user.email }
  }
  if (caller.role === 'staff' && permissionEnabled(caller.permissions, 'upload_files')) {
    return { kind: 'staff', email: user.email }
  }

  if (caller.role === 'employee') {
    const canIntegrate = permissionEnabled(caller.permissions, 'integrations')
    if (!canIntegrate || caller.owner_merchant_code !== merchantCode) {
      throw new HttpError(403, 'Forbidden')
    }
    return { kind: 'merchant', email: user.email }
  }

  const ownedCode = caller.merchant_code

  if (ownedCode === merchantCode) return { kind: 'merchant', email: user.email }

  const { data: link } = await admin
    .from('merchant_account_links')
    .select('id')
    .eq('email', user.email)
    .eq('merchant_code', merchantCode)
    .maybeSingle()

  if (!link) throw new HttpError(403, 'Forbidden')
  return { kind: 'merchant', email: user.email }
}

export function permissionEnabled(value: unknown, permission: string): boolean {
  if (Array.isArray(value)) return value.includes(permission)
  if (!value || typeof value !== 'object') return false
  return (value as Record<string, unknown>)[permission] === true
}

export function parseSyncRange(body: any, defaultDays = 90) {
  const now = Date.now()
  const upperBound = now - 2 * 60_000
  const fallbackFrom = upperBound - defaultDays * 86_400_000
  const from = body?.date_from ? Date.parse(body.date_from) : fallbackFrom
  const to = body?.date_to ? Date.parse(body.date_to) : upperBound

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new HttpError(400, 'Invalid date range')
  }
  if (from >= to) throw new HttpError(400, 'date_from must be before date_to')
  if (to > upperBound) throw new HttpError(400, 'date_to must be at least two minutes in the past')
  return { from: new Date(from), to: new Date(to) }
}

export function splitRange(from: Date, to: Date, maxDays: number) {
  const windows: Array<{ from: Date; to: Date }> = []
  let cursor = from.getTime()
  const end = to.getTime()
  const windowMs = maxDays * 86_400_000
  while (cursor < end) {
    const windowEnd = Math.min(cursor + windowMs, end)
    windows.push({ from: new Date(cursor), to: new Date(windowEnd) })
    cursor = windowEnd + 1
  }
  return windows
}

export async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  label: string,
  attempts = 4,
) {
  let lastError = ''
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(url, init)
    if (res.ok) return await res.json()

    const body = await res.text()
    lastError = `${label} ${res.status}: ${body.slice(0, 500)}`
    if (![429, 500, 502, 503, 504].includes(res.status) || attempt === attempts - 1) {
      throw new HttpError(res.status, lastError)
    }

    const retryAfter = Number(res.headers.get('retry-after'))
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 500 * (2 ** attempt) + Math.floor(Math.random() * 250)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  throw new Error(lastError || `${label} request failed`)
}

export function numberValue(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? 0))
  return Number.isFinite(n) ? n : 0
}

export function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
