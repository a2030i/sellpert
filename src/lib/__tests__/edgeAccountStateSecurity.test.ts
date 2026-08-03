import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

describe('service-role Edge Functions enforce account state', () => {
  it.each([
    'impersonate-merchant',
    'daily-report',
    'manual-entry',
    'respondly-info',
    'test-platform-connection',
    'ai-chat',
    'analyze-merchant',
  ])('%s rejects an inactive caller', functionName => {
    const handler = source(`supabase/functions/${functionName}/index.ts`)
    expect(handler).toContain('is_active')
    expect(handler).toMatch(/is_active\s*===\s*false/)
  })

  it('blocks service, staff, linked, and employee syncs for an inactive workspace', () => {
    const handler = source('supabase/functions/_shared/sync.ts')
    expect(handler).toContain('await requireActiveWorkspace(admin, merchantCode)')
    expect(handler).toContain(".select('is_active,subscription_status')")
    expect(handler).toContain("throw new HttpError(403, 'ACCOUNT_SUSPENDED')")
  })

  it('requires Salla store identity to come from the verified provider response', () => {
    const handler = source('supabase/functions/salla-oauth-callback/index.ts')
    expect(handler).toContain('if (!storeRes.ok)')
    expect(handler).toContain('const verifiedStoreId = String(storeInfo.id')
    expect(handler).toContain('String(storeId) !== verifiedStoreId')
    expect(handler).not.toContain("storeInfo.id || storeId || 'unknown'")
  })
})
