import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('remaining provider payload access', () => {
  it('uses explicit normalized advertising and fulfilment columns', () => {
    const sources = [
      readFileSync('src/pages/Marketing.tsx', 'utf8'),
      readFileSync('src/pages/ProductDetail.tsx', 'utf8'),
      readFileSync('src/pages/admin/AdsView.tsx', 'utf8'),
      readFileSync('src/pages/admin/InboundView.tsx', 'utf8'),
    ]
    for (const source of sources) {
      expect(source).not.toMatch(/from\('(ad_metrics|inbound_shipments|goods_received)'\)\.select\('\*'\)/)
    }
    expect(sources.join('\n')).toContain('AD_METRIC_SAFE_COLUMNS')
    expect(sources.join('\n')).toContain('INBOUND_SHIPMENT_SAFE_COLUMNS')
    expect(sources.join('\n')).toContain('GOODS_RECEIVED_SAFE_COLUMNS')
  })

  it('never renders webhook bodies in browser administration', () => {
    const source = readFileSync('src/pages/admin/WhatsAppManagerView.tsx', 'utf8')
    expect(source).toContain('WEBHOOK_EVENT_SAFE_COLUMNS')
    expect(source).not.toContain("from('webhook_events').select('*'")
    expect(source).not.toContain('l.payload')
    expect(source).not.toContain('JSON.stringify(l.payload)')
  })
})
