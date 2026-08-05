import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Supabase production release workflow', () => {
  it('uses a pinned CLI and a serialized protected production environment', () => {
    const workflow = readFileSync('.github/workflows/supabase-release.yml', 'utf8')
    expect(workflow).toContain('supabase/setup-cli@v3.0.0')
    expect(workflow).toContain('version: 2.111.0')
    expect(workflow).toContain('environment: production')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).not.toContain('SUPABASE_DEPLOY_ENABLED')
    expect(workflow).toContain('Validate required Supabase secrets')
    expect(workflow).toContain("echo 'Missing SUPABASE_ACCESS_TOKEN'")
    expect(workflow).toContain("echo 'Missing SUPABASE_DB_PASSWORD'")
    expect(workflow).not.toMatch(/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD):\s+[^$\n]/)
  })

  it('uses the Node 24 compatible Supabase setup action in every workflow', () => {
    const workflows = [
      '.github/workflows/ci.yml',
      '.github/workflows/schema-recovery-drill.yml',
      '.github/workflows/supabase-release.yml',
    ]

    for (const path of workflows) {
      const workflow = readFileSync(path, 'utf8')
      expect(workflow).toContain('supabase/setup-cli@v3.0.0')
      expect(workflow).not.toContain('supabase/setup-cli@v1')
      expect(workflow).toContain('version: 2.111.0')
    }
  })

  it('deploys compatible functions before migrations and converges afterward', () => {
    const script = readFileSync('scripts/deploy-supabase-release.ps1', 'utf8')
    const parity = script.indexOf('Test-SupabaseMigrationParity.ps1')
    const preview = script.indexOf('supabase db push --linked --dry-run')
    const firstFunctions = script.indexOf('supabase functions deploy')
    const migration = script.lastIndexOf('supabase db push --linked')
    const finalFunctions = script.lastIndexOf('supabase functions deploy')
    expect(parity).toBeGreaterThan(0)
    expect(preview).toBeGreaterThan(parity)
    expect(firstFunctions).toBeGreaterThan(0)
    expect(firstFunctions).toBeGreaterThan(preview)
    expect(migration).toBeGreaterThan(firstFunctions)
    expect(finalFunctions).toBeGreaterThan(migration)
    expect(script).toContain('SUPABASE_ACCESS_TOKEN')
    expect(script).toContain('SUPABASE_DB_PASSWORD')
    expect(script).not.toContain('--include-all')
  })

  it('fails closed when an old local migration is absent remotely', () => {
    const guard = readFileSync('scripts/Test-SupabaseMigrationParity.ps1', 'utf8')
    expect(guard).toContain('historicalDrift')
    expect(guard).toContain('migration repair <version> --status applied')
    expect(guard).toContain('No production changes were made.')
  })
})
