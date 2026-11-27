import { amazonFeeByOrder } from './amazonOrders.ts'
import { HttpError } from './sync.ts'
import { assertAmazonSarAmounts } from './amazonCurrency.ts'

const SOURCE = 'sp_api'

export async function upsertAmazonRows(admin: any, table: string, rows: any[], onConflict: string) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from(table).upsert(rows.slice(index, index + 100), { onConflict })
    if (error) throw error
  }
}

/** Read every transaction, including orders with more than one Data API page. */
export async function recomputeAmazonOrderFees(admin: any, merchantCode: string, orderIds: string[]) {
  let updated = 0
  const ids = [...new Set(orderIds)]
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100)
    const fees = new Map<string, number>()
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from('account_transactions').select('raw')
        .eq('merchant_code', merchantCode).eq('platform', 'amazon').in('order_id', chunk)
        .eq('raw->>sellpertSource', SOURCE).order('transaction_no').range(offset, offset + 999)
      if (error) throw error
      assertAmazonSarAmounts(data)
      for (const [orderId, amount] of amazonFeeByOrder((data || []).map((row: any) => row.raw))) {
        fees.set(orderId, (fees.get(orderId) || 0) + amount)
      }
      if ((data || []).length < 1000) break
    }
    // A missing SP-API transaction is not evidence that an order's fee is zero.
    const updates = chunk.filter(orderId => fees.has(orderId))
    for (let start = 0; start < updates.length; start += 25) {
      const results = await Promise.all(updates.slice(start, start + 25).map(orderId => admin.from('orders')
        .update({ platform_fee: Math.max(0, Math.round((fees.get(orderId) || 0) * 100) / 100) })
        .eq('merchant_code', merchantCode).eq('platform', 'amazon').eq('order_id', orderId).select('id')))
      for (const { data, error } of results) {
        if (error) throw error
        updated += data?.length || 0
      }
    }
  }
  return updated
}

/** Cursor advancement is last: retrying a failed page repeats idempotent writes and fee reconciliation. */
export async function persistAmazonPage(admin: any, merchantCode: string,
  page: { orders?: any[]; items?: any[]; transactions?: any[] }, checkpoint: () => Promise<void>) {
  // Validate the entire page before its first write, including nested raw money.
  assertAmazonSarAmounts(page)
  const orders = page.orders || []
  const items = page.items || []
  const transactions = [...new Map((page.transactions || []).map(row => [row.transaction_no, row])).values()]
  await upsertAmazonRows(admin, 'orders', orders, 'merchant_code,platform,order_id')
  await upsertAmazonRows(admin, 'order_items', items, 'merchant_code,platform,order_id,line_id')
  await upsertAmazonRows(admin, 'account_transactions', transactions, 'merchant_code,platform,transaction_no')
  const touched = [...orders, ...transactions].map(row => row.order_id).filter(Boolean)
  const feeOrders = await recomputeAmazonOrderFees(admin, merchantCode, touched)
  await checkpoint()
  return feeOrders
}

/** Short renewable run lease in existing JSON metadata; no secret material is returned to clients. */
export async function acquireAmazonSyncLease(admin: any, credential: any, now = new Date()) {
  const existing = credential.extra?.sync_lock
  if (existing != null && (typeof existing.id !== 'string' || !existing.id
    || typeof existing.expires_at !== 'string' || !Number.isFinite(Date.parse(existing.expires_at))
    || Date.parse(existing.expires_at) > now.getTime())) {
    throw new HttpError(409, 'مزامنة أمازون قيد التشغيل، حاول لاحقًا')
  }
  if (!credential.updated_at) throw new HttpError(409, 'تعذر حجز المزامنة، حاول لاحقًا')
  const lock = { id: crypto.randomUUID(), expires_at: new Date(now.getTime() + 120_000).toISOString() }
  const revision = new Date(Math.max(now.getTime(), Date.parse(credential.updated_at) + 1)).toISOString()
  const { data, error } = await admin.from('platform_credentials').update({
    extra: { ...credential.extra, sync_lock: lock }, updated_at: revision,
  }).eq('id', credential.id).eq('is_active', true).eq('updated_at', credential.updated_at)
    .select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(409, 'تغير ربط أمازون أو بدأت مزامنة أخرى، حاول لاحقًا')
  return { credentialId: credential.id, lockId: lock.id }
}

export type AmazonSyncLease = { credentialId: string; lockId: string }

export async function readAmazonSyncLease(admin: any, lease: AmazonSyncLease) {
  const { data, error } = await admin.from('platform_credentials').select('extra')
    .eq('id', lease.credentialId).eq('is_active', true).eq('extra->sync_lock->>id', lease.lockId)
    .gt('extra->sync_lock->>expires_at', new Date().toISOString()).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(409, 'تغير ربط أمازون أثناء المزامنة، أعد المحاولة')
  return data.extra
}

export async function saveAmazonSyncState(admin: any, lease: AmazonSyncLease, state: unknown,
  finished?: { last_sync_at: string; records_synced: number }) {
  const extra = await readAmazonSyncLease(admin, lease)
  const next = { ...extra, sync: state }
  if (finished) delete next.sync_lock
  const { data, error } = await admin.from('platform_credentials').update({
    extra: next, updated_at: new Date().toISOString(), ...finished,
  }).eq('id', lease.credentialId).eq('is_active', true).eq('extra->sync_lock->>id', lease.lockId)
    .gt('extra->sync_lock->>expires_at', new Date().toISOString())
    .select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(409, 'تغير ربط أمازون أثناء المزامنة، أعد المحاولة')
}
