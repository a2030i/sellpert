import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const PROJECT_REF = 'urdyzbsukcuibadlaath'
const ROOT = new URL('./releases/amazon-sync-20261127/', import.meta.url)
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
const MESSAGES = Object.freeze({
  SOURCE: 'The reviewed source commit must exactly match the main workflow commit and checked-out HEAD. Nothing was sent.',
  INPUT: 'Use inspect, verify, or apply with the exact reviewed manifest digest.',
  ARTIFACT: 'Release artifacts differ from the reviewed manifest. Nothing was sent.',
  CONFIG: 'Required deployment configuration is missing or unsafe.',
  REQUEST: 'Release request failed. No provider response or credential was logged.',
  SHAPE: 'Unexpected verification result. No provider response was logged.',
  PRECONDITION: 'Release preconditions failed. No migration was requested.',
  VERIFY: 'Post-release verification failed. Inspect before taking another action.',
  VERIFY_UNCERTAIN: 'The migration request succeeded but its verification could not complete. Do not retry the migration; run verify and inspect the database first.',
  UNCERTAIN: 'Migration request did not complete reliably. Do not retry; run verify and inspect the database first.',
})

export class ReleaseError extends Error {
  constructor(code, status) {
    super(MESSAGES[code] || MESSAGES.REQUEST)
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'REQUEST'
    this.status = Number.isInteger(status) && status >= 100 && status < 600 ? status : undefined
  }
}

export function safeFailure(error) {
  if (!(error instanceof ReleaseError)) return MESSAGES.REQUEST
  return `${error.code}: ${MESSAGES[error.code]}${error.status ? ` (HTTP ${error.status})` : ''}`
}

export const sha256 = value => createHash('sha256').update(value).digest('hex')

export function assertReviewedSource(pin) {
  const { reviewedCommit, eventCommit, headCommit, ref } = pin || {}
  if (ref !== 'refs/heads/main' || ![reviewedCommit, eventCommit, headCommit].every(value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value))
    || reviewedCommit !== eventCommit || reviewedCommit !== headCommit) throw new ReleaseError('SOURCE')
  return reviewedCommit
}

export function sourcePinFromEnvironment(env = process.env, git = execFileSync) {
  let headCommit
  try { headCommit = git('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { throw new ReleaseError('SOURCE') }
  const pin = { reviewedCommit: env.REVIEWED_SOURCE_COMMIT, eventCommit: env.GITHUB_SHA, headCommit, ref: env.GITHUB_REF }
  assertReviewedSource(pin)
  return pin
}


export async function readBundle(approvedDigest, read = readFile) {
  if (!/^[a-f0-9]{64}$/.test(approvedDigest || '')) throw new ReleaseError('INPUT')
  const raw = await read(new URL('manifest.json', ROOT))
  if (sha256(raw) !== approvedDigest) throw new ReleaseError('ARTIFACT')
  let manifest
  try { manifest = JSON.parse(raw.toString()) } catch { throw new ReleaseError('ARTIFACT') }
  if (manifest.project_ref !== PROJECT_REF || manifest.migration_version !== '20261127090000') {
    throw new ReleaseError('ARTIFACT')
  }
  for (const mode of ['inspect', 'verify']) {
    const keys = manifest.checks?.[mode]
    if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length
      || keys.some(key => typeof key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(key))) throw new ReleaseError('ARTIFACT')
  }
  const files = {}
  for (const name of ['inspect.sql', 'apply.sql', 'verify.sql']) {
    const bytes = await read(new URL(name, ROOT))
    if (sha256(bytes) !== manifest.files?.[name]) throw new ReleaseError('ARTIFACT')
    files[name] = bytes.toString()
  }
  return { manifest, files }
}

async function query({ token, sql, fetchImpl, keys, mutation = false }) {
  try {
    const response = await fetchImpl(API, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // The API's read_only transport switches to supabase_read_only_user.
      // The approved SQL deliberately verifies the postgres deployment actor.
      // Inspections remain the exact hash-verified SELECT-only files; this flag
      // selects the actor and does not add any SQL or authorize another file.
      body: JSON.stringify({ query: sql, read_only: false, disable_statement_timeout: false }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ReleaseError(mutation ? 'UNCERTAIN' : 'REQUEST', response.status)
    }
    if (mutation) {
      // The transaction has its own assertions; verify through a fresh request.
      // Never log or parse an SQL error payload as an execution receipt.
      await response.body?.cancel()
      return
    }
    const body = await response.json()
    if (!Array.isArray(body) || body.length !== 1 || !body[0]
      || typeof body[0] !== 'object' || Array.isArray(body[0])) throw new ReleaseError('SHAPE')
    // Only the immutable SQL's Boolean verification fields are accepted.
    const values = Object.values(body[0])
    if (Object.keys(body[0]).length !== keys.length || keys.some(key => !Object.hasOwn(body[0], key))
      || values.some(value => typeof value !== 'boolean')) throw new ReleaseError('SHAPE')
    return values.every(Boolean)
  } catch (error) {
    if (error instanceof ReleaseError) throw error
    throw new ReleaseError(mutation ? 'UNCERTAIN' : 'REQUEST')
  }
}

export async function release({ mode, digest, token, fetchImpl = fetch, read = readFile, sourcePin }) {
  if (!['inspect', 'verify', 'apply'].includes(mode)) throw new ReleaseError('INPUT')
  if (mode === 'apply') assertReviewedSource(sourcePin)
  if (!token?.trim() || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new ReleaseError('CONFIG')
  const { files, manifest } = await readBundle(digest, read)
  const verify = mode === 'verify'
  const passed = await query({ token, sql: files[verify ? 'verify.sql' : 'inspect.sql'], keys: manifest.checks[verify ? 'verify' : 'inspect'], fetchImpl })
  if (!passed) throw new ReleaseError(verify ? 'VERIFY' : 'PRECONDITION')
  if (mode === 'apply') {
    await query({ token, sql: files['apply.sql'], fetchImpl, mutation: true })
    let verified
    try {
      verified = await query({ token, sql: files['verify.sql'], keys: manifest.checks.verify, fetchImpl })
    } catch (error) {
      throw new ReleaseError('VERIFY_UNCERTAIN', error instanceof ReleaseError ? error.status : undefined)
    }
    if (!verified) throw new ReleaseError('VERIFY')
  }
  return { project_ref: PROJECT_REF, mode, passed: true, migration_verified: mode !== 'inspect', manifest_sha256: digest }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, digest, ...extra] = process.argv.slice(2)
    if (extra.length) throw new ReleaseError('INPUT')
    console.log(JSON.stringify(await release({ mode, digest, token: process.env.SUPABASE_ACCESS_TOKEN, sourcePin: mode === 'apply' ? sourcePinFromEnvironment() : undefined })))
  } catch (error) {
    console.error(safeFailure(error))
    process.exitCode = 1
  }
}
