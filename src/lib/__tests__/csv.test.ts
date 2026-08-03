import { describe, expect, it } from 'vitest'
import { buildSafeCsv, safeCsvCell } from '../csv'

describe('safe CSV export', () => {
  it.each(['=HYPERLINK("https://evil.test")', '+cmd', '-1+1', '@SUM(A1:A2)', '\tformula', '\rformula'])(
    'neutralizes spreadsheet formulas in %s',
    value => expect(safeCsvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`),
  )

  it('quotes delimiters, new lines, and double quotes', () => {
    expect(buildSafeCsv([['a,b', 'line\nnext', 'say "hi"']])).toBe('"a,b","line\nnext","say ""hi"""')
  })

  it('keeps numeric cells numeric while quoting their CSV representation', () => {
    expect(buildSafeCsv([[42, 10.5, null]])).toBe('"42","10.5",""')
  })
})
