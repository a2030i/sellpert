import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { decryptCredentialPayload, encryptCredentialPayload, legacyCredentialMaterial } from '../_shared/credentialVault.ts'
import { authorizeInternalWorker } from '../_shared/webhookSecurity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BATCH_SIZE   = 10
const JOB_TIMEOUT  = 55000

// Maps platform -> Edge Function slug
const PLATFORM_FUNCTION: Record<string, string> = {
  salla:    'salla-sync',
  trendyol: 'sync-trendyol',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return ok({ skipped: true })

  const bearerToken = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  const queueSecret = req.headers.get('x-queue-secret') || ''
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: secretSetting } = await admin.from('app_settings').select('value')
    .eq('key', 'QUEUE_WORKER_SECRET').maybeSingle()
  const configuredSecret = String(secretSetting?.value || '')
  // The anon key is intentionally not authorization: it is public in every
  // browser client. Cron uses a dedicated random secret; internal jobs may use
  // the service-role token.
  const authorized = authorizeInternalWorker(bearerToken, queueSecret, SERVICE_KEY, configuredSecret)
  if (!authorized) return ok({ ok: false, error: 'Unauthorized' }, 401)

  const startedAt = Date.now()

  try {
    const credentialsSealed = await sealLegacyCredentials(admin).catch(error => {
      console.error('[queue-worker] Credential sealing failed:', error?.message || 'unknown error')
      return 0
    })
    const { data: jobs, error: pickErr } = await admin
      .rpc('process_sync_queue', { batch_size: BATCH_SIZE })

    if (pickErr) {
      console.error('process_sync_queue error:', pickErr)
      return ok({ ok: false, error: pickErr.message })
    }

    if (!jobs || jobs.length === 0) {
      return ok({ ok: true, processed: 0, credentials_sealed: credentialsSealed, message: 'Queue empty' })
    }

    console.log(`[queue-worker] Processing ${jobs.length} jobs`)

    const results = await Promise.allSettled(
      jobs.map((job: any) => processJob(admin, job))
    )

    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as any)?.success).length
    const failed    = results.length - succeeded
    const elapsed   = Date.now() - startedAt

    console.log(`[queue-worker] Done: ${succeeded} ok, ${failed} failed, ${elapsed}ms`)
    return ok({ ok: true, processed: jobs.length, succeeded, failed, credentials_sealed: credentialsSealed, elapsed_ms: elapsed })

  } catch (e: any) {
    console.error('[queue-worker] Fatal:', e)
    return ok({ ok: false, error: e.message }, 500)
  }
})

async function sealLegacyCredentials(admin: any) {
  let sealed = 0
  for (const table of ['platform_credentials']) {
    const { data: rows, error } = await admin.from(table)
      .select('id,api_key,api_secret,extra,updated_at')
    if (error) throw error

    for (const row of rows || []) {
      const legacy = legacyCredentialMaterial(row)
      if (!legacy) continue
      const existing = await decryptCredentialPayload(row.extra?.secret_blob)
      const secretBlob = await encryptCredentialPayload({ ...existing, ...legacy.secret })
      let update = admin.from(table).update({
        api_key: null,
        api_secret: null,
        extra: { ...legacy.publicExtra, secret_blob: secretBlob },
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      if (row.updated_at) update = update.eq('updated_at', row.updated_at)
      const { data: updated, error: updateError } = await update.select('id').maybeSingle()
      if (updateError) throw updateError
      if (updated) sealed += 1
    }
  }
  return sealed
}

async function processJob(admin: any, job: any): Promise<{ success: boolean; error?: string }> {
  const { id, merchant_code, job_type, platform, payload } = job

  const fnSlug = PLATFORM_FUNCTION[platform]
  if (!fnSlug) {
    // Unknown platform — mark done, don't block queue
    console.warn(`[queue-worker] Unknown platform "${platform}" for job ${id} — skipping`)
    await admin.rpc('complete_queue_job', { job_id: id, success: true, err_msg: null })
    return { success: true }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), JOB_TIMEOUT)

    // Build body based on platform
    let body: Record<string, any> = { merchant_code }
    if (platform === 'salla') {
      body = { merchant_code, job_type: job_type || 'sync_all', payload: payload || {} }
    } else {
      // Trendyol — pass date range from payload if present
      body = {
        merchant_code,
        date_from: payload?.date_from || null,
        date_to:   payload?.date_to   || null,
      }
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnSlug}`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    const data = await res.json().catch(() => ({}))

    if (res.status === 403 && data?.error === 'ACCOUNT_SUSPENDED') {
      // Administratively suspended account — don't retry until reactivated.
      await admin.rpc('complete_queue_job', { job_id: id, success: true, err_msg: null })
      console.log(`[queue-worker] Skipped ${merchant_code} — account access suspended`)
      return { success: true }
    }

    if (!res.ok || data?.ok === false) {
      const errMsg = data?.error || `HTTP ${res.status}`
      await admin.rpc('complete_queue_job', { job_id: id, success: false, err_msg: errMsg })
      console.warn(`[queue-worker] Job ${id} (${platform}) failed: ${errMsg}`)
      return { success: false, error: errMsg }
    }

    await admin.rpc('complete_queue_job', { job_id: id, success: true, err_msg: null })
    console.log(`[queue-worker] Job ${id} (${platform}/${merchant_code}) ✓ orders=${data.orders ?? '?'}`)
    return { success: true }

  } catch (e: any) {
    const errMsg = e.name === 'AbortError' ? 'Job timeout' : e.message
    await admin.rpc('complete_queue_job', { job_id: id, success: false, err_msg: errMsg })
    console.error(`[queue-worker] Job ${id} exception: ${errMsg}`)
    return { success: false, error: errMsg }
  }
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
