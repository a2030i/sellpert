import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('inventory provider payload access', () => {
  it('keeps browser inventory reads on normalized columns', () => {
    const inventory = readFileSync('src/pages/Inventory.tsx', 'utf8')
    const quickInventory = readFileSync('src/pages/QuickInventory.tsx', 'utf8')
    const productDetail = readFileSync('src/pages/ProductDetail.tsx', 'utf8')
    for (const source of [inventory, quickInventory, productDetail]) {
      expect(source).not.toMatch(/from\('inventory'\)\.select\('\*'\)/)
    }
    expect(inventory).toContain("select(INVENTORY_SAFE_COLUMNS)")
    expect(quickInventory).toContain("select(INVENTORY_SAFE_COLUMNS)")
    expect(productDetail).toContain("select(INVENTORY_SAFE_COLUMNS)")
  })

  it('does not use product provider payloads in merchant components', () => {
    const productDetail = readFileSync('src/pages/ProductDetail.tsx', 'utf8')
    const wizard = readFileSync('src/components/TrendyolPublishWizard.tsx', 'utf8')
    const catalog = readFileSync('src/lib/trendyolCatalog.ts', 'utf8')
    expect(productDetail).not.toContain('product.raw')
    expect(wizard).not.toContain('product.raw')
    expect(catalog).not.toContain('product.raw')
  })
})
