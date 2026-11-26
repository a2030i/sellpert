import { pathToFileURL } from 'node:url'

export const PROJECT_REF = 'urdyzbsukcuibadlaath'
export const SITE_URL = 'https://app.sellpert.com'
export const REQUIRED_REDIRECTS = Object.freeze([
  SITE_URL,
  `${SITE_URL}/`,
  `${SITE_URL}/auth/recovery`,
  `${SITE_URL}/integrations/amazon/callback`,
])
export const EDGE_SETTINGS = Object.freeze([
  { name: 'AMAZON_SP_REDIRECT_URI', value: `${SITE_URL}/integrations/amazon/callback` },
  { name: 'AMAZON_SP_APP_DRAFT', value: 'true' },
])
export const SECRET_NAMES = Object.freeze([
  'AMAZON_SP_APP_ID',
  'AMAZON_SP_LWA_CLIENT_ID',
  'AMAZON_SP_LWA_CLIENT_SECRET',
  'PLATFORM_CREDENTIALS_ENCRYPTION_KEY',
])

const API_ROOT = `https://api.supabase.com/v1/projects/${PROJECT_REF}`
const FAILURES = Object.freeze({
  MODE: 'Use exactly one mode: --inspect or --apply.',
  TOKEN: 'SUPABASE_ACCESS_TOKEN is missing.',
  TLS: 'TLS certificate verification must remain enabled.',
  API_READ: 'Management API inspection failed. No response body was logged.',
  API_SHAPE: 'Management API returned an unexpected shape. No response body was logged.',
  DOMAIN: 'The new HTTPS domain did not pass the SPA health checks. No settings were changed.',
  EDGE_WRITE: 'Function settings request failed. Inspect settings before retrying; the outcome may be uncertain.',
  AUTH_WRITE: 'Auth configuration request failed. Function settings may already be updated; inspect before retrying.',
  VERIFY: 'Configuration verification failed after writes. Inspect settings before retrying.',
  UNEXPECTED: 'Configuration stopped after an unexpected failure. Inspect settings before retrying; no error details were logged.',
})

export class ConfigurationError extends Error {
  constructor(code, status, operation) {
    super(FAILURES[code] || FAILURES.UNEXPECTED)
    this.code = Object.hasOwn(FAILURES, code) ? code : 'UNEXPECTED'
    this.httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
    this.operation = ['/config/auth', '/secrets'].includes(operation) ? operation : undefined
  }
}

// Never print error.message/stack/cause from fetch, JSON parsing, or an API.
export function safeFailure(error) {
  const code = error instanceof ConfigurationError ? error.code : 'UNEXPECTED'
  const detail = error instanceof ConfigurationError
    ? [error.operation, error.httpStatus && `HTTP ${error.httpStatus}`].filter(Boolean).join(' ')
    : ''
  return `${code}: ${FAILURES[code] || FAILURES.UNEXPECTED}${detail ? ` (${detail})` : ''}`
}

function redirectEntries(value) {
  if (value === null) return []
  if (typeof value !== 'string') throw new ConfigurationError('API_SHAPE')
  return value.split(',').map(entry => entry.trim()).filter(Boolean)
}

export function mergeRedirectAllowList(current, previousSiteUrl) {
  if (previousSiteUrl !== null && typeof previousSiteUrl !== 'string') {
    throw new ConfigurationError('API_SHAPE')
  }
  // The previous Site URL was implicitly allowed. Retain it explicitly when
  // switching, along with every existing exact URL, wildcard, and local URL.
  const previous = previousSiteUrl?.trim()
  if (previous && /[,\r\n]/.test(previous)) throw new ConfigurationError('API_SHAPE')
  return [...new Set([
    ...redirectEntries(current),
    ...(previous ? [previous] : []),
    ...REQUIRED_REDIRECTS,
  ])].join(',')
}

function readAuthFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !Object.hasOwn(body, 'site_url') || !Object.hasOwn(body, 'uri_allow_list')) {
    throw new ConfigurationError('API_SHAPE')
  }
  // Auth responses can also contain credentials. Retain only the two fields
  // needed here; never log or serialize the complete response.
  const { site_url, uri_allow_list } = body
  mergeRedirectAllowList(uri_allow_list, site_url)
  return { site_url, uri_allow_list }
}

function readSecretNames(body) {
  if (!Array.isArray(body) || body.some(row => !row || typeof row.name !== 'string')) {
    throw new ConfigurationError('API_SHAPE')
  }
  // Ignore value/digest and all other fields, even for the two nonsecret settings.
  return new Set(body.map(row => row.name))
}

