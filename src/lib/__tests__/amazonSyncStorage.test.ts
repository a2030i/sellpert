import { describe, expect, it } from 'vitest'
import { acquireAmazonSyncLease, persistAmazonPage, recomputeAmazonOrderFees, saveAmazonSyncState } from '../../../supabase/functions/_shared/amazonSyncStorage'

function fixture() {
  const state = {
    orders: new Map<string, { fee: number }>([['O1', { fee: 99 }], ['O2', { fee: 77 }]]),
    transactions: new Map<string, { transaction_no: string; order_id: string; raw: unknown }>(),
    failFee: false, cursor: 0, reads: 0,
    credential: { id: 'C1', is_active: true, updated_at: '2026-11-27T00:00:00Z', extra: { secret_blob: 'encrypted-original' } } as Record<string, any>,
    beforeUpdate: undefined as (() => void) | undefined,
  }
  const tx = (id: string, fee = -1) => ({ transaction_no: id, order_id: 'O1', raw: {
    relatedIdentifiers: [{ relatedIdentifierName: 'ORDER_ID', relatedIdentifierValue: 'O1' }],
    breakdowns: [{ breakdownType: 'AmazonFees', breakdownAmount: { currencyAmount: fee } }],
  } })
  const admin = { from(table: string) {
    const filters: Record<string, any> = {}
    let values: any, action = 'select', offset = 0, end = 999
    const builder: any = {
      select() { return builder }, eq(key: string, value: any) { filters[key] = value; return builder },
      gt() { return builder }, in(key: string, value: any) { filters[key] = value; return builder },
      order() { return builder }, range(start: number, last: number) { offset = start; end = last; return builder },
      update(value: any) { action = 'update'; values = value; return builder },
      upsert(value: any) { action = 'upsert'; values = value; return builder },
      maybeSingle() { return run() }, then(resolve: any, reject: any) { return run().then(resolve, reject) },
    }
    async function run() {
      if (table === 'platform_credentials') {
        if (action === 'update') state.beforeUpdate?.()
        const row = state.credential
        const matches = Object.entries(filters).every(([key,value]) =>
          (key === 'extra->sync_lock->>id' ? row.extra.sync_lock?.id : row[key]) === value)
        if (!matches) return { data: null, error: null }
        if (action === 'update') Object.assign(row, values)
        return { data: structuredClone(row), error: null }
      }
      if (table === 'account_transactions') {
        if (action === 'upsert') { for (const row of values) state.transactions.set(row.transaction_no, row); return { error: null } }
        state.reads++
        return { data: [...state.transactions.values()].filter(row => filters.order_id.includes(row.order_id)).slice(offset,end+1), error: null }
      }
      if (table === 'orders' && action === 'update') {
        if (state.failFee) return { data: null, error: new Error('Simulated write failure') }
        const row = state.orders.get(filters.order_id)
        if (row) row.fee = values.platform_fee
        return { data: row ? [{ id: filters.order_id }] : [], error: null }
      }
      return { error: null }
    }
    return builder
  } }
  return { admin, state, tx }
}

describe('Amazon page reconciliation', () => {
  it('includes more than 1000 transactions and preserves orders without API finance records', async () => {
    const { admin, state, tx } = fixture()
    for (let i=0;i<1005;i++) state.transactions.set(String(i),tx(String(i)))
    expect(await recomputeAmazonOrderFees(admin, 'M1', ['O1','O2'])).toBe(1)
    expect(state.reads).toBe(2)
    expect(state.orders.get('O1')?.fee).toBe(1005)
    expect(state.orders.get('O2')?.fee).toBe(77)
  })

  it('retries persisted transactions after fee failure without advancing or double counting', async () => {
    const { admin, state, tx } = fixture()
    const checkpoint = async () => { state.cursor++ }
    state.failFee = true
    await expect(persistAmazonPage(admin,'M1',{transactions:[tx('T1',-5)]},checkpoint)).rejects.toThrow('Simulated')
    expect(state.cursor).toBe(0)
    expect(state.transactions.size).toBe(1)
    state.failFee = false
    await persistAmazonPage(admin,'M1',{transactions:[tx('T1',-5)]},checkpoint)
    expect(state.cursor).toBe(1)
    expect(state.transactions.size).toBe(1)
    expect(state.orders.get('O1')?.fee).toBe(5)
  })

  it('reconciles a late arriving order against already stored transactions', async () => {
    const { admin, state, tx } = fixture()
    state.transactions.set('T1',tx('T1',-8))
    await persistAmazonPage(admin,'M1',{orders:[{order_id:'O1'}]},async()=>{})
    expect(state.orders.get('O1')?.fee).toBe(8)
  })
})

describe('Amazon connection run ownership', () => {
  it('only one run can acquire a credential revision', async () => {
    const { admin, state } = fixture()
    const original = structuredClone(state.credential)
    await acquireAmazonSyncLease(admin, original)
    await expect(acquireAmazonSyncLease(admin, original)).rejects.toMatchObject({status:409})
    await expect(acquireAmazonSyncLease(admin, structuredClone(state.credential))).rejects.toMatchObject({status:409})
  })

  it('rejects malformed locks and advances same-millisecond revisions', async () => {
    const { admin, state } = fixture()
    const now = new Date(state.credential.updated_at)
    await acquireAmazonSyncLease(admin, structuredClone(state.credential), now)
    expect(Date.parse(state.credential.updated_at)).toBe(now.getTime()+1)
    state.credential.extra.sync_lock = {id:'damaged',expires_at:'invalid'}
    await expect(acquireAmazonSyncLease(admin, structuredClone(state.credential))).rejects.toMatchObject({status:409})
  })

  it('never restores stale ciphertext if reconnect happens between cursor read and update', async () => {
    const { admin, state } = fixture()
    const lease = await acquireAmazonSyncLease(admin, structuredClone(state.credential))
    state.beforeUpdate = () => { state.credential.extra = { secret_blob:'encrypted-new' }; state.beforeUpdate=undefined }
    await expect(saveAmazonSyncState(admin,lease,{version:3})).rejects.toMatchObject({status:409})
    expect(state.credential.extra).toEqual({secret_blob:'encrypted-new'})
  })

  it('never advances or releases a replacement connection', async () => {
    const { admin, state } = fixture()
    const lease = await acquireAmazonSyncLease(admin, structuredClone(state.credential))
    state.credential.is_active=false
    await expect(saveAmazonSyncState(admin,lease,{version:3})).rejects.toMatchObject({status:409})
    expect(state.credential.extra.sync).toBeUndefined()
  })
})
