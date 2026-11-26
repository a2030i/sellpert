import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configureAuthDomain,
  EDGE_SETTINGS,
  mergeRedirectAllowList,
  PROJECT_REF,
  REQUIRED_REDIRECTS,
  safeFailure,
  SITE_URL,
} from './configure-auth-domain.mjs'

const API_ROOT = `https://api.supabase.com/v1/projects/${PROJECT_REF}`
const sentinel = 'PRIVATE_TEST_VALUE_MUST_NOT_APPEAR'
const shell = '<html><head><title>Sellpert — لوحة التحكم</title></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>'
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

function harness({ unhealthy = false, failureAt = null } = {}) {
  const calls = []
  let authReads = 0
  let auth = { site_url: 'https://sellpert.vercel.app', uri_allow_list: 'http://localhost:5173/**,https://old.example/auth/recovery' }
  let names = ['AMAZON_SP_APP_ID']
  const fetchImpl = async (url, options) => {
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ url, method, body })
    if (url.startsWith(SITE_URL)) {
      assert.equal(options.headers.Authorization, undefined)
      assert.equal(options.redirect, 'error')
      return new Response(unhealthy ? 'unavailable' : shell, {
        status: unhealthy ? 503 : 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }
    assert.ok(url.startsWith(API_ROOT))
    assert.equal(options.headers.Authorization, 'Bearer test-only-token')
    assert.equal(options.redirect, 'error')
    if (failureAt === `${method} ${url.slice(API_ROOT.length)}`) {
      return new Response(sentinel, { status: 403 })
    }
    if (url.endsWith('/secrets')) {
      if (method === 'GET') return json(names.map(name => ({ name, value: sentinel, digest: sentinel })))
      assert.equal(method, 'POST')
      assert.deepEqual(body, EDGE_SETTINGS)
      names = [...new Set([...names, ...body.map(row => row.name)])]
      // Even a successful write response must not be printed or retained.
      return new Response(sentinel, { status: 201 })
    }
    assert.equal(url, `${API_ROOT}/config/auth`)
    if (method === 'GET') {
      authReads += 1
      if (authReads === 2) auth.uri_allow_list += ',https://added-after-inspection.example/callback'
      return json({ ...auth, smtp_pass: sentinel, external_google_secret: sentinel })
    }
    assert.equal(method, 'PATCH')
    assert.deepEqual(Object.keys(body).sort(), ['site_url', 'uri_allow_list'])
    auth = body
    return json({ ...auth, smtp_pass: sentinel })
  }
  return { fetchImpl, calls }
}

test('redirect merge preserves existing entries, previous implicit Site URL, and exact new routes', () => {
  const current = ' http://localhost:5173/**,https://*.example.test/**,https://old.example/auth/recovery,https://*.example.test/** '
  const entries = mergeRedirectAllowList(current, 'https://sellpert.vercel.app').split(',')
  assert.deepEqual(entries, [
    'http://localhost:5173/**',
    'https://*.example.test/**',
    'https://old.example/auth/recovery',
    'https://sellpert.vercel.app',
    ...REQUIRED_REDIRECTS,
  ])
  assert.equal(mergeRedirectAllowList(entries.join(','), SITE_URL), entries.join(','))
  assert.equal(mergeRedirectAllowList(null, null), REQUIRED_REDIRECTS.join(','))
})

test('unexpected redirect representations fail closed without echoing contents', () => {
  for (const value of [undefined, [sentinel], { private: sentinel }, 123]) {
    assert.throws(() => mergeRedirectAllowList(value, null), error => !safeFailure(error).includes(sentinel))
  }
})

test('inspect performs only two reads and returns allowlisted URLs and presence booleans', async () => {
  const { fetchImpl, calls } = harness()
  const result = await configureAuthDomain({ mode: 'inspect', token: 'test-only-token', fetchImpl })
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET'])
  assert.ok(calls.every(call => call.url.startsWith(API_ROOT)))
  assert.equal(result.site_url_matches, false)
  assert.equal(result.auth_configuration_verified, false)
  assert.deepEqual(result.secret_presence.find(row => row.name === 'AMAZON_SP_APP_ID'), { name: 'AMAZON_SP_APP_ID', present: true })
  assert.deepEqual(result.secret_presence.find(row => row.name === 'AMAZON_SP_LWA_CLIENT_SECRET'), { name: 'AMAZON_SP_LWA_CLIENT_SECRET', present: false })
  const output = JSON.stringify(result)
  for (const privateText of [sentinel, 'test-only-token', 'smtp_pass', 'old.example', 'localhost']) assert.ok(!output.includes(privateText))
})

