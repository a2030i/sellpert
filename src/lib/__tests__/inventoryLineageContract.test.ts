import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260805040550_inventory_data_lineage.sql', 'utf8')
const trendyolSync = readFileSync('supabase/functions/_shared/trendyolProducts.ts', 'utf8')
const inventoryPage = readFileSync('src/pages/Inventory.tsx', 'utf8')
const quickInventoryPage = readFileSync('src/pages/QuickInventory.tsx', 'utf8')

describe('inventory lineage contract', () => {
  it('adds explicit source and synchronization fields without inventing provenance for every legacy row', () => {
    expect(migration).toMatch(/add column if not exists platform_source text/i)
    expect(migration).toMatch(/add column if not exists last_synced_at timestamptz/i)
    expect(migration).toContain("raw ? 'variant'")
    expect(migration).toContain("raw ? 'contentId'")
    expect(migration).not.toMatch(/where[\s\S]*platform_source is null\s*;/i)
  })

  it('records Trendyol API provenance when catalogue quantities are synchronized', () => {
    expect(trendyolSync).toContain("platform_source: 'trendyol_api_v2'")
    expect(trendyolSync).toContain('last_synced_at: syncedAt')
  })

  it('marks merchant edits explicitly and scopes every update to the active tenant', () => {
    for (const source of [inventoryPage, quickInventoryPage]) {
      expect(source).toContain("platform_source: 'manual_override'")
      expect(source).toContain(".eq('merchant_code', merchant.merchant_code)")
    }
  })
})
