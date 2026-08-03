import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('formal merchant interface', () => {
  it('uses interface icons instead of pictographic emoji throughout the product', () => {
    const files = sourceFiles('src')
    const pictograph = /\p{Extended_Pictographic}/u
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(pictograph)
    }
  })
})
