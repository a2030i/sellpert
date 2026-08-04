import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260804215429_automate_operational_alerts.sql', 'utf8')
const schedule = readFileSync('supabase/migrations/20260804220409_schedule_operational_alert_refresh.sql', 'utf8')

describe('operational alerts database contract', () => {
  it('keeps notification writes behind an internal tenant-checked function', () => {
    expect(migration).toContain('security.generate_merchant_operational_alerts')
    expect(migration).toContain('security definer')
    expect(migration).toContain("security.has_merchant_permission(p_merchant_code, 'dashboard')")
    expect(migration).toContain('revoke all on function security.generate_merchant_operational_alerts(text) from public, anon, authenticated')
    expect(migration).toContain('security invoker')
  })

  it('covers the operational failures a merchant must act on', () => {
    expect(migration).toContain('شحنات مفتوحة منذ أكثر من 24 ساعة')
    expect(migration).toContain('فواتير شحن تحتاج تصحيحًا')
    expect(migration).toContain('أسئلة عملاء تنتظر الرد')
    expect(migration).toContain('تعذر تحديث ')
    expect(migration).toContain('عمليات منصة تحتاج مراجعة')
  })

  it('deduplicates alerts and ignores stale sync failures after a newer result', () => {
    expect(migration).toContain('select distinct on (platform)')
    expect(migration).toContain("created_at > now() - interval '6 hours'")
    expect(migration).toContain("started_at > now() - interval '24 hours'")
  })

  it('refreshes active workspaces without requiring an open merchant session', () => {
    expect(schedule).toContain('security.refresh_all_merchant_operational_alerts')
    expect(schedule).toContain("jobname = 'merchant-operational-alert-refresh'")
    expect(schedule).toContain("'7 * * * *'")
    expect(schedule).toContain('exception when others then')
    expect(schedule).toContain('revoke all on function security.refresh_all_merchant_operational_alerts() from public, anon, authenticated')
  })
})
