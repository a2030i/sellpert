import { describe, expect, it } from 'vitest'
import { safeErrorCode, sanitizeIncidentPath, sanitizeIncidentToken } from '../clientIncident'

describe('client incident privacy boundary', () => {
  it('removes query strings, hashes, and record identifiers from paths', () => {
    expect(sanitizeIncidentPath('/product-detail/550e8400-e29b-41d4-a716-446655440000?token=secret#raw'))
      .toBe('/product-detail/:id')
    expect(sanitizeIncidentPath('/orders/11344951785')).toBe('/orders/:id')
  })

  it('keeps only bounded operational tokens', () => {
    expect(sanitizeIncidentToken('Product Detail / customer@example.com', 'application')).toBe('productdetailcustomerexample.com')
    expect(sanitizeIncidentToken('TypeError: private customer data', 'unknown_error')).toBe('typeerror')
    expect(sanitizeIncidentToken('', 'unknown_error')).toBe('unknown_error')
  })

  it('classifies errors without retaining their messages', () => {
    expect(safeErrorCode(new Error('Failed to fetch https://secret.example/token'))).toBe('network_failure')
    expect(safeErrorCode(new TypeError('customer email leaked here'))).toBe('typeerror')
  })
})
