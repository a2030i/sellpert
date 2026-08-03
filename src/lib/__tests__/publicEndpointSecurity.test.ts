import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(path, 'utf8')

describe('public Edge endpoint security boundaries', () => {
  it.each([
    ['Trendyol', 'supabase/functions/trendyol-webhook/index.ts'],
    ['Salla', 'supabase/functions/salla-webhook/index.ts'],
  ])('%s webhook enforces a bounded request body', (_platform, path) => {
    const handler = source(path)
    expect(handler).toContain('const MAX_BODY_BYTES = 1_000_000')
    expect(handler).toContain('readBoundedText(req, MAX_BODY_BYTES)')
    expect(handler).toContain("Payload too large' }, 413")
  })

  it('consumes OAuth state atomically before exchanging a provider code', () => {
    const handler = source('supabase/functions/marketplace-oauth/index.ts')
    const consumeAt = handler.indexOf(".from('marketplace_oauth_states')\n    .delete()")
    const exchangeAt = handler.indexOf('await exchangeAmazonCode(code)')
    expect(consumeAt).toBeGreaterThan(-1)
    expect(exchangeAt).toBeGreaterThan(consumeAt)
    expect(handler).toContain(".gt('expires_at', new Date().toISOString())")
    expect(handler).toContain("throw new HttpError(401, 'يرجى تسجيل الدخول من جديد')")
  })
})
