import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { deployAmazonSyncFunctions, FunctionDeploymentError } from './deploy-amazon-sync-functions.mjs'

const sourcePin = { reviewedCommit: 'a'.repeat(40), eventCommit: 'a'.repeat(40), headCommit: 'a'.repeat(40), ref: 'refs/heads/main' }

test('deploys only the three reviewed handlers in consumer-before-worker order', () => {
  const calls = []
  const result = deployAmazonSyncFunctions({ token: 'synthetic-secret', sourcePin, exec: (...args) => { calls.push(args); return Buffer.from('synthetic-private-CLI-output') } })
  assert.deepEqual(calls.map(call => call[1][2]), ['sync-amazon', 'amazon-connect', 'queue-worker'])
  for (const [command, args, options] of calls) {
    assert.equal(command, 'supabase')
    assert.deepEqual(args, ['functions', 'deploy', args[2], '--project-ref', 'urdyzbsukcuibadlaath', '--use-api'])
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe'])
    assert.equal(options.timeout, 180_000)
    assert.equal(options.env.SUPABASE_ACCESS_TOKEN, 'synthetic-secret')
    assert.ok(!args.includes('synthetic-secret'))
  }
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'))
  assert.ok(!JSON.stringify(result).includes('synthetic-private'))
})

for (const failedCall of [1, 2, 3]) {
  test(`deployment failure at handler ${failedCall} stops immediately without retries or CLI diagnostics`, () => {
    let calls = 0
    assert.throws(() => deployAmazonSyncFunctions({ token: 'synthetic-secret', sourcePin, exec: () => {
      calls++
      if (calls === failedCall) throw Object.assign(new Error('synthetic-private-CLI-error'), { stdout: 'synthetic-secret', stderr: 'synthetic-provider-response' })
    } }), error => error instanceof FunctionDeploymentError && error.message.includes('Some handlers may already be deployed') && !error.message.includes('synthetic'))
    assert.equal(calls, failedCall)
  })
}

test('missing credentials or mismatched source cannot deploy any handler', () => {
  let calls = 0
  const exec = () => { calls++ }
  assert.throws(() => deployAmazonSyncFunctions({ token: '', sourcePin, exec }), error => error.code === 'CONFIG')
  assert.throws(() => deployAmazonSyncFunctions({ token: 'synthetic-secret', sourcePin: { ...sourcePin, headCommit: 'b'.repeat(40) }, exec }), error => error.code === 'SOURCE')
  assert.equal(calls, 0)
})

test('manual workflow pins main, validates before deployment, and has no post-mutation automatic retry step', async () => {
  const workflow = await readFile(new URL('../.github/workflows/amazon-sync-targeted-release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s+(push|schedule|pull_request):/m)
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/)
  assert.match(workflow, /environment: production/)
  assert.match(workflow, /group: supabase-production-release/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /contents: read/)
  assert.match(workflow, /persist-credentials: false/)
  const pin = workflow.indexOf('sourcePinFromEnvironment();')
  const inspect = workflow.indexOf('exception.mjs inspect')
  const deploy = workflow.indexOf('run: node scripts/deploy-amazon-sync-functions.mjs')
  const operation = workflow.indexOf('exception.mjs "$RELEASE_MODE"')
  assert.ok(pin >= 0 && inspect > pin && deploy > inspect && operation > deploy)
  assert.equal((workflow.match(/run: node scripts\/deploy-amazon-sync-functions.mjs/g) || []).length, 1)
  assert.doesNotMatch(workflow, /continue-on-error:|if: always\(\)|--include-all|migration repair|db push/)
})
