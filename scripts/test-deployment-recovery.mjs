// Run with two independently built dist directories. Uses synthetic data only.
// node scripts/test-deployment-recovery.mjs /path/to/old/dist /path/to/new/dist
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium, devices, expect } from '@playwright/test'

const [oldArg, newArg] = process.argv.slice(2)
if (!oldArg || !newArg) throw new Error('Provide old and new dist directories')
const oldRoot = resolve(oldArg), newRoot = resolve(newArg)
const entry = async root => (await readFile(resolve(root, 'index.html'), 'utf8')).match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
const oldEntry = await entry(oldRoot), newEntry = await entry(newRoot)
if (!oldEntry || !newEntry || oldEntry === newEntry) throw new Error('Two different production bundles are required')
let activeRoot = oldRoot
let missingProducts = 0
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  const root = activeRoot
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }
  try {
    const bytes = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(bytes)
  } catch {
    if (pathname.startsWith('/assets/')) {
      if (/\/Products-[^/]+\.js$/.test(pathname)) missingProducts++
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Asset retired by deployment')
    } else {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }).end(await readFile(resolve(root, 'index.html')))
    }
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
const merchant = { id: '00000000-0000-4000-8000-000000000121', merchant_code: 'M-RECOVERY', name: 'متجر التجربة', email: 'recovery@example.test', role: 'merchant', currency: 'SAR', is_active: true, onboarding_done: true, workspace_status: 'active' }
const account = { id: '00000000-0000-4000-8000-000000000122', merchant_code: merchant.merchant_code, platform: 'trendyol', label: 'بيانات قديمة', status: 'disconnected', is_legacy: true }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: merchant.id, role: 'authenticated', exp: 2000000000 })}.fixture`, refresh_token: 'fixture-refresh', expires_in: 3600, expires_at: 2000000000, token_type: 'bearer', user: { id: merchant.id, email: merchant.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01' } }
const products = Array.from({ length: 1744 }, (_, index) => ({ id: `product-${index}`, merchant_code: merchant.merchant_code, name: `منتج الفحص ${index}`, sku: `CAT-${index}`, platform_source: 'manual', images: [], cost_price: 10, target_net_price: 20 }))
try {
  for (const [name, device] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['mobile', devices['Pixel 7']]]) {
    activeRoot = oldRoot; missingProducts = 0
    const context = await browser.newContext({ ...device, serviceWorkers: 'allow' })
    const page = await context.newPage()
    let navigations = 0
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
    // Seed once via sessionStorage, so a reload cannot hide accidental auth deletion.
    await page.addInitScript(({ session }) => {
      if (!sessionStorage.getItem('fixture-seeded')) {
        localStorage.setItem('sellpert-auth-v1', JSON.stringify(session))
        sessionStorage.setItem('fixture-seeded', 'yes')
      }
    }, { session })
    await page.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: route.request().url().endsWith('/user') ? JSON.stringify(session.user) : '{}' }))
    await page.route('**/rest/v1/**', route => {
      const url = new URL(route.request().url()), table = url.pathname.split('/').pop()
      const offset = Number(url.searchParams.get('offset'))
      const rows = table === 'merchants' ? [merchant] : table === 'marketplace_accounts' ? [account] : table === 'products' ? products.slice(offset, offset + 1000) : []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })
    await page.route('**/functions/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await page.goto(base + '/settings?account=legacy')
    await expect(page.getByRole('textbox', { name: 'اسم المتجر', exact: true })).toBeVisible({ timeout: 15000 })
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    expect(await page.locator('script[type="module"]').getAttribute('src')).toBe(oldEntry)
    const originalAuth = await page.evaluate(() => localStorage.getItem('sellpert-auth-v1'))
    // Switch the server's deployment. Do not dispatch a synthetic error/reload or
    // rewrite entry fingerprints: the old Products import must really get 404.
    activeRoot = newRoot
    const before = navigations
    await page.evaluate(() => {
      history.pushState(null, '', '/products?account=legacy#catalog')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.getByPlaceholder('ابحث باسم المنتج أو SKU...')).toBeVisible({ timeout: 20000 })
    expect(await page.locator('script[type="module"]').getAttribute('src')).toBe(newEntry)
    expect(missingProducts).toBeGreaterThan(0)
    // pushState counts as one frame navigation; recovery adds one document load.
    expect(navigations - before).toBe(2)
    expect(page.url()).toBe(base + '/products?account=legacy#catalog')
    expect(await page.evaluate(() => localStorage.getItem('sellpert-auth-v1'))).toBe(originalAuth)
    expect(await page.getByRole('combobox', { name: 'نطاق حسابات البيع' }).inputValue()).toBe('legacy')
    await page.getByPlaceholder('ابحث باسم المنتج أو SKU...').fill('CAT-1743')
    await expect(page.getByText('منتج الفحص 1743', { exact: true })).toBeVisible()
    const recovered = navigations
    await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError')))
    await page.waitForTimeout(300)
    expect(navigations).toBe(recovered)
    if (process.env.RECOVERY_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.RECOVERY_SCREENSHOT_DIR, `products-recovery-${name}.png`) })
    console.log(JSON.stringify({ device: name, realRetiredProductAsset: true, automaticReloads: 1, serviceWorker: 'active', sessionAndScopePreserved: true, finalProductVisible: 1744, oldEntry, newEntry }))
    await context.close()
  }
} finally {
  await browser.close()
  await new Promise(done => server.close(done))
}
