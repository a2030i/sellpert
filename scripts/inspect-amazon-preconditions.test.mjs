import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { CHECK_KEYS, inspectAmazonPreconditions } from './inspect-amazon-preconditions.mjs'
const sql = await readFile(new URL('./releases/amazon-20261126/inspect.sql', import.meta.url), 'utf8')
const secret = 'PRIVATE_DIAGNOSTIC_SENTINEL'
const checks = () => Object.fromEntries(CHECK_KEYS.map(key => [key, key !== 'expected_actor']))
const actor = () => ({ current_role_category: 'supabase_read_only_user', session_role_category: 'postgres', current_role_sha256: 'a'.repeat(64), search_path_sha256: 'b'.repeat(64), current_role_superuser: false, current_role_bypass_rls: false, row_security_on: true })

test('runs the exact approved SQL read-only, reports false check without weakening it, and allowlists actor metadata', async () => {
  const requests = []
  const result = await inspectAmazonPreconditions({ token: secret, sql, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.supabase.com/v1/projects/urdyzbsukcuibadlaath/database/query')
    const body = JSON.parse(options.body)
    assert.equal(body.read_only, true)
    assert.equal(body.disable_statement_timeout, false)
    assert.equal(options.redirect, 'error')
    requests.push(body.query)
    return new Response(JSON.stringify([requests.length === 1 ? checks() : actor()]))
  } })
  assert.equal(requests[0], sql)
  assert.equal(requests.length, 2)
  assert.equal(result.ok, true)
  assert.equal(result.preconditions_passed, false)
  assert.equal(result.checks.expected_actor, false)
  assert.equal(result.mutations_requested, false)
  assert.equal(result.actor.current_role_category, 'supabase_read_only_user')
  assert.ok(!JSON.stringify(result).includes(secret))
})

test('changed SQL cannot make any request', async () => {
  const result = await inspectAmazonPreconditions({ token: secret, sql: `${sql}\n`, fetchImpl: () => { throw Error('must not run') } })
  assert.equal(result.diagnostic, 'INSPECT_HASH')
})

test('unknown or nonboolean precondition fields fail closed without exposing data', async () => {
  for (const body of [{ ...checks(), private: secret }, { ...checks(), expected_actor: secret }]) {
    const result = await inspectAmazonPreconditions({ token: secret, sql, fetchImpl: async () => new Response(JSON.stringify([body])) })
    assert.equal(result.ok, false)
    assert.ok(!JSON.stringify(result).includes(secret))
  }
})

test('actor failures preserve validated checks and never expose provider diagnostics', async () => {
  for (const response of [() => new Response(secret, { status: 403 }), () => new Response(JSON.stringify([{ ...actor(), current_role_category: secret }]))]) {
    let calls = 0
    const result = await inspectAmazonPreconditions({ token: secret, sql, fetchImpl: async () => ++calls === 1 ? new Response(JSON.stringify([checks()])) : response() })
    assert.equal(result.ok, true)
    assert.equal(result.checks.expected_actor, false)
    assert.ok(!JSON.stringify(result).includes(secret))
    assert.equal(result.actor, undefined)
  }
})
