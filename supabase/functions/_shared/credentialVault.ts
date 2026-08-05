const PREFIX = 'enc:v1:'

async function encryptionKey() {
  const encoded = Deno.env.get('PLATFORM_CREDENTIALS_ENCRYPTION_KEY') || ''
  if (!encoded) {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!serviceKey) throw new Error('Credential encryption key is not configured')
    const derived = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`sellpert-platform-credentials:v1:${serviceKey}`),
    )
    return crypto.subtle.importKey('raw', derived, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
  } catch {
    throw new Error('PLATFORM_CREDENTIALS_ENCRYPTION_KEY must be base64')
  }
  if (bytes.length !== 32) throw new Error('PLATFORM_CREDENTIALS_ENCRYPTION_KEY must contain exactly 32 bytes')
  const keyBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptCredentialPayload(value: Record<string, unknown>) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await encryptionKey()
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return `${PREFIX}${base64(iv)}:${base64(new Uint8Array(encrypted))}`
}

export async function decryptCredentialPayload(value: unknown): Promise<Record<string, any>> {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return {}
  const [ivEncoded, encryptedEncoded] = value.slice(PREFIX.length).split(':')
  if (!ivEncoded || !encryptedEncoded) throw new Error('Invalid encrypted credential payload')
  const key = await encryptionKey()
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivEncoded) },
    key,
    fromBase64(encryptedEncoded),
  )
  return JSON.parse(new TextDecoder().decode(decrypted))
}

export async function resolveSecretPayload(row: any) {
  const encrypted = await decryptCredentialPayload(row?.extra?.secret_blob)
  // Backward compatibility for existing admin-managed credentials. New writes
  // always use secret_blob and clear these plaintext columns.
  return {
    seller_id: row?.seller_id || encrypted.seller_id || '',
    api_key: encrypted.api_key || row?.api_key || '',
    api_secret: encrypted.api_secret || row?.api_secret || '',
    refresh_token: encrypted.refresh_token || row?.extra?.refresh_token || '',
    access_token: encrypted.access_token || '',
    service_account: encrypted.service_account || row?.extra?.service_account || null,
  }
}

export function legacyCredentialMaterial(row: any): {
  secret: Record<string, unknown>
  publicExtra: Record<string, unknown>
} | null {
  const extra = row?.extra && typeof row.extra === 'object' && !Array.isArray(row.extra)
    ? { ...row.extra }
    : {}
  const secret: Record<string, unknown> = {}

  if (typeof row?.api_key === 'string' && row.api_key.trim()) secret.api_key = row.api_key
  if (typeof row?.api_secret === 'string' && row.api_secret.trim()) secret.api_secret = row.api_secret

  for (const key of ['refresh_token', 'access_token', 'service_account'] as const) {
    if (extra[key] !== undefined && extra[key] !== null && extra[key] !== '') secret[key] = extra[key]
    delete extra[key]
  }
  delete extra.secret_blob

  return Object.keys(secret).length ? { secret, publicExtra: extra } : null
}

function base64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}
