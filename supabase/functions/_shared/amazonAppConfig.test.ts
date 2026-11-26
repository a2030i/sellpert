import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { AMAZON_APP_CONFIG_KEY, inspectAmazonAppConfig, loadAmazonAppConfig, safeAmazonAppStatus, saveAmazonAppConfig, validateAmazonAppInput } from './amazonAppConfig.ts'
import { decryptCredentialPayload } from './credentialVault.ts'
import { HttpError } from './sync.ts'

const input = { appId: 'fixture-app-id', clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret' }
const emptyEnv = { get: () => undefined }
const env = { get: (key: string) => ({ AMAZON_SP_APP_ID: 'env-app', AMAZON_SP_LWA_CLIENT_ID: 'env-client', AMAZON_SP_LWA_CLIENT_SECRET: 'env-secret' } as Record<string, string>)[key] }

function database(initial: any = null, failure: any = null) {
  let row = initial
  let writes = 0
  return {
    get row() { return row },
    get writes() { return writes },
    from(table: string) {
      assertEquals(table, 'app_settings')
      return {
        select(columns: string) {
          assertEquals(columns, 'value')
          return { eq(key: string, value: string) {
            assertEquals([key, value], ['key', AMAZON_APP_CONFIG_KEY])
            return { maybeSingle: () => Promise.resolve({ data: row, error: failure }) }
          } }
        },
        upsert(value: any, options: any) {
          assertEquals(options, { onConflict: 'key' })
          writes++
          if (!failure) row = value
          return Promise.resolve({ error: failure })
        },
      }
    },
  }
}

Deno.test('Amazon app config is atomic ciphertext, round-trips on the server, and never returns saved credentials', async () => {
  const previous = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const encryption = Deno.env.get('PLATFORM_CREDENTIALS_ENCRYPTION_KEY')
  try {
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fixture-config-encryption-key')
    Deno.env.delete('PLATFORM_CREDENTIALS_ENCRYPTION_KEY')
    const db = database()
    const result = await saveAmazonAppConfig(db, input, 'fixture-actor')
    assertEquals(db.writes, 1)
    assertEquals(db.row.key, AMAZON_APP_CONFIG_KEY)
    assertEquals(db.row.is_secret, true)
    assertEquals(db.row.updated_by, 'fixture-actor')
    assertEquals(await decryptCredentialPayload(db.row.value), input)
    for (const value of Object.values(input)) {
      assertEquals(JSON.stringify(db.row).includes(value), false)
      assertEquals(JSON.stringify(result).includes(value), false)
    }
    const loaded = await loadAmazonAppConfig(db, env)
    assertEquals(loaded, { ...input, redirectUri: 'https://app.sellpert.com/integrations/amazon/callback', draft: true })
    assertEquals(result, { ok: true, ...safeAmazonAppStatus(loaded) })
    await assertRejects(() => saveAmazonAppConfig(db, { ...input, clientSecret: '' }, 'fixture-actor'), HttpError)
    assertEquals(db.writes, 1)
    assertEquals(await decryptCredentialPayload(db.row.value), input)
  } finally {
    if (previous === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previous)
    if (encryption === undefined) Deno.env.delete('PLATFORM_CREDENTIALS_ENCRYPTION_KEY')
    else Deno.env.set('PLATFORM_CREDENTIALS_ENCRYPTION_KEY', encryption)
  }
})

Deno.test('Amazon config missing state supports existing environment setup without inventing credentials', async () => {
  assertEquals(await loadAmazonAppConfig(database(), emptyEnv), null)
  assertEquals(safeAmazonAppStatus(null).configured, false)
  assertEquals(safeAmazonAppStatus(null).fields, { appId: false, clientId: false, clientSecret: false })
  assertEquals((await loadAmazonAppConfig(database(), env))?.clientId, 'env-client')
})

Deno.test('Corrupt or unreadable stored Amazon app configuration fails closed instead of switching identities', async () => {
  await assertRejects(() => loadAmazonAppConfig(database({ value: 'unsealed-legacy-value' }), env), HttpError, 'تعذر قراءة')
  const error = await assertRejects(() => loadAmazonAppConfig(database(null, { message: input.clientSecret }), env), HttpError)
  assertEquals(error.message.includes(input.clientSecret), false)
  const repairStatus = await inspectAmazonAppConfig(database({ value: 'unsealed-legacy-value' }), env)
  assertEquals(repairStatus.needsReplacement, true)
  assertEquals(repairStatus.configured, false)
  assertEquals(JSON.stringify(repairStatus).includes('legacy-value'), false)
  await assertRejects(() => inspectAmazonAppConfig(database(null, { message: 'database failure' }), env), HttpError)
})

Deno.test('Amazon app config rejects incomplete sets, oversized strings, and control characters', () => {
  for (const changed of [{ appId: null }, { clientId: '' }, { clientSecret: ' ' }, { appId: 'a'.repeat(4097) }, { clientSecret: 'secret\nvalue' }]) {
    assertThrows(() => validateAmazonAppInput({ ...input, ...changed }), HttpError)
  }
})