async function managementRequest(fetchImpl, token, path, { method = 'GET', body, failure = 'API_READ', json = true } = {}) {
  let response
  try {
    response = await fetchImpl(`${API_ROOT}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ConfigurationError(failure, response.status, path)
    }
    if (!json) {
      await response.body?.cancel()
      return undefined
    }
    return await response.json()
  } catch (error) {
    // A provider may echo credentials in an error body or malformed JSON.
    if (error instanceof ConfigurationError) throw error
    throw new ConfigurationError(failure, undefined, path)
  }
}

async function requireHealthyDomain(fetchImpl) {
  for (const path of ['/', '/auth/recovery', '/integrations/amazon/callback']) {
    try {
      const response = await fetchImpl(`${SITE_URL}${path}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'text/html' },
      })
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) {
        await response.body?.cancel()
        throw new Error()
      }
      const html = await response.text()
      if (!/<title[^>]*>[^<]*sellpert/i.test(html) || !/<div\b[^>]*\bid=["']root["']/i.test(html)
        || !/<script\b[^>]*\btype=["']module["']/i.test(html)) {
        throw new Error()
      }
    } catch {
      throw new ConfigurationError('DOMAIN')
    }
  }
}

function summary(mode, auth, names, applied = false) {
  const entries = new Set(redirectEntries(auth.uri_allow_list))
  return {
    mode,
    project_ref: PROJECT_REF,
    site_url: SITE_URL,
    site_url_matches: auth.site_url === SITE_URL,
    required_redirects: REQUIRED_REDIRECTS.map(url => ({ url, present: entries.has(url) })),
    secret_presence: SECRET_NAMES.map(name => ({ name, present: names.has(name) })),
    function_setting_presence: EDGE_SETTINGS.map(({ name }) => ({ name, present: names.has(name) })),
    function_settings_request_accepted: applied,
    auth_configuration_verified: applied,
  }
}

export async function configureAuthDomain({ mode, token, fetchImpl = fetch }) {
  if (!['inspect', 'apply'].includes(mode)) throw new ConfigurationError('MODE')
  if (typeof token !== 'string' || !token.trim()) throw new ConfigurationError('TOKEN')
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new ConfigurationError('TLS')

  const initialAuth = readAuthFields(await managementRequest(fetchImpl, token, '/config/auth'))
  const initialNames = readSecretNames(await managementRequest(fetchImpl, token, '/secrets'))
  if (mode === 'inspect') return summary(mode, initialAuth, initialNames)

  // No mutations until DNS, valid HTTPS, and each SPA entry route are healthy.
  await requireHealthyDomain(fetchImpl)
  await managementRequest(fetchImpl, token, '/secrets', {
    method: 'POST', body: EDGE_SETTINGS, failure: 'EDGE_WRITE', json: false,
  })

  // Re-read immediately before patching to preserve redirects added since inspection.
  // The API has no documented compare-and-swap for these fields: avoid concurrent
  // manual Auth configuration edits while this operation runs.
  const latestAuth = readAuthFields(await managementRequest(fetchImpl, token, '/config/auth', { failure: 'AUTH_WRITE' }))
  const uriAllowList = mergeRedirectAllowList(latestAuth.uri_allow_list, latestAuth.site_url)
  await managementRequest(fetchImpl, token, '/config/auth', {
    method: 'PATCH',
    body: { site_url: SITE_URL, uri_allow_list: uriAllowList },
    failure: 'AUTH_WRITE',
    json: false,
  })

  const verifiedAuth = readAuthFields(await managementRequest(fetchImpl, token, '/config/auth', { failure: 'VERIFY' }))
  const verifiedEntries = new Set(redirectEntries(verifiedAuth.uri_allow_list))
  const verifiedNames = readSecretNames(await managementRequest(fetchImpl, token, '/secrets', { failure: 'VERIFY' }))
  if (verifiedAuth.site_url !== SITE_URL
    || redirectEntries(uriAllowList).some(url => !verifiedEntries.has(url))
    || EDGE_SETTINGS.some(({ name }) => !verifiedNames.has(name))) {
    throw new ConfigurationError('VERIFY')
  }
  return summary(mode, verifiedAuth, verifiedNames, true)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 1 || !['--inspect', '--apply'].includes(args[0])) throw new ConfigurationError('MODE')
    const result = await configureAuthDomain({ mode: args[0].slice(2), token: process.env.SUPABASE_ACCESS_TOKEN })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(safeFailure(error))
    process.exitCode = 1
  }
}
