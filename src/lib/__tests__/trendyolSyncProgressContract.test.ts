import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Trendyol synchronization progress', () => {
  const sync = readFileSync('supabase/functions/sync-trendyol/index.ts', 'utf8')
  const connection = readFileSync('src/pages/admin/MarketplaceConnections.tsx', 'utf8')

  it('persists real server-side checkpoints for every business data stage', () => {
    for (const stage of ['orders', 'returns', 'finance', 'products', 'questions', 'analytics', 'complete']) {
      expect(sync).toContain(`'${stage}'`)
    }
    expect(sync).toContain("details.progress_percent = progressPercent")
    expect(sync).toContain("admin.from('sync_logs').update({ details })")
    expect(sync).toContain('details.progress_percent = 100')
  })

  it('renders an accessible determinate progress bar and complete result counters', () => {
    expect(connection).toContain('aria-label="تقدم مزامنة Trendyol"')
    expect(connection).toContain('aria-valuenow={syncProgress}')
    for (const metric of ['الشحنات', 'بنود الطلبات', 'الحركات المالية', 'أسئلة العملاء']) {
      expect(connection).toContain(`['${metric}'`)
    }
  })
})
