import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const files = [
  'src/pages/Notifications.tsx',
  'src/pages/ProductDetail.tsx',
  'src/pages/Orders.tsx',
  'src/pages/admin/MarketplaceConnections.tsx',
]

describe('safe marketplace operation feed contract', () => {
  it('keeps provider request and response JSON out of browser page queries', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toContain("from('marketplace_action_logs')")
      expect(source).not.toContain("select('request")
      expect(source).not.toContain("select('response")
    }
  })

  it('routes every browser operation read through the tenant-checked RPC helper', () => {
    const helper = readFileSync('src/lib/marketplaceOperations.ts', 'utf8')
    expect(helper).toContain("supabase.rpc('list_marketplace_operation_facts'")
    expect(helper).toContain('p_merchant_code: options.merchantCode')
    expect(helper).not.toContain('request')
    expect(helper).not.toContain('response')
  })

  it('revokes direct browser reads in the committed database migration', () => {
    const migration = readFileSync('supabase/migrations/20260805061437_safe_marketplace_operation_feed.sql', 'utf8')
    expect(migration).toContain('REVOKE SELECT ON public.marketplace_action_logs FROM authenticated')
    expect(migration).toContain('security.can_access_merchant(p_merchant_code)')
    expect(migration).not.toMatch(/^\s+request jsonb,/m)
    expect(migration).not.toMatch(/^\s+response jsonb,/m)
  })
})
