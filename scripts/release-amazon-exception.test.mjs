import test from 'node:test'
import assert from 'node:assert/strict'
import { release, safeFailure, sha256, PROJECT_REF } from './release-amazon-exception.mjs'

function fixture(overrides = {}) {
  const files = { 'inspect.sql': 'SELECT true AS ready;', 'apply.sql': 'BEGIN; SELECT true; COMMIT;', 'verify.sql': 'SELECT true AS complete;' }
  const manifest = {
    project_ref: PROJECT_REF, migration_version: '20261126120000',
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, sha256(value)])),
    checks: { inspect: ['ready'], verify: ['complete'] }, ...overrides,
  }
  files['manifest.json'] = JSON.stringify(manifest)
  return { digest: sha256(files['manifest.json']), read: async url => Buffer.from(files[url.pathname.split('/').at(-1)]), files }
}

test('inspection sends only the frozen SELECT using the deployment actor transport', async () => {
  const f = fixture(); const calls = []
  const result = await release({ ...f, mode: 'inspect', token: 'synthetic-token', fetchImpl: async (url, options) => {
    calls.push({ url, ...JSON.parse(options.body) }); return Response.json([{ ready: true }])
  } })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`)
  assert.equal(calls[0].read_only, false)
  assert.equal(calls[0].query, f.files['inspect.sql'])
  assert.equal(calls[0].disable_statement_timeout, false)
  assert.equal(result.migration_verified, false)
})

test('apply checks first, sends exactly one mutation, then verifies in a fresh request', async () => {
  const f = fixture(); const requests = []
  const result = await release({ ...f, mode: 'apply', token: 'synthetic-token', fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return requests.length === 1 ? Response.json([{ ready: true }])
      : requests.length === 2 ? Response.json([]) : Response.json([{ complete: true }])
  } })
  assert.deepEqual(requests.map(row => row.read_only), [false, false, false])
  assert.deepEqual(requests.map(row => row.query), [f.files['inspect.sql'], f.files['apply.sql'], f.files['verify.sql']])
  assert.equal(result.migration_verified, true)
})

test('failed preconditions prevent the migration request', async () => {
  let calls = 0
  await assert.rejects(release({ ...fixture(), mode: 'apply', token: 'synthetic-token', fetchImpl: async () => {
    calls++; return Response.json([{ ready: false }])
  } }), error => error.code === 'PRECONDITION')
  assert.equal(calls, 1)
})

test('an unexpected all-true result cannot substitute for required assertions', async () => {
  await assert.rejects(release({ ...fixture(), mode: 'apply', token: 'synthetic-token', fetchImpl: async () => Response.json([{ other: true }]) }), error => error.code === 'SHAPE')
})

test('artifact tampering and a different target both prevent all network requests', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error() }
  const f = fixture(); f.files['apply.sql'] += ' SELECT 2;'
  await assert.rejects(release({ ...f, mode: 'apply', token: 'synthetic-token', fetchImpl }), error => error.code === 'ARTIFACT')
  await assert.rejects(release({ ...fixture({ project_ref: 'different-project' }), mode: 'apply', token: 'synthetic-token', fetchImpl }), error => error.code === 'ARTIFACT')
  assert.equal(calls, 0)
})

test('ambiguous mutation failures never retry or expose provider content', async () => {
  let calls = 0
  await assert.rejects(release({ ...fixture(), mode: 'apply', token: 'synthetic-token', fetchImpl: async () => {
    calls++
    if (calls === 1) return Response.json([{ ready: true }])
    throw new Error('synthetic-private-response')
  } }), error => error.code === 'UNCERTAIN' && !safeFailure(error).includes('synthetic-private-response'))
  assert.equal(calls, 2)
})

test('successful HTTP mutation alone is not successful deployment verification', async () => {
  let calls = 0
  await assert.rejects(release({ ...fixture(), mode: 'apply', token: 'synthetic-token', fetchImpl: async () => {
    calls++
    return calls === 1 ? Response.json([{ ready: true }]) : calls === 2 ? Response.json([]) : Response.json([{ complete: false }])
  } }), error => error.code === 'VERIFY')
  assert.equal(calls, 3)
})

test('server errors report only the allowlisted category and HTTP status', async () => {
  await assert.rejects(release({ ...fixture(), mode: 'inspect', token: 'synthetic-token', fetchImpl: async () => new Response('synthetic-private-response', { status: 403 }) }), error => {
    assert.equal(error.status, 403)
    assert.ok(!safeFailure(error).includes('synthetic-private-response'))
    return error.code === 'REQUEST'
  })
  assert.ok(!safeFailure(new Error('synthetic-private-response')).includes('synthetic-private-response'))
})

for (const failure of ['network', 'shape']) {
  test(`post-apply ${failure} failure retains the committed-migration warning`, async () => {
    let calls = 0
    await assert.rejects(release({ ...fixture(), mode: 'apply', token: 'synthetic-token', fetchImpl: async () => {
      calls++
      if (calls === 1) return Response.json([{ ready: true }])
      if (calls === 2) return Response.json([])
      if (failure === 'network') throw new Error('synthetic-private-response')
      return Response.json([{ other: true }])
    } }), error => error.code === 'VERIFY_UNCERTAIN' && safeFailure(error).includes('Do not retry'))
    assert.equal(calls, 3)
  })
}
