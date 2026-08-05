import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('merchant command palette navigation', () => {
  const source = readFileSync('src/components/CommandPalette.tsx', 'utf8')

  it('uses the same merchant-facing names as the sidebar', () => {
    for (const label of [
      'مركز القرارات',
      'مركز المتابعة',
      'خطة العمل',
      'الأرباح والتحصيل',
      'الإعلانات والأداء',
      'الربط ورفع الملفات',
      'الفريق والصلاحيات',
      'إعدادات المتجر',
      'الدعم ومركز المعرفة',
    ]) expect(source).toContain(`label: '${label}'`)

    expect(source).not.toContain("label: 'لوحة التحكم'")
    expect(source).not.toContain("label: 'كشف الحساب'")
    expect(source).not.toContain("label: 'المنصات'")
  })

  it('filters employee commands through the central permission check', () => {
    expect(source).toContain('hasMerchantPermission(merchant, command.permission)')
    expect(source).toContain("permission: 'orders'")
    expect(source).toContain("permission: 'integrations'")
    expect(source).toContain("permission: 'team'")
  })
})
