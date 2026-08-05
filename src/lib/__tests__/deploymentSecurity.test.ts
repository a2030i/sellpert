import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('deployment browser security', () => {
  it('keeps a restrictive CSP and avoids blocked inline scripts', () => {
    const deployment = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const index = readFileSync('index.html', 'utf8')
    const globalHeaders = deployment.headers.find((entry: { source: string }) => entry.source === '/(.*)').headers
    const headers = Object.fromEntries(globalHeaders.map((header: { key: string; value: string }) => [header.key, header.value]))
    const csp = headers['Content-Security-Policy'] as string

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co")
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(index).not.toMatch(/<script(?![^>]+src=)[^>]*>/i)
    expect(index).not.toContain('fonts.googleapis.com')
    expect(index).not.toContain('fonts.gstatic.com')
  })

  it('sets the core browser hardening headers', () => {
    const deployment = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const globalHeaders = deployment.headers.find((entry: { source: string }) => entry.source === '/(.*)').headers
    const headers = Object.fromEntries(globalHeaders.map((header: { key: string; value: string }) => [header.key, header.value]))

    expect(headers['Strict-Transport-Security']).toContain('max-age=63072000')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Permissions-Policy']).toContain('camera=()')
  })

  it('binds client incidents to the immutable deployment release', () => {
    const viteConfig = readFileSync('vite.config.ts', 'utf8')
    const smokeScript = readFileSync('scripts/test-production-smoke.ps1', 'utf8')
    const smokeWorkflow = readFileSync('.github/workflows/production-smoke.yml', 'utf8')
    expect(viteConfig).toContain('VERCEL_GIT_COMMIT_SHA')
    expect(viteConfig).toContain('VITE_APP_RELEASE')
    expect(smokeScript).toContain('ExpectedRelease')
    expect(smokeScript).toContain('ReleaseWaitSeconds')
    expect(smokeScript).toContain('production is not serving expected release')
    expect(smokeScript).toContain("'sync-trendyol'")
    expect(smokeScript).toContain("'trendyol-actions'")
    expect(smokeScript).toContain("'admin-integration-settings'")
    expect(smokeWorkflow).toContain('Determine whether this commit changes the web release')
    expect(smokeWorkflow).toContain('fetch-depth: 2')
    expect(smokeWorkflow).toContain('$webReleasePattern')
    expect(smokeWorkflow).toContain("'^(src/|public/|")
    expect(smokeWorkflow).toContain('-ExpectedRelease $expectedRelease -ReleaseWaitSeconds 240')
    expect(smokeWorkflow).toContain('if ($expectedRelease)')
    expect(smokeWorkflow).toMatch(/else\s*\{\s*\.\/scripts\/test-production-smoke\.ps1\s*\}/)
  })

  it('never reports a successful Supabase release when deployment is disabled', () => {
    const workflow = readFileSync('.github/workflows/supabase-release.yml', 'utf8')
    expect(workflow).not.toContain('SUPABASE_DEPLOY_ENABLED')
    expect(workflow).not.toContain('configuration-notice')
    expect(workflow).toContain("- '.github/workflows/supabase-release.yml'")
    expect(workflow).toContain('Validate required Supabase secrets')
    expect(workflow).toContain("echo 'Missing SUPABASE_ACCESS_TOKEN'")
    expect(workflow).toContain("echo 'Missing SUPABASE_DB_PASSWORD'")
    expect(workflow).toContain('Deploy functions, migrations, then final functions')
  })

  it('pins the Supabase client used by the app and every Edge Function', () => {
    const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const pinnedVersion = packageManifest.dependencies['@supabase/supabase-js'] as string
    const edgeFunctionEntries = readdirSync('supabase/functions', { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
      .map(entry => `supabase/functions/${entry.name}/index.ts`)
      .filter(path => {
        try { return readFileSync(path, 'utf8').includes('@supabase/supabase-js') }
        catch { return false }
      })

    expect(pinnedVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(ciWorkflow).toMatch(/deno-version:\s+v\d+\.\d+\.\d+/)
    expect(ciWorkflow).toContain('deno check --node-modules-dir=auto')
    expect(edgeFunctionEntries.length).toBeGreaterThan(0)
    for (const path of edgeFunctionEntries) {
      expect(readFileSync(path, 'utf8'), path).toContain(`@supabase/supabase-js@${pinnedVersion}`)
    }
  })
})
