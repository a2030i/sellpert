import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const INSPECT_SHA256 = '5a1bc95e79de761b913e7a526b0b73fba63f6b58344b2984c274cb9e8d7bce9d'
export const CHECK_KEYS = Object.freeze([
  'expected_actor', 'original_225_history_unchanged', 'import_wrapper_unchanged',
  'authorization_dependencies_unchanged', 'import_options_and_acl_expected',
  'app_settings_browser_denied', 'history_count_225', 'amazon_version_absent',
  'amazon_objects_absent', 'atomic_import_baseline_exact',
  'platform_constraint_baseline_exact', 'credential_constraints_applicable',
])
const API = 'https://api.supabase.com/v1/projects/urdyzbsukcuibadlaath/database/query'
const ACTOR_KEYS = ['current_role_category', 'session_role_category', 'current_role_sha256', 'search_path_sha256', 'current_role_superuser', 'current_role_bypass_rls', 'row_security_on']
const ROLES = ['postgres', 'supabase_admin', 'supabase_read_only_user', 'service_role', 'authenticated', 'anon', 'other']
const ACTOR_SQL = `SELECT
 CASE WHEN current_user IN ('postgres','supabase_admin','supabase_read_only_user','service_role','authenticated','anon') THEN current_user::text ELSE 'other' END AS current_role_category,
 CASE WHEN session_user IN ('postgres','supabase_admin','supabase_read_only_user','service_role','authenticated','anon') THEN session_user::text ELSE 'other' END AS session_role_category,
 encode(sha256(convert_to(current_user::text,'UTF8')),'hex') AS current_role_sha256,
 encode(sha256(convert_to(current_setting('search_path'),'UTF8')),'hex') AS search_path_sha256,
 coalesce((SELECT rolsuper FROM pg_roles WHERE rolname=current_user),false) AS current_role_superuser,
 coalesce((SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user),false) AS current_role_bypass_rls,
 current_setting('row_security')='on' AS row_security_on`

function safeFailure(code, status) {
  return { ok: false, diagnostic: code, ...(Number.isInteger(status) ? { http_status: status } : {}), mutations_requested: false }
}
async function query(token, sql, fetchImpl, readOnly = true) {
  const response = await fetchImpl(API, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly, disable_statement_timeout: false }),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw { safeCode: 'HTTP', status: response.status }
  }
  const body = await response.json()
  if (!Array.isArray(body) || body.length !== 1 || !body[0] || typeof body[0] !== 'object' || Array.isArray(body[0])) throw { safeCode: 'SHAPE' }
  return body[0]
}
export async function inspectAmazonPreconditions({ token, sql, fetchImpl = fetch }) {
  if (!token?.trim() || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return safeFailure('CONFIG')
  if (createHash('sha256').update(sql).digest('hex') !== INSPECT_SHA256) return safeFailure('INSPECT_HASH')
  let checks
  try {
    const row = await query(token, sql, fetchImpl)
    if (Object.keys(row).length !== CHECK_KEYS.length || CHECK_KEYS.some(key => typeof row[key] !== 'boolean')) return safeFailure('CHECK_SHAPE')
    checks = Object.fromEntries(CHECK_KEYS.map(key => [key, row[key]]))
  } catch (error) {
    return safeFailure(error?.safeCode === 'HTTP' ? 'INSPECT_HTTP' : 'INSPECT_REQUEST', error?.safeCode === 'HTTP' ? error.status : undefined)
  }
  const result = { ok: true, inspect_sha256: INSPECT_SHA256, checks, preconditions_passed: Object.values(checks).every(Boolean), mutations_requested: false }
  const actorByTransport = {}
  // The second transport still executes only this hardcoded metadata SELECT.
  // Neither the approved inspect SQL nor any user input can enter this branch.
  for (const readOnly of [true, false]) {
    const transport = readOnly ? 'read_only_true' : 'read_only_false_fixed_select'
    try {
      const actor = await query(token, ACTOR_SQL, fetchImpl, readOnly)
      const valid = Object.keys(actor).length === ACTOR_KEYS.length
        && ACTOR_KEYS.every(key => Object.hasOwn(actor, key))
        && ROLES.includes(actor.current_role_category) && ROLES.includes(actor.session_role_category)
        && ['current_role_sha256', 'search_path_sha256'].every(key => typeof actor[key] === 'string' && /^[a-f0-9]{64}$/.test(actor[key]))
        && ['current_role_superuser', 'current_role_bypass_rls', 'row_security_on'].every(key => typeof actor[key] === 'boolean')
      actorByTransport[transport] = valid ? Object.fromEntries(ACTOR_KEYS.map(key => [key, actor[key]])) : { diagnostic: 'SHAPE' }
    } catch (error) {
      actorByTransport[transport] = { diagnostic: error?.safeCode === 'HTTP' ? 'HTTP' : 'REQUEST', ...(error?.safeCode === 'HTTP' ? { http_status: error.status } : {}) }
    }
  }
  return { ...result, actor_by_transport: actorByTransport }

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result
  try {
    const sql = await readFile(new URL('./releases/amazon-20261126/inspect.sql', import.meta.url), 'utf8')
    result = await inspectAmazonPreconditions({ token: process.env.SUPABASE_ACCESS_TOKEN, sql })
  } catch { result = safeFailure('LOCAL_FILE') }
  console.log(JSON.stringify(result))
  if (!result.ok) process.exitCode = 1
}
