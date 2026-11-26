import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyInspectionFailure, inspectReleaseDatabase } from './inspect-release-database.mjs'

const secret = 'PRIVATE_SENTINEL_NOT_FOR_LOGS'
const env = { SUPABASE_ACCESS_TOKEN: secret, SUPABASE_DB_PASSWORD: secret }

test('classifies timestamp failures from stdout without exposing diagnostic content', () => {
  const result = classifyInspectionFailure({ status: 1, stdout: `{"error":"parsing time: hour out of range ${secret}"}`, stderr: '' })
  assert.equal(result.invalid_migration_timestamp, true)
  assert.equal(result.stdout_present, true)
  assert.equal(result.stderr_present, false)
  assert.ok(!JSON.stringify(result).includes(secret))
})

test('failure classification permits only fixed booleans and exit code, including credential-shaped diagnostics', () => {
  const result = classifyInspectionFailure({
    status: 1, code: 'ETIMEDOUT', message: secret,
    stderr: `postgres://user:${secret}@private.example/db: password authentication failed; SSL certificate failed`,
    stdout: `unexpected EOF ${secret}`,
  })
  assert.equal(result.database_password_rejected, true)
  assert.equal(result.tls_failure, true)
  assert.equal(result.connection_closed, true)
  assert.equal(result.process_timeout, true)
  assert.ok(Object.entries(result).every(([key, value]) => key === 'exit' ? value === 1 : typeof value === 'boolean'))
  for (const value of [secret, 'private.example', 'postgres://']) assert.ok(!JSON.stringify(result).includes(value))
})

test('inspection uses only version/help/link/history and parses both table separator variants', () => {
  for (const separator of ['|', '│']) {
    const calls = []
    const result = inspectReleaseDatabase({ env, runCli: args => {
      calls.push(args)
      if (args[0] === '--version') return '2.111.0\n'
      if (args[0] === '--help') return '--agent yes/no'
      if (args[0] === 'link') return secret
      return ` Local ${separator} Remote ${separator} Time\n 20260803294200 ${separator} 20260818183744 ${separator} unused\n ${separator} 20260421195927 ${separator} unused\n`
    } })
    assert.equal(result.ok, true)
    assert.equal(result.remote_migration_count, 2)
    assert.equal(result.latest_remote_version, '20260818183744')
    assert.equal(result.cli_agent_flag_supported, true)
    assert.deepEqual(calls.map(args => args[0]), ['--version', '--help', 'link', 'migration'])
    assert.ok(!JSON.stringify(result).includes(secret))
  }
})

test('failed history read reports stage and allowlisted metadata, never thrown command or streams', () => {
  const result = inspectReleaseDatabase({ env, runCli: args => {
    if (args[0] === '--version') return '2.111.0'
    if (args[0] === '--help' || args[0] === 'link') return secret
    throw { status: 1, stdout: `unknown flag ${secret}`, stderr: `Tenant or user not found ${secret}`, message: secret }
  } })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'migration_list')
  assert.equal(result.unsupported_cli_option, true)
  assert.equal(result.tenant_not_found, true)
  assert.ok(!JSON.stringify(result).includes(secret))
})

test('missing configuration and unparseable history fail closed without making data changes', () => {
  assert.equal(inspectReleaseDatabase({ env: {}, runCli: () => { throw Error('must not run') } }).stage, 'configuration')
  const result = inspectReleaseDatabase({ env, runCli: args => args[0] === '--version' ? secret : secret })
  assert.equal(result.stage, 'history_parse')
  assert.equal(result.cli_version, null)
  assert.equal(result.migrations_applied, false)
  assert.ok(!JSON.stringify(result).includes(secret))
})
