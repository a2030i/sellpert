import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AMAZON_IMPORT_CONNECTED_MESSAGE,
  AMAZON_IMPORT_UNKNOWN_MESSAGE,
  amazonFileImportAllowedFromStatus,
  amazonFileImportMessage,
  readAmazonFileImportAllowed,
} from '../amazonImportPolicy'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc } }))

describe('Amazon file import policy', () => {
  afterEach(() => vi.resetAllMocks())

  it('allows files only when connection status explicitly establishes no active connection', () => {
    expect(amazonFileImportAllowedFromStatus({ app_configured: false, connection: null })).toBe(true)
    expect(amazonFileImportAllowedFromStatus({ app_configured: true, connection: { is_active: false } })).toBe(true)
    expect(amazonFileImportAllowedFromStatus({ app_configured: true, connection: { is_active: true } })).toBe(false)
  })

  it.each([null, undefined, {}, { app_configured: true }, { app_configured: true, connection: {} }, { app_configured: true, connection: { is_active: 'false' } }])(
    'does not enable files for malformed or missing status %j', status => {
      expect(amazonFileImportAllowedFromStatus(status)).toBeNull()
    },
  )

  it('distinguishes connected and unknown states without blocking other platforms', () => {
    expect(amazonFileImportMessage(true)).toBeNull()
    expect(amazonFileImportMessage(false)).toBe(AMAZON_IMPORT_CONNECTED_MESSAGE)
    expect(amazonFileImportMessage(null)).toBe(AMAZON_IMPORT_UNKNOWN_MESSAGE)
  })

  it.each([true, false])('uses the selected workspace for preflight and accepts boolean %j', async allowed => {
    rpc.mockResolvedValue({ data: allowed, error: null })
    await expect(readAmazonFileImportAllowed('TEST-WORKSPACE')).resolves.toBe(allowed)
    expect(rpc).toHaveBeenCalledWith('amazon_file_import_allowed', { p_merchant_code: 'TEST-WORKSPACE' })
  })

  it.each([{ data: null, error: null }, { data: 'true', error: null }, { data: true, error: { message: 'denied' } }])(
    'fails closed on invalid or denied preflight %j', async result => {
      rpc.mockResolvedValue(result)
      await expect(readAmazonFileImportAllowed('TEST-WORKSPACE')).rejects.toThrow(AMAZON_IMPORT_UNKNOWN_MESSAGE)
    },
  )
})
