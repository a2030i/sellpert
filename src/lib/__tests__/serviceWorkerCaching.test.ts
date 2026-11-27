import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

async function fetchThroughWorker(status: number, contentType: string, destination = 'script') {
  const handlers = new Map<string, (event: unknown) => void>()
  const put = vi.fn()
  const pending: Promise<unknown>[] = []
  let response!: Promise<Response>
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { location: { origin: 'https://app.test' }, addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler) },
    URL,
    caches: { match: async () => undefined, open: async () => ({ put }) },
    fetch: async () => new Response('fixture', { status, headers: { 'Content-Type': contentType } }),
  })
  handlers.get('fetch')!({
    request: { method: 'GET', url: destination === 'script' ? 'https://app.test/assets/page.js' : 'https://app.test/', destination },
    respondWith: (value: Promise<Response>) => { response = value },
    waitUntil: (value: Promise<unknown>) => { pending.push(value) },
  })
  const result = await response
  await Promise.all(pending)
  return { result, put }
}

it('does not cache missing chunks or HTML served at a script URL', async () => {
  for (const [status, type] of [[404, 'text/plain'], [503, 'text/javascript'], [200, 'text/html']] as const) {
    const { result, put } = await fetchThroughWorker(status, type)
    expect(result.status).toBe(status)
    expect(put).not.toHaveBeenCalled()
  }
})

it('keeps successful JavaScript assets cached', async () => {
  expect((await fetchThroughWorker(200, 'text/javascript')).put).toHaveBeenCalledTimes(1)
})

it('only caches successful HTML navigation responses', async () => {
  expect((await fetchThroughWorker(503, 'text/html', 'document')).put).not.toHaveBeenCalled()
  expect((await fetchThroughWorker(200, 'text/html', 'document')).put).toHaveBeenCalledTimes(1)
})
