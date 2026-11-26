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
  cli_flag_conflict: /flags in the group|mutually exclusive|LegacyMigration(?:Password|Target)FlagsError/i,
  legacy_database_error: /LegacyDb(?:Connect|Config|Exec)[A-Za-z]*Error|PostgresError|SqlError/i,
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
  const diagnostic = `${stderr}\n${stdout}`.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
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

// Fixed aggregate only. This does not prove direct database-password access.
export async function inspectDatabaseViaManagementApi({ token = process.env.SUPABASE_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  const base = { stage: 'management_database_query', transport: 'management_api_read_only', direct_database_connection_verified: false, migrations_applied: false }
  if (!token) return { ...base, ok: false, required_secret_missing: true }
  try {
    const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'SELECT count(*)::integer AS remote_migration_count, max(version)::text AS latest_remote_version FROM supabase_migrations.schema_migrations',
        read_only: true,
      }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return { ...base, ok: false, http_status: response.status }
    }
    const rows = await response.json()
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null
    if (!row || !Number.isSafeInteger(row.remote_migration_count) || row.remote_migration_count < 1
      || typeof row.latest_remote_version !== 'string' || !/^\d{14}$/.test(row.latest_remote_version)) {
      return { ...base, ok: false, response_shape_valid: false }
    }
    return { ...base, ok: true, project_ref: projectRef, database_metadata_access_verified: true,
      remote_migration_count: row.remote_migration_count, latest_remote_version: row.latest_remote_version }
  } catch {
    return { ...base, ok: false, request_or_response_failed: true }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectReleaseDatabase()
  const log = result.ok ? console.log : console.error
  log(JSON.stringify(result))
  if (!result.ok) {
    const fallback = await inspectDatabaseViaManagementApi()
    const fallbackLog = fallback.ok ? console.log : console.error
    fallbackLog(JSON.stringify(fallback))
    if (!fallback.ok) {
      console.error('Database inspection failed. No CLI diagnostics or connection strings were logged.')
      process.exitCode = 1
    }
  }
}
