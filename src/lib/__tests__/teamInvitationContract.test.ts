import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('merchant team invitation contract', () => {
  const edge = readFileSync('supabase/functions/create-employee/index.ts', 'utf8')
  const team = readFileSync('src/pages/Team.tsx', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')
  const passwordSetup = readFileSync('src/pages/PasswordRecovery.tsx', 'utf8')

  it('lets the employee choose their own password from a trusted invite', () => {
    expect(edge).toContain('auth.admin.inviteUserByEmail(email')
    expect(edge).toContain("new URL('/auth/recovery?flow=invite', APP_URL)")
    expect(edge).not.toContain('auth.admin.createUser({')
    expect(edge).not.toContain("action === 'reset_password'")
    expect(edge).not.toContain("error: createErr.message")
    expect(edge).toContain('تعذر إرسال الدعوة عبر البريد الآن')
    expect(team).not.toContain('form.password')
    expect(team).toContain('إرسال دعوة آمنة')
  })

  it('sends recovery only for an employee owned by the authenticated store', () => {
    expect(edge).toContain("action === 'send_recovery'")
    expect(edge).toContain("emp.owner_merchant_code !== callerMerchant.merchant_code")
    expect(edge).toContain('resetPasswordForEmail(emp.email')
    expect(team).toContain("action: 'send_recovery'")
  })

  it('routes invite links to employee-owned password setup', () => {
    expect(app).toContain("type === 'recovery' || type === 'invite'")
    expect(app).toContain("setPasswordSetupMode(type === 'invite' ? 'invite' : 'recovery')")
    expect(passwordSetup).toContain("mode?: 'recovery' | 'invite'")
    expect(passwordSetup).toContain('تم قبول دعوتك إلى فريق المتجر')
  })
})
