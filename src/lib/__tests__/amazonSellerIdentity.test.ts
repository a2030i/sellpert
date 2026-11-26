import { describe, expect, it, vi } from 'vitest'
import { verifyAmazonSellerIdentity } from '../../../supabase/functions/_shared/amazonSpApi'

const sellerId = 'A1B2C3D4E5F6G7'
const marketplaceId = 'A17E79C6D8DWNP'
const safeError = 'Amazon seller identity verification failed'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Amazon seller identity verification', () => {
  it.each([
    { numberOfResults: 0, items: [] },
    { numberOfResults: 25, items: [{ sku: 'sample-sku', summaries: [{ itemName: 'Private listing' }] }] },
  ])('accepts valid seller-scoped results and returns no listing data: %j', async body => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body))
    await expect(verifyAmazonSellerIdentity('test-access-token', sellerId, marketplaceId, 'eu', fetchMock)).resolves.toBeUndefined()
    const [requestUrl, init] = fetchMock.mock.calls[0]
    const url = new URL(requestUrl)
    expect(url.origin).toBe('https://sellingpartnerapi-eu.amazon.com')
    expect(url.pathname).toBe(`/listings/2021-08-01/items/${sellerId}`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ marketplaceIds: marketplaceId, pageSize: '1', includedData: 'summaries' })
    expect(init.headers['x-amz-access-token']).toBe('test-access-token')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses the supplied seller route so a mismatched seller authorization is denied', async () => {
    const differentSeller = 'A9B8C7D6E5F4G3'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname.endsWith(`/${sellerId}`)
      ? jsonResponse({ numberOfResults: 0, items: [] })
      : jsonResponse({ errors: [{ message: 'sensitive-provider-details' }] }, 403))
    await expect(verifyAmazonSellerIdentity('test-access-token', differentSeller, marketplaceId, 'eu', fetchMock))
      .rejects.toMatchObject({ status: 403, message: safeError })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('encodes route and query values without allowing extra parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ numberOfResults: 0, items: [] }))
    // The handler validates these inputs first; encoding also protects the helper boundary.
    await verifyAmazonSellerIdentity('test-access-token', 'seller/id?x=1', 'market&id=2', 'eu', fetchMock)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/listings/2021-08-01/items/seller%2Fid%3Fx%3D1')
    expect(url.searchParams.get('marketplaceIds')).toBe('market&id=2')
    expect(url.searchParams.has('id')).toBe(false)
    expect(url.searchParams.has('x')).toBe(false)
  })

  it.each([null, {}, { numberOfResults: '0', items: [] }, { numberOfResults: -1, items: [] },
    { numberOfResults: 1, items: [{}] }, { numberOfResults: 0, items: [{ sku: 'x' }] },
    { numberOfResults: 2, items: [{ sku: 'x' }, { sku: 'y' }] },
  ])('fails closed on malformed successful responses: %j', async body => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body))
    await expect(verifyAmazonSellerIdentity('test-access-token', sellerId, marketplaceId, 'eu', fetchMock))
      .rejects.toMatchObject({ status: 502, message: safeError })
  })

  it.each([400, 403, 404, 429, 500])('rejects HTTP %i without returning provider error content', async status => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'secret-echo' }] }, status))
    await expect(verifyAmazonSellerIdentity('test-access-token', sellerId, marketplaceId, 'eu', fetchMock))
      .rejects.toMatchObject({ status: status === 403 ? 403 : 502, message: safeError })
  })

  it('rejects invalid JSON without returning response text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('sensitive-invalid-json', { status: 200 }))
    await expect(verifyAmazonSellerIdentity('test-access-token', sellerId, marketplaceId, 'eu', fetchMock))
      .rejects.toMatchObject({ status: 502, message: safeError })
  })

  it('converts transport and timeout errors into a safe failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('sensitive-request-details'))
    await expect(verifyAmazonSellerIdentity('test-access-token', sellerId, marketplaceId, 'eu', fetchMock))
      .rejects.toMatchObject({ status: 502, message: safeError })
  })
})
