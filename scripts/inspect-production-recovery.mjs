import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const PROJECT_REF = 'urdyzbsukcuibadlaath'
const ROOT = `https://api.supabase.com/v1/projects/${PROJECT_REF}`

// Metadata only. Never log raw API responses, backup URLs, SQL or credentials.
export function summarizeBackups(body) {
  if (!body || typeof body.pitr_enabled !== 'boolean' || typeof body.walg_enabled !== 'boolean'
    || !Array.isArray(body.backups)) throw new Error('INVALID_BACKUP_METADATA')
  const completed = body.backups.filter(row => row.status === 'COMPLETED'
    && typeof row.inserted_at === 'string' && Number.isFinite(Date.parse(row.inserted_at)))
    .map(row => ({ completed_at: new Date(row.inserted_at).toISOString(), physical: row.is_physical_backup === true }))
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at))
  const physical = body.physical_backup_data
  const timestamp = key => Number.isSafeInteger(physical?.[key]) && physical[key] > 0
    && physical[key] < 253402300800 ? new Date(physical[key] * 1000).toISOString() : null
  return {
    pitr_enabled: body.pitr_enabled, walg_enabled: body.walg_enabled,
    completed_count: completed.length, latest_completed: completed[0] ?? null,
    earliest_physical: timestamp('earliest_physical_backup_date_unix'),
    latest_physical: timestamp('latest_physical_backup_date_unix'),
    // Listing an available backup is not a tested restore or a verified RPO.
    restore_tested: false,
  }
}

export async function inspect({ token, fetchImpl = fetch }) {
  if (!token?.trim() || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('MISSING_CONFIGURATION')
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${ROOT}${path}`, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!response.ok) { await response.body?.cancel(); return { http_status: response.status } }
    return { body: await response.json() }
  }
  const backups = await request('/database/backups')
  const history = await request('/database/query', { method: 'POST', body: JSON.stringify({
    query: 'select version from supabase_migrations.schema_migrations order by version', read_only: true,
  }) })
  let versions = null
  if (history.body) {
    if (!Array.isArray(history.body) || history.body.some(row => !/^\d{14}$/.test(row.version))) throw new Error('INVALID_HISTORY_METADATA')
    versions = history.body.map(row => row.version)
  }
  return {
    project_ref: PROJECT_REF, inspected_at: new Date().toISOString(), production_mutations: false,
    backups: backups.body ? summarizeBackups(backups.body) : { http_status: backups.http_status, verified: false },
    history: versions ? { count: versions.length, versions } : { http_status: history.http_status, verified: false },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await inspect({ token: process.env.SUPABASE_ACCESS_TOKEN })
    await writeFile('production-recovery-inspection.json', JSON.stringify(result, null, 2) + '\n')
    if (result.history.versions) await writeFile('production-migration-list.txt', result.history.versions.map(v => ` | ${v} |`).join('\n'))
    console.log(JSON.stringify({ ...result, history: { ...result.history, versions: undefined } }))
    if (result.backups.http_status || result.history.http_status) process.exitCode = 1
  } catch {
    console.error('Recovery inspection failed; no raw response or credential was logged. No production changes were requested.')
    process.exitCode = 1
  }
}
