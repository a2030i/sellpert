import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadProductCatalog, productsInSelectedScope } from './productCatalogLoad'
import { ACCOUNT_FACT_TABLES, sellingAccountDataClient } from './marketplaceDataScope'

const rows = Array.from({ length: 1744 }, (_, id) => ({ id: String(id), product_channel_mappings: [{ marketplace_account_id: 'account-one' }] }))
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const client = (fetch: typeof globalThis.fetch) => createClient('https://catalog.example.test', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
})

afterEach(() => vi.useRealTimers())

describe('complete product catalog loading', () => {
  it('counts each canonical product once and keeps legacy and connected scopes separate', () => {
    const make = (id: string, accounts: string[]) => ({ id, product_channel_mappings: accounts.map(marketplace_account_id => ({ marketplace_account_id })) })
    const records = [make('old',['legacy']),make('new',['active']),make('shared',['active','second']),make('manual',[])]
    const select = (accountIds: string[], includeUnassigned = false) => productsInSelectedScope(records as Parameters<typeof productsInSelectedScope>[0], { accountIds, includeUnassigned }).map(p => p.id)
    expect(select(['legacy'],true)).toEqual(['old','manual'])
    expect(select(['active'])).toEqual(['new','shared'])
    expect(select(['active','second'])).toEqual(['new','shared'])
    expect(select([])).toEqual([])
  })
  it('retains account filters on all supporting facts for a connected Trendyol account', async () => {
    const requests: URL[] = []
    const db = sellingAccountDataClient(client(async input => {
      requests.push(new URL(String(input)))
      return json([])
    }), 'M-TEST', ['account-one'])
    await loadProductCatalog(db, 'M-TEST', true, new AbortController().signal, { accountIds: ['account-one'], includeUnassigned: false })
    expect(requests).toHaveLength(7)
    const facts = requests.filter(url => ACCOUNT_FACT_TABLES.has(url.pathname.split('/').pop()!))
    expect(facts).toHaveLength(5)
    expect(facts.every(url => url.searchParams.get('marketplace_account_id') === 'in.(account-one)')).toBe(true)
    expect(requests.find(url => url.pathname.endsWith('/products'))?.searchParams.has('marketplace_account_id')).toBe(false)
  })

  it('reads beyond 1000 products and skips unused legacy Trendyol operations', async () => {
    const requests: URL[] = []
    const db = client(async input => {
      const url = new URL(String(input)); requests.push(url)
      const from = Number(url.searchParams.get('offset'))
      return json(url.pathname.endsWith('/products') ? rows.slice(from, from + 1000) : [])
    })
    const result = await loadProductCatalog(db, 'M-TEST', false, new AbortController().signal, { accountIds: ['account-one'], includeUnassigned: false })
    expect(result.productRows).toHaveLength(1744)
    expect(result.productRows[result.productRows.length - 1]?.id).toBe('1743')
    expect(requests.filter(url => url.pathname.endsWith('/products')).map(url => url.searchParams.get('offset'))).toEqual(['0', '1000'])
    expect(requests.some(url => /inventory|product_platform_listings|product_channel_mappings/.test(url.pathname))).toBe(false)
    expect(requests.filter(url => !url.pathname.endsWith('/platform_fee_categories')).every(url => url.searchParams.get('merchant_code') === 'eq.M-TEST')).toBe(true)
  })

  it('rejects a failed later page instead of exposing a partial catalog', async () => {
    const db = client(async input => {
      const url = new URL(String(input))
      if (!url.pathname.endsWith('/products')) return json([])
      return Number(url.searchParams.get('offset')) === 0
        ? json(rows.slice(0, 1000)) : json({ message: 'permission denied', code: '42501' }, 403)
    })
    await expect(loadProductCatalog(db, 'M-TEST', false, new AbortController().signal, { accountIds: ['account-one'], includeUnassigned: false })).rejects.toThrow('صلاحية')
  })

  it('bounds the entire paginated load, aborting a slow second page and its sibling', async () => {
    vi.useFakeTimers()
    const cancelled: string[] = []
    const db = client(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/products') && Number(url.searchParams.get('offset')) === 0) {
        await new Promise(resolve => setTimeout(resolve, 700))
        return json(rows.slice(0, 1000))
      }
      if (!url.pathname.endsWith('/products') && !url.pathname.endsWith('/product_platform_prices')) return json([])
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => { cancelled.push(url.pathname); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      })
    })
    const result = loadProductCatalog(db, 'M-TEST', false, new AbortController().signal, { accountIds: ['account-one'], includeUnassigned: false }, 1000)
    const rejected = expect(result).rejects.toThrow('مهلة')
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expect(cancelled.sort()).toEqual(['/rest/v1/product_platform_prices', '/rest/v1/products'])
  })

  it('cancels network requests when the owning account load is discarded', async () => {
    const controller = new AbortController()
    let requests = 0
    let cancellations = 0
    const db = client(async (_input, init) => {
      requests++
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => { cancellations++; reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      })
    })
    const result = loadProductCatalog(db, 'M-TEST', true, controller.signal, { accountIds: ['account-one'], includeUnassigned: false })
    const rejected = expect(result).rejects.toThrow()
    await vi.waitFor(() => expect(requests).toBe(7))
    controller.abort()
    await rejected
    expect(cancellations).toBe(7)
  })
})
