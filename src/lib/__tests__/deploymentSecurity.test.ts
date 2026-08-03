import { readFileSync } from 'node:fs'
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
    expect(smokeScript).toContain('production is not serving expected release')
    expect(smokeWorkflow).toContain("-ExpectedRelease '${{ github.sha }}'")
  })
})
