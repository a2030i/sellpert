import { describe, expect, it } from 'vitest'
import { userErrorMessage } from '../userError'

describe('userErrorMessage', () => {
  it('hides RLS and database implementation details', () => {
    const result = userErrorMessage({ message: 'new row violates row-level security policy for table "orders"', code: '42501' })
    expect(result).toBe('لا تملك صلاحية تنفيذ هذه العملية على المتجر المحدد.')
    expect(result).not.toContain('orders')
  })

  it('hides JSON and object serialization failures', () => {
    expect(userErrorMessage('[object Object]')).toBe('تعذّر إتمام العملية الآن. حاول مرة أخرى.')
    expect(userErrorMessage('{"error":"internal"}')).toBe('تعذّر إتمام العملية الآن. حاول مرة أخرى.')
  })

  it('maps connection and session failures to an action', () => {
    expect(userErrorMessage('Failed to fetch')).toContain('تحقق من الإنترنت')
    expect(userErrorMessage({ message: 'JWT expired', status: 401 })).toContain('سجّل الدخول')
  })

  it('keeps deliberate Arabic business messages', () => {
    expect(userErrorMessage('لا يمكن حذف آخر مدير للمتجر')).toBe('لا يمكن حذف آخر مدير للمتجر')
  })

  it('supports a contextual fallback without exposing unknown provider text', () => {
    expect(userErrorMessage('Unexpected upstream provider failure', 'تعذّر حفظ المنتج.')).toBe('تعذّر حفظ المنتج.')
  })
})

