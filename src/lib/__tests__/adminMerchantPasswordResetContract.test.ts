import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('admin merchant password reset contract', () => {
  const edge = readFileSync('supabase/functions/admin-reset-merchant-password/index.ts', 'utf8')
  const merchantsView = readFileSync('src/pages/admin/MerchantsView.tsx', 'utf8')
  const supabaseConfig = readFileSync('supabase/config.toml', 'utf8')

  it('performs the password mutation only in a JWT-protected Edge Function', () => {
    expect(supabaseConfig).toContain('[functions.admin-reset-merchant-password]')
    expect(supabaseConfig).toMatch(/\[functions\.admin-reset-merchant-password\]\s+verify_jwt = true/)
    expect(edge).toContain("admin.auth.getUser(token)")
    expect(edge).toContain("['admin', 'super_admin'].includes(callerAccount.role)")
    expect(edge).toContain("target.role !== 'merchant'")
    expect(edge).toContain('admin.auth.admin.updateUserById(target.id')
    expect(merchantsView).not.toContain('auth.admin.updateUserById')
  })

  it('requires the shared strong-password policy and explicit confirmation', () => {
    expect(edge).toContain('isStrongAccountPassword(body?.password)')
    expect(merchantsView).toContain('isStrongPassword(passwordEditor.password)')
    expect(merchantsView).toContain('passwordEditor.password !== passwordEditor.confirmation')
    expect(merchantsView).toContain('كلمتا المرور غير متطابقتين')
  })

  it('records a password-free audit event', () => {
    const auditInsert = edge.slice(edge.indexOf("from('audit_log').insert"), edge.indexOf('if (auditError)'))
    expect(edge).toContain("table_name: 'auth_security'")
    expect(edge).toContain("new_values: { event: 'password_changed_by_admin' }")
    expect(auditInsert).not.toContain('body.password')
    expect(auditInsert).not.toMatch(/password\s*:/i)
    expect(edge).not.toMatch(/return json\(\{[^}]*password/i)
  })

  it('exposes the action only to platform managers in the merchant table', () => {
    expect(merchantsView).toContain("['admin', 'super_admin'].includes(currentUser?.role)")
    expect(merchantsView).toContain('/functions/v1/admin-reset-merchant-password')
    expect(merchantsView).toContain('تغيير كلمة مرور التاجر مباشرة')
    expect(merchantsView).toContain('دون إرسال بريد')
  })
})
