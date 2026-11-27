import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const PROJECT = 'urdyzbsukcuibadlaath'
export const FUNCTIONS = ['manage-marketplace-accounts','amazon-connect','manage-platform-credentials','sync-amazon','sync-trendyol','salla-sync','salla-oauth-callback','salla-webhook','trendyol-webhook','trendyol-actions','queue-worker']
const ROOT = new URL('./releases/coordinated-20261127/', import.meta.url)
const REPO = new URL('../', import.meta.url)
const API = `https://api.supabase.com/v1/projects/${PROJECT}`
export const digest = data => createHash('sha256').update(data).digest('hex')

export async function readBundle(expected, read = readFile) {
  const raw = await read(new URL('execution-manifest.json', ROOT))
  if (!/^[a-f0-9]{64}$/.test(expected || '') || digest(raw) !== expected) throw new Error('MANIFEST_MISMATCH')
  const manifest = JSON.parse(raw)
  if (manifest.project !== PROJECT || manifest.backup_check !== 'explicitly_waived_by_owner'
    || JSON.stringify(manifest.functions) !== JSON.stringify(FUNCTIONS)) throw new Error('SCOPE_MISMATCH')
  for (const [path, sha] of Object.entries(manifest.files)) {
    if (path.includes('..') || path.startsWith('/') || digest(await read(new URL(path, REPO))) !== sha) throw new Error('ARTIFACT_MISMATCH')
  }
  return manifest
}

export function requireWorkflowSource(env = process.env, exec = execFileSync) {
  const head = exec('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  if (env.GITHUB_REPOSITORY !== 'a2030i/sellpert' || env.GITHUB_REF !== 'refs/heads/fix/operational-reliability'
    || !/^[a-f0-9]{40}$/.test(head) || head !== env.GITHUB_SHA) throw new Error('SOURCE_MISMATCH')
  return head
}

async function management(token, path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, redirect:'error',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, signal:AbortSignal.timeout(240_000) })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`MANAGEMENT_HTTP_${response.status}`) }
  return response.json()
}
async function sql(token, query) {
  // Deployment uses the direct postgres actor. Only committed, hash-verified
  // operations or the fixed metadata queries below can reach this function.
  return management(token,'/database/query',{method:'POST',body:JSON.stringify({query,read_only:false})})
}
async function fileSql(token, name) { console.log(JSON.stringify({phase:name})); return sql(token,await readFile(new URL(name,ROOT),'utf8')) }
function cli(args) {
  try { return execFileSync('supabase',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:600_000}) }
  catch { throw new Error('CLI_FAILED_INSPECT_STATE_BEFORE_RETRY') }
}
function powerShellGuard() {
  try { execFileSync('pwsh',['-NoProfile','-File','scripts/Test-SupabaseMigrationParity.ps1'],{stdio:['ignore','pipe','pipe'],timeout:120_000}) }
  catch { throw new Error('UNCHANGED_PARITY_GUARD_FAILED') }
}
const delay = ms => new Promise(resolve => setTimeout(resolve,ms))

export async function publicFrontend() {
  const response = await fetch('https://app.sellpert.com/?release-inspection=1',{redirect:'error',signal:AbortSignal.timeout(30_000),cache:'no-store'})
  if (!response.ok || !response.headers.get('content-security-policy')) throw new Error('FRONTEND_UNAVAILABLE_OR_HEADERS_MISSING')
  const html = await response.text()
  const paths = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^" ]+\.js)"/g)].map(match => match[1])
  let code = ''
  for (const path of paths) {
    const url = new URL(path,'https://app.sellpert.com')
    if (url.origin !== 'https://app.sellpert.com') continue
    const asset = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30_000)})
    if (!asset.ok) throw new Error('FRONTEND_ASSET_FAILED')
    code += await asset.text()
  }
  let publicKey
  for (const match of code.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload=JSON.parse(Buffer.from(match[0].split('.')[1],'base64url'))
      if (payload.role==='anon' && payload.ref===PROJECT) publicKey=match[0]
    } catch { /* Ignore non-JWT literals. */ }
  }
  if (!publicKey) throw new Error('PUBLIC_CLIENT_KEY_NOT_FOUND')
  // This is an already-public browser key. It is never printed or persisted.
  return {code,publicKey}
}
async function verifyApiGate(publicKey, maintenance) {
  const response=await fetch(`https://${PROJECT}.supabase.co/rest/v1/orders?select=id&limit=0`,{
    headers:{apikey:publicKey,Authorization:`Bearer ${publicKey}`},redirect:'error',signal:AbortSignal.timeout(30_000)})
  await response.body?.cancel()
  // Anonymous users lack USAGE on the private hook schema and stay denied.
  if (maintenance ? ![401,403,503].includes(response.status) : ![401,403].includes(response.status)) throw new Error('DATA_API_GATE_VERIFICATION_FAILED')
}

