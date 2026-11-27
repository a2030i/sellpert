import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  clearAmazonConnectTarget,
  readAmazonConnectTarget,
  rememberAmazonConnectTarget,
} from '../amazonConnection'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('Amazon consent return target', () => {
  it('remembers the merchant workspace for up to 15 minutes', () => {
    const storage = memoryStorage()
    rememberAmazonConnectTarget('M-6498', storage, 1_000)
    expect(readAmazonConnectTarget(storage, 1_000 + 14 * 60_000)).toBe('M-6498')
    expect(readAmazonConnectTarget(storage, 1_000 + 16 * 60_000)).toBeNull()
  })

  it('ignores damaged values and can be cleared', () => {
    const storage = memoryStorage()
    storage.setItem('sellpert.amazonConnectTarget', '{bad json')
    expect(readAmazonConnectTarget(storage, 0)).toBeNull()
    rememberAmazonConnectTarget('M-1', storage, 5)
    clearAmazonConnectTarget(storage)
    expect(readAmazonConnectTarget(storage, 5)).toBeNull()
  })

  it('stores no OAuth material', () => {
    const storage = memoryStorage()
    rememberAmazonConnectTarget('M-1', storage, 5)
    expect(Object.keys(JSON.parse(storage.getItem('sellpert.amazonConnectTarget') as string)).sort()).toEqual(['at', 'merchant_code'])
  })
})

describe('administrator return from Amazon consent', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  const card = readFileSync('src/components/AmazonConnectionCard.tsx', 'utf8')

  it('restores the merchant view before the admin console can replace the callback URL', () => {
    expect(app).toContain('readAmazonConnectTarget()')
    expect(app.indexOf('&& amazonReturnCode)')).toBeLessThan(app.indexOf('return <AdminPanel'))
    expect(app).toContain("setView('integrations')")
  })

  it('records the target before leaving for Amazon and clears it on return', () => {
    expect(card.indexOf('rememberAmazonConnectTarget(merchantCode)')).toBeLessThan(card.indexOf('window.location.assign(result.consent_url)'))
    expect(card).toContain('clearAmazonConnectTarget()')
  })
})
