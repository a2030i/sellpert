import {
  authorizeInternalWorker,
  sha256Hex,
  stableWebhookEventKey,
  timingSafeEqual,
} from './webhookSecurity.ts'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

Deno.test('timingSafeEqual accepts only the exact configured secret', () => {
  assert(timingSafeEqual('secret-value', 'secret-value'), 'matching secrets were rejected')
  assert(!timingSafeEqual('secret-value', 'secret-valuE'), 'different secrets were accepted')
  assert(!timingSafeEqual('secret-value', 'secret-value-longer'), 'different lengths were accepted')
  assert(!timingSafeEqual('', 'secret-value'), 'empty input was accepted')
})

Deno.test('stableWebhookEventKey prefers provider identity and hashes fallback payloads', async () => {
  assert(
    await stableWebhookEventKey('respondly', 'evt-123', '{"message":1}') === 'respondly:evt-123',
    'provider event identity was not preserved',
  )
  const first = await stableWebhookEventKey('respondly', '', '{"message":1}')
  const second = await stableWebhookEventKey('respondly', null, '{"message":1}')
  const different = await stableWebhookEventKey('respondly', '', '{"message":2}')
  assert(first === second, 'fallback fingerprint is not deterministic')
  assert(first !== different, 'different payloads produced the same fingerprint')
  assert(first.endsWith(await sha256Hex('{"message":1}')), 'fallback fingerprint has the wrong digest')
})

Deno.test('internal worker rejects public anon tokens and accepts only dedicated credentials', () => {
  const serviceKey = 'service-role-secret'
  const workerSecret = '0123456789abcdef0123456789abcdef'
  assert(
    !authorizeInternalWorker('public-anon-key', '', serviceKey, workerSecret),
    'public anon token authorized the worker',
  )
  assert(
    authorizeInternalWorker(serviceKey, '', serviceKey, workerSecret),
    'service role was rejected',
  )
  assert(
    authorizeInternalWorker('', workerSecret, serviceKey, workerSecret),
    'dedicated worker secret was rejected',
  )
  assert(
    !authorizeInternalWorker('', 'wrong-secret', serviceKey, workerSecret),
    'incorrect worker secret was accepted',
  )
})
