import { HttpError } from './sync.ts'

function changedConnection() {
  return new HttpError(409, 'تغير ربط أمازون أثناء العملية، أعد المحاولة')
}

/** A sync lease protects the credential identity until all of its writes stop. */
async function editableConnection(admin: any, merchantCode: string, now: number) {
  const { data: current, error } = await admin.from('platform_credentials')
    .select('id,updated_at,extra').eq('merchant_code', merchantCode).eq('platform', 'amazon').maybeSingle()
  if (error) throw error
  if (!current) return null
  const lock = current.extra?.sync_lock
  if (lock != null) {
    const expiresAt = typeof lock.expires_at === 'string' ? Date.parse(lock.expires_at) : NaN
    // A malformed lock is not evidence that an in-flight worker has stopped.
    if (!Number.isFinite(expiresAt) || typeof lock.id !== 'string' || !lock.id || expiresAt > now) {
      throw new HttpError(409, 'مزامنة أمازون قيد التنفيذ، انتظر قليلًا ثم أعد المحاولة')
    }
  }
  if (typeof current.updated_at !== 'string' || !current.updated_at) throw changedConnection()
  return current
}

/** Compare-and-set against the same revision checked for an active sync lease. */
export async function saveAmazonConnection(admin: any, merchantCode: string, values: Record<string, unknown>, now = Date.now()) {
  const current = await editableConnection(admin, merchantCode, now)
  const table = admin.from('platform_credentials')
  const revision = new Date(Math.max(now, current ? Date.parse(current.updated_at) + 1 : now)).toISOString()
  const updated = { ...values, updated_at: revision }
  const mutation = current
    ? table.update(updated).eq('id', current.id).eq('updated_at', current.updated_at)
    : table.insert(updated)
  const { data, error } = await mutation.select('id').maybeSingle()
  if (error?.code === '23505') throw changedConnection()
  if (error) throw error
  if (!data) throw changedConnection()
}

export async function deleteAmazonConnection(admin: any, merchantCode: string, now = Date.now()) {
  const current = await editableConnection(admin, merchantCode, now)
  if (!current) return
  const { data, error } = await admin.from('platform_credentials').delete()
    .eq('id', current.id).eq('updated_at', current.updated_at).select('id').maybeSingle()
  if (error) throw error
  if (!data) throw changedConnection()
}
