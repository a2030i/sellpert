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
})
