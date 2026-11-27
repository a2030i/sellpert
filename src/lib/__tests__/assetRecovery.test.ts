import { expect, it, vi } from 'vitest'
import { createAssetRecovery } from '../assetRecovery'

function setup(overrides = {}) {
  const values = new Map<string, string>()
  values.set('sellpert-auth-v1', 'unchanged-session')
  const env = {
    currentEntry: 'https://app.test/assets/old.js',
    latestEntry: vi.fn(async () => 'https://app.test/assets/new.js' as string | null),
    storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } },
    reload: vi.fn(), online: () => true, now: () => 1_000_000, ...overrides,
  }
  return { env, values, recover: createAssetRecovery(env) }
}

it('recovers a new deployment once and keeps session data intact', async () => {
  const { env, values, recover } = setup()
  expect(await recover()).toBe(true)
  expect(await recover()).toBe(false)
  expect(env.reload).toHaveBeenCalledTimes(1)
  expect(values.get('sellpert-auth-v1')).toBe('unchanged-session')
  expect(await createAssetRecovery(env)()).toBe(false)
})

it('does not reload when a fresh document has the same entry or no usable entry', async () => {
  for (const latest of ['https://app.test/assets/old.js', null, '']) {
    const { env, recover } = setup({ latestEntry: vi.fn(async () => latest) })
    expect(await recover()).toBe(false)
    expect(env.reload).not.toHaveBeenCalled()
  }
})

it('keeps a cooldown even if the failed deployment changes its entry', async () => {
  const { env, recover } = setup()
  await recover()
  expect(await createAssetRecovery({ ...env, currentEntry: 'another-entry' })()).toBe(false)
  expect(await createAssetRecovery({ ...env, currentEntry: 'another-entry', now: () => 1_400_000 })()).toBe(true)
})

it('does not reload offline, when checking fails, or when storage is blocked', async () => {
  for (const overrides of [
    { online: () => false },
    { latestEntry: vi.fn(async () => { throw new Error('offline') }) },
    { storage: { getItem: () => null, setItem: () => { throw new Error('blocked') } } },
  ]) {
    const { env, recover } = setup(overrides)
    expect(await recover()).toBe(false)
    expect(env.reload).not.toHaveBeenCalled()
  }
})

it('coalesces concurrent import failures into one check and one reload', async () => {
  let resolve!: (value: string) => void
  const { env, recover } = setup({ latestEntry: vi.fn(() => new Promise<string>(done => { resolve = done })) })
  const first = recover()
  expect(await recover()).toBe(false)
  resolve('new-entry')
  expect(await first).toBe(true)
  expect(env.latestEntry).toHaveBeenCalledTimes(1)
  expect(env.reload).toHaveBeenCalledTimes(1)
})
