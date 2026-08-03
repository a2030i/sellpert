const encoder = new TextEncoder()

export class PayloadTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Payload exceeds the ${maxBytes} byte limit`)
    this.name = 'PayloadTooLargeError'
  }
}

export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const declaredSize = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new PayloadTooLargeError(maxBytes)
  }
  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new PayloadTooLargeError(maxBytes)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export function timingSafeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  const length = Math.max(a.length, b.length)
  let difference = a.length ^ b.length
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0)
  }
  return difference === 0
}

export function authorizeInternalWorker(
  bearerToken: string,
  providedSecret: string,
  serviceRoleKey: string,
  configuredSecret: string,
): boolean {
  return bearerToken === serviceRoleKey || (
    configuredSecret.length >= 32 && timingSafeEqual(providedSecret, configuredSecret)
  )
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function stableWebhookEventKey(
  source: string,
  providerEventId: unknown,
  rawBody: string,
): Promise<string> {
  const providerId = String(providerEventId || '').trim()
  return providerId ? `${source}:${providerId}` : `${source}:sha256:${await sha256Hex(rawBody)}`
}
