import { describe, expect, it } from 'vitest'
import { escapeReportHtml } from '../reportHtml'

describe('merchant report HTML encoding', () => {
  it('renders merchant-controlled labels as text', () => {
    expect(escapeReportHtml(`<img src=x onerror="window.opener.location='https://evil.test'">`))
      .toBe('&lt;img src=x onerror=&quot;window.opener.location=&#39;https://evil.test&#39;&quot;&gt;')
  })

  it('preserves legitimate Arabic report labels', () => {
    expect(escapeReportHtml('متجر أحمد & شركاه')).toBe('متجر أحمد &amp; شركاه')
  })
})
