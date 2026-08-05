import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Supabase production release workflow', () => {
  it('uses a pinned CLI and a serialized protected production environment', () => {
    const workflow = readFileSync('.github/workflows/supabase-release.yml', 'utf8')
    expect(workflow).toContain('version: 2.111.0')
    expect(workflow).toContain('environment: production')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).not.toContain('SUPABASE_DEPLOY_ENABLED')
    expect(workflow).toContain('Require SUPABASE_ACCESS_TOKEN')
    expect(workflow).toContain('Require SUPABASE_DB_PASSWORD')
    expect(workflow).not.toMatch(/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD):\s+[^$\n]/)
  })

  it('deploys compatible functions before migrations and converges afterward', () => {
    const script = readFileSync('scripts/deploy-supabase-release.ps1', 'utf8')
    const firstFunctions = script.indexOf('supabase functions deploy')
    const migration = script.indexOf('supabase db push')
    const finalFunctions = script.lastIndexOf('supabase functions deploy')
    expect(firstFunctions).toBeGreaterThan(0)
    expect(migration).toBeGreaterThan(firstFunctions)
    expect(finalFunctions).toBeGreaterThan(migration)
    expect(script).toContain('SUPABASE_ACCESS_TOKEN')
    expect(script).toContain('SUPABASE_DB_PASSWORD')
  })
})
