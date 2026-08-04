export const ACCOUNT_CODE_PATTERN = /^[A-Z]-[A-F0-9]{16}$/

export const MERCHANT_PERMISSION_KEYS = [
  'dashboard',
  'orders',
  'products',
  'inventory',
  'marketing',
  'statement',
  'integrations',
  'settings',
] as const

const COMMON_ACCOUNT_PASSWORDS = new Set([
  'password123', 'password1234', 'password123!', 'qwerty12345',
  '1234567890', '123456789012', 'admin123456', 'admin123456!',
  'sellpert123', 'sellpert123!', 'trendyol123', 'trendyol123!',
  'amazon12345', 'amazon12345!',
])

export function generateAccountCode(prefix: 'M' | 'E' | 'S' | 'A'): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const suffix = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `${prefix}-${suffix}`
}

export function isStrongAccountPassword(password: unknown): password is string {
  return typeof password === 'string'
    && password.length >= 12
    && password.length <= 128
    && /\p{L}/u.test(password)
    && /\d/u.test(password)
    && /[^\p{L}\p{N}\s]/u.test(password)
    && !COMMON_ACCOUNT_PASSWORDS.has(password.trim().toLocaleLowerCase('en'))
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length >= 2 && name.length <= 120 ? name : null
}

export function normalizeMerchantPermissions(
  value: unknown,
  defaults: Record<string, boolean>,
): Record<string, boolean> | null {
  if (value === undefined || value === null) return { ...defaults }
  if (typeof value !== 'object' || Array.isArray(value)) return null

  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !MERCHANT_PERMISSION_KEYS.includes(key as typeof MERCHANT_PERMISSION_KEYS[number]))) {
    return null
  }
  if (Object.values(input).some(permission => typeof permission !== 'boolean')) return null

  return { ...defaults, ...input } as Record<string, boolean>
}
