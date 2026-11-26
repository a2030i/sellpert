import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const projectRef = 'urdyzbsukcuibadlaath'
const failurePatterns = {
  database_password_rejected: /password authentication failed|SASL auth|SQLSTATE 28P01/i,
  management_permission_denied: /Forbidden|403|permission.*denied|missing.*permission/i,
  authentication_temporarily_blocked: /circuit breaker|too many authentication|authentication.*blocked/i,
  connection_timeout: /timed? ?out|timeout|deadline exceeded/i,
  network_unreachable: /network is unreachable|no such host|ENOTFOUND|EAI_AGAIN|connection refused/i,
  tenant_not_found: /Tenant or user not found/i,
  invalid_migration_timestamp: /parsing time|invalid (?:date|timestamp)|hour out of range|minute out of range|second out of range|invalid time value/i,
  tls_failure: /certificate|SSL.*(?:error|failed|unsupported)|TLS.*(?:error|failed)|does not support SSL/i,
  connection_closed: /unexpected EOF|\bEOF\b|connection (?:reset|closed)|ECONNRESET|EPIPE|server closed/i,
  connection_limit: /too many clients|MaxClientsInSessionMode|remaining connection slots|connection limit|pool.*(?:busy|exhausted)/i,
  database_unavailable: /database.*(?:paused|unavailable|does not exist)|SQLSTATE 57P03/i,
  unsupported_cli_option: /unknown flag|unknown option|unrecognized (?:flag|option|argument)/i,
  project_config_error: /cannot find project ref|not linked|config\.toml|failed to parse config/i,
  migration_history_mismatch: /Remote migration versions not found|local migration files.*before the last migration/i,
  missing_history_table: /schema_migrations.*does not exist|SQLSTATE 42P01/i,
  cli_internal_error: /panic:|TypeError|RangeError|ReferenceError|SyntaxError|stack trace/i,
}

export function classifyInspectionFailure(error) {
  // Some CLI versions emit structured failures on stdout. Inspect both streams,
  // but return only fixed keys/booleans: never messages, URLs, SQL, or captures.
  const stderr = String(error?.stderr || '')
  const stdout = String(error?.stdout || '')
  const diagnostic = `${stderr}\n${stdout}`
  return {
    exit: Number.isInteger(error?.status) ? error.status : null,
    stdout_present: stdout.length > 0,
    stderr_present: stderr.length > 0,
    process_timeout: error?.code === 'ETIMEDOUT',
    executable_unavailable: error?.code === 'ENOENT',
    ...Object.fromEntries(Object.entries(failurePatterns).map(([key, pattern]) => [key, pattern.test(diagnostic)])),
  }
}

export function inspectReleaseDatabase({ env = process.env, runCli = args => execFileSync('supabase', args, {
  encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'],
}) } = {}) {
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_DB_PASSWORD) {
    return { ok: false, stage: 'configuration', required_secret_missing: true }
  }
  let cliVersion = null
  let cliAgentFlagSupported = false
  let stage = 'cli_version'
  try {
    const version = String(runCli(['--version'])).trim()
    cliVersion = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version) ? version : null
    stage = 'cli_help'
    cliAgentFlagSupported = /--agent\b/.test(String(runCli(['--help'])))
    stage = 'link'
    runCli(['link', '--project-ref', projectRef, '--password', env.SUPABASE_DB_PASSWORD])
    stage = 'migration_list'
    const output = String(runCli(['migration', 'list', '--linked', '--password', env.SUPABASE_DB_PASSWORD]))
    const versions = [...new Set(output.split(/\r?\n/).flatMap(line => {
      const columns = line.split(/[│|]/)
      const match = columns[1]?.match(/\b\d{14}\b/)
      return match ? [match[0]] : []
    }))].sort()
    if (!versions.length) {
      return { ok: false, stage: 'history_parse', cli_version: cliVersion, cli_agent_flag_supported: cliAgentFlagSupported, migrations_applied: false }
    }
    return {
      ok: true, project_ref: projectRef, cli_version: cliVersion, cli_agent_flag_supported: cliAgentFlagSupported,
      database_connection_verified: true, remote_migration_count: versions.length,
      latest_remote_version: versions.at(-1), migrations_applied: false,
    }
  } catch (error) {
    return {
      ok: false, stage, cli_version: cliVersion, cli_agent_flag_supported: cliAgentFlagSupported,
      ...classifyInspectionFailure(error), migrations_applied: false,
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectReleaseDatabase()
  const log = result.ok ? console.log : console.error
  log(JSON.stringify(result))
  if (!result.ok) {
    console.error('Database inspection failed. No CLI diagnostics or connection strings were logged.')
    process.exitCode = 1
  }
}
