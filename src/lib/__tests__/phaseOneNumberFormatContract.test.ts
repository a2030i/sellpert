import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const phaseOneFiles = [
  'src/App.tsx',
  'src/pages/DashboardV2.tsx',
  'src/pages/Orders.tsx',
  'src/pages/Products.tsx',
  'src/pages/Inventory.tsx',
  'src/pages/Integrations.tsx',
  'src/components/OnboardingFlow.tsx',
]

describe('phase-one number formatting', () => {
  it('uses Latin digits explicitly instead of the device numeric system', () => {
    for (const file of phaseOneFiles) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toContain("'ar-SA'")
      expect(source, file).not.toMatch(/\.toLocaleString\(\)/)
    }
  })

  it('keeps merchant-facing dates Gregorian with Latin digits', () => {
    const dashboard = readFileSync('src/pages/DashboardV2.tsx', 'utf8')
    expect(dashboard).toContain('ar-SA-u-ca-gregory-nu-latn')
  })

  it('shows only out-of-stock products in the dashboard inventory KPI', () => {
    const dashboard = readFileSync('src/pages/DashboardV2.tsx', 'utf8')
    expect(dashboard).toContain('label="منتجات نافدة"')
    expect(dashboard).toContain("value={loading?'—':number(outStock)}")
    expect(dashboard).not.toContain('lowStock')
    expect(dashboard).not.toContain('مخزون منخفض أو نافد')
  })
})
