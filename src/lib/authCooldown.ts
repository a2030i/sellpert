const DEFAULT_COOLDOWN_MS = 60_000

export type CooldownStorage = Pick<Storage, 'getItem' | 'setItem'>

export function authCooldownRemaining(
  storage: CooldownStorage,
  action: 'register' | 'recover' | 'resend',
  now = Date.now(),
  durationMs = DEFAULT_COOLDOWN_MS,
) {
  try {
    const startedAt = Number(storage.getItem(`sellpert:auth:${action}:started-at`))
    if (!Number.isFinite(startedAt) || startedAt <= 0) return 0
    return Math.max(0, Math.ceil((startedAt + durationMs - now) / 1000))
  } catch {
    return 0
  }
}

export function startAuthCooldown(
  storage: CooldownStorage,
  action: 'register' | 'recover' | 'resend',
  now = Date.now(),
) {
  try {
    storage.setItem(`sellpert:auth:${action}:started-at`, String(now))
  } catch {
    // Auth still works when storage is blocked by the browser.
  }
}
