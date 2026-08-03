import { supabase } from './supabase'

export type ClientIncidentCategory = 'render' | 'unhandled' | 'network' | 'api' | 'journey'
export type ClientIncidentSeverity = 'warning' | 'error' | 'fatal'

type IncidentInput = {
  category: ClientIncidentCategory
  severity?: ClientIncidentSeverity
  component: string
  action?: string
  error?: unknown
  errorCode?: string
  httpStatus?: number
  pagePath?: string
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LONG_NUMBER_SEGMENT = /^\d{4,}$/
const recentReports = new Map<string, number>()
let globalListenersInstalled = false

export function sanitizeIncidentPath(value: string): string {
  const rawPath = (value || '/').split('?')[0].split('#')[0]
  const segments = rawPath.split('/').map(segment => {
    if (UUID_SEGMENT.test(segment) || LONG_NUMBER_SEGMENT.test(segment)) return ':id'
    return segment.replace(/[^a-zA-Z0-9_.:-]/g, '')
  })
  const path = `/${segments.filter(Boolean).join('/')}`.slice(0, 160)
  return path === '' ? '/' : path
}

export function sanitizeIncidentToken(value: string | undefined, fallback: string, maxLength = 80): string {
  const token = (value || '').split(':')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, maxLength)
  return token || fallback
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'request_aborted'
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('chunk') && message.includes('load')) return 'chunk_load_failure'
    if (message.includes('network') || message.includes('failed to fetch')) return 'network_failure'
    if (message.includes('timeout') || message.includes('timed out')) return 'request_timeout'
    if (message.includes('unauthorized') || message.includes('forbidden')) return 'authorization_failure'
    return sanitizeIncidentToken(error.name, 'application_error')
  }
  return 'unknown_error'
}

export async function reportClientIncident(input: IncidentInput): Promise<void> {
  const payload = {
    p_category: input.category,
    p_severity: input.severity || 'error',
    p_page_path: sanitizeIncidentPath(input.pagePath || window.location.pathname),
    p_component: sanitizeIncidentToken(input.component, 'application'),
    p_action: input.action ? sanitizeIncidentToken(input.action, 'action') : undefined,
    p_error_code: sanitizeIncidentToken(input.errorCode, safeErrorCode(input.error)),
    p_http_status: input.httpStatus && input.httpStatus >= 100 && input.httpStatus <= 599 ? input.httpStatus : undefined,
    p_release: sanitizeIncidentToken(import.meta.env.VITE_APP_RELEASE, 'web', 64),
  }

  const dedupeKey = JSON.stringify(payload)
  const now = Date.now()
  const previous = recentReports.get(dedupeKey) || 0
  if (now - previous < 30_000) return
  recentReports.set(dedupeKey, now)

  try {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return
    await supabase.rpc('report_client_incident', payload)
  } catch {
    // Observability must never become a second application failure.
  } finally {
    if (recentReports.size > 100) {
      for (const [key, reportedAt] of recentReports) {
        if (now - reportedAt > 60_000) recentReports.delete(key)
      }
    }
  }
}

export function installClientIncidentReporting(): void {
  if (globalListenersInstalled || typeof window === 'undefined') return
  globalListenersInstalled = true

  window.addEventListener('error', event => {
    if (!event.error) return
    void reportClientIncident({
      category: 'unhandled',
      severity: 'fatal',
      component: 'window',
      action: 'error',
      error: event.error,
    })
  })

  window.addEventListener('unhandledrejection', event => {
    void reportClientIncident({
      category: 'unhandled',
      severity: 'error',
      component: 'window',
      action: 'promise_rejection',
      error: event.reason,
    })
  })
}
