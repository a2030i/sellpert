const RECOVERY_KEY = 'sellpert-asset-recovery-v1'
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000

type RecoveryEnvironment = {
  currentEntry: string
  latestEntry: () => Promise<string | null>
  storage: Pick<Storage, 'getItem' | 'setItem'>
  reload: () => void
  online: () => boolean
  now: () => number
}

/** A deployment recovery must never clear auth storage or repeatedly reload a tab. */
export function createAssetRecovery(env: RecoveryEnvironment) {
  let inFlight = false
  let reloading = false
  return async (): Promise<boolean> => {
    if (inFlight || reloading || !env.currentEntry || !env.online()) return false
    inFlight = true
    try {
      const raw = env.storage.getItem(RECOVERY_KEY)
      if (raw) {
        const previous = JSON.parse(raw) as { entry?: string; at?: number }
        if (previous.entry === env.currentEntry || typeof previous.at !== 'number'
          || env.now() - previous.at < RELOAD_COOLDOWN_MS) return false
      }
      const latest = await env.latestEntry()
      if (!latest || latest === env.currentEntry || !env.online()) return false
      // Persist before navigation. If storage is blocked, keep the existing
      // manual recovery instead of risking an endless reload/session loss.
      env.storage.setItem(RECOVERY_KEY, JSON.stringify({ entry: env.currentEntry, at: env.now() }))
      reloading = true
      env.reload()
      return true
    } catch {
      return false
    } finally {
      inFlight = false
    }
  }
}

function entryFingerprint(doc: Document, origin: string): string {
  return Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
    .map(script => new URL(script.getAttribute('src')!, origin))
    .filter(url => url.origin === origin)
    .map(url => url.href).sort().join('\n')
}

export function installAssetRecovery(): () => void {
  let storage: Storage
  try { storage = window.sessionStorage } catch { return () => {} }
  const origin = window.location.origin
  const recover = createAssetRecovery({
    currentEntry: entryFingerprint(document, origin),
    storage,
    online: () => navigator.onLine !== false,
    now: Date.now,
    reload: () => window.location.reload(),
    latestEntry: async () => {
      const response = await fetch(new URL(import.meta.env.BASE_URL, origin), {
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
        headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null
      return entryFingerprint(new DOMParser().parseFromString(await response.text(), 'text/html'), origin)
    },
  })
  // Leave the normal error boundary active if offline, no deployment exists,
  // or recovery is exhausted. Preventing the event would swallow those errors.
  const onPreloadError = () => { void recover() }
  window.addEventListener('vite:preloadError', onPreloadError)
  return () => window.removeEventListener('vite:preloadError', onPreloadError)
}
