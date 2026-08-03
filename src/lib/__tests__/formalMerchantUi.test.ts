import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('formal merchant interface', () => {
  it('uses interface icons instead of pictographic emoji in core merchant surfaces', () => {
    const files = [
      'src/App.tsx',
      'src/components/AIChat.tsx',
      'src/components/NPSWidget.tsx',
      'src/pages/Products.tsx',
      'src/pages/Statement.tsx',
    ]
    const pictograph = /\p{Extended_Pictographic}/u
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(pictograph)
    }
  })
})
