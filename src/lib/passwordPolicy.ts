export type PasswordCheck = {
  key: 'length' | 'letter' | 'number' | 'common'
  label: string
  passed: boolean
}

export function passwordChecks(password: string): PasswordCheck[] {
  const normalized = password.trim().toLocaleLowerCase('en')
  const commonPasswords = new Set([
    'password123', 'password1234', 'qwerty12345', '1234567890',
    'admin123456', 'sellpert123', 'trendyol123', 'amazon12345',
  ])
  return [
    { key: 'length', label: '10 أحرف على الأقل', passed: password.length >= 10 },
    { key: 'letter', label: 'يحتوي على حرف', passed: /[A-Za-z\u0600-\u06ff]/.test(password) },
    { key: 'number', label: 'يحتوي على رقم', passed: /\d/.test(password) },
    { key: 'common', label: 'ليست كلمة شائعة', passed: !commonPasswords.has(normalized) },
  ]
}

export function isStrongPassword(password: string): boolean {
  return passwordChecks(password).every(check => check.passed)
}