async function verifyBefore(token) {
  const rows=await fileSql(token,'inspect-before.sql')
  if (!Array.isArray(rows) || rows.length!==1 || Object.values(rows[0]).some(value=>value!==true)) throw new Error('PRE_RELEASE_STATE_CHANGED')
}
async function state(token) {
  const rows=await sql(token,"select maintenance,schema_verified,handlers_verified,source_commit,(select count(*) from supabase_migrations.schema_migrations) as history_count from security.sellpert_release_control where singleton")
  if (!Array.isArray(rows) || rows.length!==1) throw new Error('RELEASE_STATE_MISSING')
  return rows[0]
}
async function verifyFinalSchema(token, manifest) {
  const rows=await fileSql(token,'verify-final.sql')
  if (!Array.isArray(rows) || rows.length!==1 || Object.values(rows[0]).some(value=>value!==true)) throw new Error('FINAL_SCHEMA_VERIFICATION_FAILED')
  const history=await sql(token,'select version from supabase_migrations.schema_migrations order by version')
  if (JSON.stringify(history.map(x=>x.version))!==JSON.stringify(manifest.all_versions)) throw new Error('FINAL_HISTORY_SET_MISMATCH')
}

export async function run(dispatch, env = process.env) {
  if (!['inspect','apply','resume'].includes(dispatch.mode)) throw new Error('INVALID_MODE')
  const head=requireWorkflowSource(env)
  const manifest=await readBundle(dispatch.manifest_sha256)
  const token=env.SUPABASE_ACCESS_TOKEN
  if (!token?.trim() || env.NODE_TLS_REJECT_UNAUTHORIZED==='0') throw new Error('MISSING_CONFIGURATION')
  const front=await publicFrontend()
  if (dispatch.mode==='inspect') {
    const project=await management(token,'')
    if (project.id!==PROJECT || project.status!=='ACTIVE_HEALTHY') throw new Error('PROJECT_NOT_READY')
    await verifyBefore(token)
    return {mode:'inspect',source_commit:head,passed:true,backup_check:'owner waived',production_mutations:false}
  }
  if (dispatch.mode==='apply') {
    if (!env.SUPABASE_DB_PASSWORD) throw new Error('MISSING_DB_PASSWORD')
    await verifyBefore(token)
    await fileSql(token,'enter.sql')
    await sql(token,`update security.sellpert_release_control set source_commit='${head}' where singleton`)
    // Wait for the config reload and old short-lived requests to drain.
    await delay(20_000)
    await verifyApiGate(front.publicKey,true)
    await sql(token,`do $$ begin if not exists(select 1 from pg_roles r cross join lateral unnest(r.rolconfig) s where r.rolname='authenticator' and s='pgrst.db_pre_request=security.require_current_release') then raise exception 'HOOK_NOT_REGISTERED'; end if; begin perform security.require_current_release(); raise exception 'GATE_NOT_ACTIVE'; exception when sqlstate 'PT503' then null; end; end $$;`)
    await fileSql(token,'recover.sql')
    const verification=await fileSql(token,'recovery-inspect.sql')
    if (!verification?.some(row=>row.history_reconciled===true && row.maintenance===true)) throw new Error('RECOVERY_VERIFICATION_FAILED')
    cli(['link','--project-ref',PROJECT])
    powerShellGuard()
    cli(['db','push','--linked','--dry-run'])
    cli(['db','push','--linked','--yes'])
    await verifyFinalSchema(token,manifest)
    await sql(token,'update security.sellpert_release_control set schema_verified=true where singleton')
    const before=await management(token,'/functions')
    for (const slug of FUNCTIONS) {
      cli(['functions','deploy',slug,'--project-ref',PROJECT,'--use-api'])
      console.log(JSON.stringify({deployed:slug}))
    }
    const after=await management(token,'/functions')
    const versions={}
    for (const slug of FUNCTIONS) {
      const previous=before.find(x=>x.slug===slug);const current=after.find(x=>x.slug===slug)
      if (!current || current.status!=='ACTIVE' || (previous && Number(current.version)<=Number(previous.version))) throw new Error('FUNCTION_VERSION_NOT_VERIFIED')
      versions[slug]=current.version
    }
    powerShellGuard()
    await sql(token,'update security.sellpert_release_control set handlers_verified=true where singleton')
    const result={mode:'apply',source_commit:head,backend_ready:true,maintenance:true,function_versions:versions,history_count:manifest.all_versions.length}
    await writeFile('coordinated-release-receipt.json',JSON.stringify(result,null,2)+'\n')
    return result
  }
  if (!/^[a-f0-9]{40}$/.test(dispatch.frontend_commit||'') || !/^[a-f0-9]{40}$/.test(dispatch.backend_commit||'')) throw new Error('RESUME_SOURCE_REQUIRED')
  const current=await state(token)
  if (!current.maintenance || !current.schema_verified || !current.handlers_verified || current.source_commit!==dispatch.backend_commit) throw new Error('BACKEND_NOT_READY')
  if (!front.code.includes(dispatch.frontend_commit) || !front.code.includes('sellpert-accounts-v1')) throw new Error('FRONTEND_RELEASE_NOT_VERIFIED')
  await verifyFinalSchema(token,manifest)
  await fileSql(token,'resume.sql')
  await verifyApiGate(front.publicKey,false)
  return {mode:'resume',frontend_commit:dispatch.frontend_commit,backend_commit:dispatch.backend_commit,maintenance:false,passed:true}
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await run(JSON.parse(await readFile(new URL('dispatch.json',ROOT),'utf8'))))) }
  catch(error) {
    // Never log raw SQL, CLI diagnostics, management responses or credentials.
    const code=/^[A-Z][A-Z0-9_]+$/.test(error?.message||'')?error.message:'RELEASE_REQUEST_FAILED'
    console.error(`${code}: inspect the release state before retrying; maintenance is not automatically lifted after an uncertain mutation.`)
    process.exitCode=1
  }
}
