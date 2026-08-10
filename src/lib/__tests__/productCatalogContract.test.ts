import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('unified product catalog', () => {
  it('exposes a merchant catalog route with server-side paging', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    const page = readFileSync('src/pages/ProductCatalog.tsx', 'utf8')
    expect(app).toContain("'product-catalog'")
    expect(page).toContain("rpc('unified_product_catalog'")
    expect(page).toContain('p_offset')
    expect(page).toContain("toLocaleString('en-US')")
  })

  it('keeps provider identifiers in an isolated tenant-scoped mapping table', () => {
    const migration = readFileSync('supabase/migrations/20260810190000_create_unified_product_catalog.sql', 'utf8')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.product_channel_mappings')
    expect(migration).toContain('ALTER TABLE public.product_channel_mappings FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('security.can_access_merchant(merchant_code)')
    expect(migration).toContain('FOREIGN KEY (merchant_code, product_id)')
    expect(migration).not.toContain('UPDATE public.orders')
  })
})
