import { describe, expect, it } from 'vitest'
import { deleteAmazonConnection, saveAmazonConnection } from '../../../supabase/functions/_shared/amazonConnectionMutex'

const now = Date.parse('2026-11-27T12:00:00Z')
const original = {
  id: 'test-credential', merchant_code: 'M-TEST', platform: 'amazon', seller_id: 'OLD-SELLER',
  updated_at: '2026-11-27T11:00:00Z', extra: { secret_blob: 'synthetic-original-ciphertext' } as Record<string, unknown>,
}
const replacement = {
  merchant_code: 'M-TEST', platform: 'amazon', seller_id: 'NEW-SELLER',
  updated_at: '2026-11-27T12:00:00.000Z', extra: { secret_blob: 'synthetic-new-ciphertext' },
}

function harness(initial: any = original, beforeMutation?: (row: any) => any) {
  let row = initial ? structuredClone(initial) : null
  let mutations = 0
  const admin = { from: () => {
    const filters: Record<string, unknown> = {}
    let mode = 'read'
    let values: Record<string, unknown> = {}
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query },
      update: (value: Record<string, unknown>) => { mode = 'update'; values = value; return query },
      insert: (value: Record<string, unknown>) => { mode = 'insert'; values = value; return query },
      delete: () => { mode = 'delete'; return query },
      maybeSingle: async () => {
        if (mode === 'read') return { data: row ? structuredClone(row) : null, error: null }
        mutations++
        if (beforeMutation) row = beforeMutation(row)
        if (mode === 'insert') {
          if (row) return { data: null, error: { code: '23505' } }
          row = { id: 'inserted-test-credential', ...values }
          return { data: { id: row.id }, error: null }
        }
        if (!row || !Object.entries(filters).every(([key, value]) => row[key] === value)) return { data: null, error: null }
        const id = row.id
        row = mode === 'delete' ? null : { ...row, ...values }
        return { data: { id }, error: null }
      },
    }
    return query
  } }
  return { admin, current: () => row, mutations: () => mutations }
}

describe('Amazon OAuth connection changes and sync leases', () => {
  it.each(['save', 'delete'] as const)('blocks %s while a sync lease is active', async operation => {
    const h = harness({ ...original, extra: { ...original.extra, sync_lock: { id: 'test-lease', expires_at: new Date(now + 120_000).toISOString() } } })
    const action = operation === 'save' ? saveAmazonConnection(h.admin, 'M-TEST', replacement, now) : deleteAmazonConnection(h.admin, 'M-TEST', now)
    await expect(action).rejects.toMatchObject({ status: 409 })
    expect(h.mutations()).toBe(0)
    expect(h.current().seller_id).toBe('OLD-SELLER')
  })

  it.each(['save', 'delete'] as const)('rejects %s if a sync lease is acquired after the snapshot', async operation => {
    const h = harness(original, row => ({ ...row, updated_at: 'lease-revision', extra: { ...row.extra, sync_lock: { id: 'test-lease', expires_at: new Date(now + 120_000).toISOString() } } }))
    const action = operation === 'save' ? saveAmazonConnection(h.admin, 'M-TEST', replacement, now) : deleteAmazonConnection(h.admin, 'M-TEST', now)
    await expect(action).rejects.toMatchObject({ status: 409 })
    expect(h.current().extra.secret_blob).toBe('synthetic-original-ciphertext')
    expect(h.current().extra.sync_lock.id).toBe('test-lease')
  })

  it('replaces an expired lease and encrypted payload together after a matching revision', async () => {
    const h = harness({ ...original, extra: { ...original.extra, sync_lock: { id: 'expired-lease', expires_at: new Date(now - 1).toISOString() } } })
    await saveAmazonConnection(h.admin, 'M-TEST', replacement, now)
    expect(h.current()).toMatchObject(replacement)
    expect(h.current().extra.sync_lock).toBeUndefined()
  })

  it('advances the credential revision even when two writes share the same millisecond', async () => {
    const h = harness({ ...original, updated_at: new Date(now).toISOString() })
    await saveAmazonConnection(h.admin, 'M-TEST', replacement, now)
    expect(Date.parse(h.current().updated_at)).toBe(now + 1)
  })

  it('fails closed on malformed leases', async () => {
    const h = harness({ ...original, extra: { sync_lock: { id: 'bad-lease', expires_at: 'invalid' } } })
    await expect(deleteAmazonConnection(h.admin, 'M-TEST', now)).rejects.toMatchObject({ status: 409 })
    expect(h.mutations()).toBe(0)
  })

  it('never overwrites a competing first connection when its insert loses the unique race', async () => {
    const h = harness(null, () => structuredClone(original))
    await expect(saveAmazonConnection(h.admin, 'M-TEST', replacement, now)).rejects.toMatchObject({ status: 409 })
    expect(h.current().seller_id).toBe('OLD-SELLER')
  })

  it('inserts a first connection and deletes an idle connection', async () => {
    const h = harness(null)
    await saveAmazonConnection(h.admin, 'M-TEST', replacement, now)
    expect(h.current()).toMatchObject(replacement)
    await deleteAmazonConnection(h.admin, 'M-TEST', now)
    expect(h.current()).toBeNull()
    await expect(deleteAmazonConnection(h.admin, 'M-TEST', now)).resolves.toBeUndefined()
  })
})
