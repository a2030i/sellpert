export type PasswordCheck = {
  key: 'length' | 'letter' | 'number'
  label: string
  passed: boolean
}

export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { key: 'length', label: '10 أحرف على الأقل', passed: password.length >= 10 },
    { key: 'letter', label: 'يحتوي على حرف', passed: /[A-Za-z\u0600-\u06ff]/.test(password) },
    { key: 'number', label: 'يحتوي على رقم', passed: /\d/.test(password) },
  ]
}

export function isStrongPassword(password: string): boolean {
  return passwordChecks(password).every(check => check.passed)
}
