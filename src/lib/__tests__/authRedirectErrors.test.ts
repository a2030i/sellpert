import { describe, expect, it } from 'vitest'
import { authRedirectErrorMessage, cleanAuthRedirectUrl } from '../authErrors'

describe('Auth redirect errors', () => {
  it('explains expired links without exposing provider text', () => {
    const message = authRedirectErrorMessage({
      pathname: '/', search: '',
      hash: '#error=access_denied&error_code=otp_expired&error_description=Provider%20details',
    })
    expect(message).toContain('انتهت صلاحية')
    expect(message).not.toContain('Provider')
  })

  it('explains a failed token-hash verification', () => {
    expect(authRedirectErrorMessage({
      pathname: '/', search: '?auth_error=verification_failed', hash: '',
    })).toContain('غير صالح')
  })

  it('cleans auth errors while preserving unrelated query parameters', () => {
    expect(cleanAuthRedirectUrl({
      pathname: '/auth/recovery',
      search: '?source=email&error_code=otp_expired',
      hash: '#error=access_denied&error_description=expired',
    })).toBe('/?source=email')
  })

  it('does not treat normal navigation as an auth error', () => {
    const location = { pathname: '/products', search: '?tab=analytics', hash: '#section' }
    expect(authRedirectErrorMessage(location)).toBe('')
    expect(cleanAuthRedirectUrl(location)).toBe('/products?tab=analytics#section')
  })
})
