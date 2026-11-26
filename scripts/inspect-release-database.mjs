import { execFileSync } from 'node:child_process'

const projectRef = 'urdyzbsukcuibadlaath'
if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_DB_PASSWORD) {
  console.error('Required deployment secret is missing.')
  process.exit(1)
}

function run(stage, args) {
  try {
    return execFileSync('supabase', args, {
      encoding: 'utf8', timeout: 90_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    // CLI diagnostics may contain connection strings. Never print the exception,
    // command, stdout or stderr; GitHub masking is not our only protection.
    const diagnostic = String(error.stderr || '')
    const indicators = {
      database_password_rejected: /password authentication failed|SASL auth|SQLSTATE 28P01/i.test(diagnostic),
      management_permission_denied: /Forbidden|403|permission.*denied|missing.*permission/i.test(diagnostic),
      connection_timeout: /timed? ?out|timeout|deadline exceeded/i.test(diagnostic),
      network_unreachable: /network is unreachable|no such host|ENOTFOUND|connection refused/i.test(diagnostic),
      tenant_not_found: /Tenant or user not found/i.test(diagnostic),
    }
    console.error(JSON.stringify({ stage, exit: Number.isInteger(error.status) ? error.status : null, ...indicators }))
    console.error('Database inspection failed. No CLI diagnostics or connection strings were logged.')
    process.exit(1)
  }
}

run('link', ['link', '--project-ref', projectRef, '--password', process.env.SUPABASE_DB_PASSWORD])
const output = run('migration_list', ['migration', 'list', '--linked', '--password', process.env.SUPABASE_DB_PASSWORD])
const versions = [...new Set(output.split(/\r?\n/).flatMap(line => {
  const columns = line.split(/[│|]/)
  const match = columns[1]?.match(/\b\d{14}\b/)
  return match ? [match[0]] : []
}))].sort()
if (!versions.length) {
  console.error('Remote history could not be parsed; no database changes were requested.')
  process.exit(1)
}
console.log(JSON.stringify({ project_ref: projectRef, database_connection_verified: true, remote_migration_count: versions.length, latest_remote_version: versions.at(-1), migrations_applied: false }))
