import test from 'node:test'
import assert from 'node:assert/strict'
import { inspect, summarizeBackups } from './inspect-production-recovery.mjs'

test('backup summary excludes unexpected fields and does not assert a tested restore', () => {
  const result = summarizeBackups({ pitr_enabled: false, walg_enabled: true, backup_url: 'PRIVATE', backups: [
    { status: 'COMPLETED', inserted_at: '2026-11-26T01:00:00Z', is_physical_backup: true, url: 'PRIVATE' },
    { status: 'FAILED', inserted_at: '2026-11-27T01:00:00Z' },
  ] })
  assert.equal(result.completed_count, 1)
  assert.equal(result.latest_completed.completed_at, '2026-11-26T01:00:00.000Z')
  assert.equal(result.restore_tested, false)
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})
test('missing and malformed backup metadata fail closed', () => {
  assert.throws(() => summarizeBackups({ backups: [] }))
  assert.equal(summarizeBackups({ pitr_enabled: false, walg_enabled: false, backups: [] }).latest_completed, null)
})
test('inspection only requests backup listing and read-only version metadata', async () => {
  const calls = []
  const result = await inspect({ token: 'test-token', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify(url.endsWith('/backups')
      ? { pitr_enabled: true, walg_enabled: true, backups: [] }
      : [{ version: '20261127090000' }]), { status: 200 })
  } })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].options.method, undefined)
  assert.equal(JSON.parse(calls[1].options.body).read_only, true)
  assert.equal(result.production_mutations, false)
  assert.equal(result.history.count, 1)
})
test('HTTP failures expose only status, never provider error bodies', async () => {
  const result = await inspect({ token: 'test-token', fetchImpl: async () => new Response('PRIVATE', { status: 403 }) })
  assert.equal(result.backups.http_status, 403)
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})
test('invalid migration versions cannot be passed to parity parser', async () => {
  await assert.rejects(inspect({ token: 'test-token', fetchImpl: async url => new Response(JSON.stringify(
    url.endsWith('/backups') ? { pitr_enabled: false, walg_enabled: false, backups: [] } : [{ version: 'unsafe' }]
  )) }))
})
