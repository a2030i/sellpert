export type PasswordCheck = {
  key: 'length' | 'letter' | 'number' | 'symbol' | 'common'
  label: string
  passed: boolean
}

export const PASSWORD_POLICY_MESSAGE = 'كلمة المرور يجب أن تكون من 12 إلى 128 حرفًا وتحتوي على حرف ورقم ورمز، وألا تكون كلمة شائعة'

const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', 'password123!', 'qwerty12345',
  '1234567890', '123456789012', 'admin123456', 'admin123456!',
  'sellpert123', 'sellpert123!', 'trendyol123', 'trendyol123!',
  'amazon12345', 'amazon12345!',
])

export function passwordChecks(password: string): PasswordCheck[] {
  const normalized = password.trim().toLocaleLowerCase('en')
  return [
    { key: 'length', label: 'من 12 إلى 128 حرفًا', passed: password.length >= 12 && password.length <= 128 },
    { key: 'letter', label: 'يحتوي على حرف', passed: /\p{L}/u.test(password) },
    { key: 'number', label: 'يحتوي على رقم', passed: /\d/.test(password) },
    { key: 'symbol', label: 'يحتوي على رمز', passed: /[^\p{L}\p{N}\s]/u.test(password) },
    { key: 'common', label: 'ليست كلمة شائعة', passed: !COMMON_PASSWORDS.has(normalized) },
  ]
}

export function isStrongPassword(password: string): boolean {
  return passwordChecks(password).every(check => check.passed)
}
