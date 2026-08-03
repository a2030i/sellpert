import { describe, expect, it } from 'vitest'
import { registrationErrorMessage } from '../authErrors'

describe('registrationErrorMessage', () => {
  it('explains verification email rate limits without exposing provider codes', () => {
    expect(registrationErrorMessage({ code: 'over_email_send_rate_limit', status: 429 }))
      .toContain('انتظر بضع دقائق')
  })

  it('guides existing merchants to login or recovery', () => {
    expect(registrationErrorMessage({ code: 'user_already_exists' }))
      .toContain('استعادة كلمة المرور')
  })

  it('keeps unknown provider errors merchant friendly', () => {
    const result = registrationErrorMessage({ message: 'internal provider trace 90210' })
    expect(result).toBe('تعذر إنشاء الحساب الآن. حاول مرة أخرى بعد قليل.')
    expect(result).not.toContain('90210')
  })
})