test('apply health-checks every route, changes only approved fields, and preserves a newly added redirect', async () => {
  const { fetchImpl, calls } = harness()
  const result = await configureAuthDomain({ mode: 'apply', token: 'test-only-token', fetchImpl })
  const writes = calls.filter(call => call.method !== 'GET')
  assert.equal(writes.length, 2)
  assert.equal(writes[0].url, `${API_ROOT}/secrets`)
  assert.deepEqual(writes[0].body, EDGE_SETTINGS)
  assert.equal(writes[1].url, `${API_ROOT}/config/auth`)
  assert.equal(writes[1].body.site_url, SITE_URL)
  for (const required of ['https://added-after-inspection.example/callback', 'https://sellpert.vercel.app', ...REQUIRED_REDIRECTS]) {
    assert.ok(writes[1].body.uri_allow_list.split(',').includes(required))
  }
  const firstWrite = calls.indexOf(writes[0])
  assert.deepEqual(calls.slice(0, firstWrite).filter(call => call.url.startsWith(SITE_URL)).map(call => call.url), [
    `${SITE_URL}/`, `${SITE_URL}/auth/recovery`, `${SITE_URL}/integrations/amazon/callback`,
  ])
  assert.equal(result.site_url_matches, true)
  assert.equal(result.auth_configuration_verified, true)
  assert.ok(result.required_redirects.every(row => row.present))
  assert.ok(result.function_setting_presence.every(row => row.present))
  // Amazon keys may be entered separately; their absence never becomes fake data.
  assert.equal(result.secret_presence.find(row => row.name === 'AMAZON_SP_LWA_CLIENT_SECRET').present, false)
  assert.ok(!JSON.stringify(result).includes(sentinel))
})

test('an unhealthy domain causes zero writes', async () => {
  const { fetchImpl, calls } = harness({ unhealthy: true })
  await assert.rejects(configureAuthDomain({ mode: 'apply', token: 'test-only-token', fetchImpl }), { code: 'DOMAIN' })
  assert.ok(calls.every(call => call.method === 'GET'))
})

test('a redirect, non-HTML response, or unrelated site fails the domain gate', async () => {
  for (const response of [
    () => { throw new Error('redirect refused') },
    () => new Response(shell, { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response('<title>Another site</title>', { headers: { 'Content-Type': 'text/html' } }),
  ]) {
    const { fetchImpl: apiFetch, calls } = harness()
    const fetchImpl = (url, options) => url.startsWith(SITE_URL) ? response() : apiFetch(url, options)
    await assert.rejects(configureAuthDomain({ mode: 'apply', token: 'test-only-token', fetchImpl }), { code: 'DOMAIN' })
    assert.ok(calls.every(call => call.method === 'GET'))
  }
})

test('provider HTTP failures and thrown exceptions cannot leak response bodies or credentials', async () => {
  const { fetchImpl } = harness({ failureAt: 'PATCH /config/auth' })
  await assert.rejects(configureAuthDomain({ mode: 'apply', token: 'test-only-token', fetchImpl }), error => {
    assert.equal(error.code, 'AUTH_WRITE')
    assert.match(safeFailure(error), /Function settings may already be updated/)
    assert.ok(!safeFailure(error).includes(sentinel))
    return true
  })
  await assert.rejects(configureAuthDomain({ mode: 'inspect', token: 'test-only-token', fetchImpl: async () => { throw new Error(sentinel) } }), error => {
    assert.ok(!safeFailure(error).includes(sentinel))
    return true
  })
  assert.ok(!safeFailure(new Error(sentinel)).includes(sentinel))
})

test('malformed Auth JSON cannot escape through a JSON parser error', async () => {
  const fetchImpl = async () => new Response(`{"private":"${sentinel}`, { headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(configureAuthDomain({ mode: 'inspect', token: 'test-only-token', fetchImpl }), error => {
    assert.equal(error.code, 'API_READ')
    assert.ok(!safeFailure(error).includes(sentinel))
    return true
  })
})

test('invalid mode and absent token stop before making any request', async () => {
  const fetchImpl = () => { throw new Error('must not execute') }
  await assert.rejects(configureAuthDomain({ mode: 'unexpected', token: 'test-only-token', fetchImpl }), { code: 'MODE' })
  await assert.rejects(configureAuthDomain({ mode: 'inspect', token: '', fetchImpl }), { code: 'TOKEN' })
})
