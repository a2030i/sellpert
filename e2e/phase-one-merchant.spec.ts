import { expect, test, type Page } from '@playwright/test'

const merchant = {
  id: '00000000-0000-4000-8000-000000000121',
  merchant_code: 'M-PHASE-ONE',
  name: 'متجر المرحلة الأولى',
  email: 'phase-one@example.test',
  currency: 'SAR',
  role: 'merchant',
  workspace_status: 'active',
  onboarding_done: true,
  is_active: true,
  owner_merchant_code: null,
  permissions: null,
  created_at: '2026-08-05T08:00:00.000Z',
}

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: merchant.id, role: 'authenticated', exp: 2_000_000_000 })}.e2e`
}

async function mockPhaseOneMerchant(page: Page) {
  await page.addInitScript(({ session }) => {
    window.localStorage.setItem('sellpert-auth-v1', JSON.stringify(session))
  }, {
    session: {
      access_token: token(), refresh_token: 'phase-one-refresh', expires_in: 3600,
      expires_at: 2_000_000_000, token_type: 'bearer',
      user: {
        id: merchant.id, aud: 'authenticated', role: 'authenticated', email: merchant.email,
        app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: merchant.created_at,
      },
    },
  })

  await page.route('**/auth/v1/**', async route => {
    const url = new URL(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: url.pathname.endsWith('/user')
        ? JSON.stringify({ id: merchant.id, role: 'authenticated', email: merchant.email })
        : '{}',
    })
  })

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    const select = url.searchParams.get('select') || ''
    let body: unknown[] = []
    let range = '*/0'

    if (table === 'marketplace_accounts') {
      body = [{id:'00000000-0000-4000-8000-000000000122',merchant_code:merchant.merchant_code,platform:'trendyol',label:'بيانات قديمة',status:'disconnected',is_legacy:true}]
    } else if (table === 'merchants') {
      body = [merchant]
      range = '0-0/1'
    } else if (table === 'orders' && select.includes('order_id')) {
      body = [{
        id: 'phase-order-1', merchant_code: merchant.merchant_code, platform: 'trendyol', order_id: '11344951785',
        status: 'processing', product_name: 'منتج تجريبي', sku: 'SKU-1', quantity: 1, unit_price: 54,
        total_amount: 54, currency: 'SAR', order_date: '2026-08-05T08:30:00.000Z', created_at: '2026-08-05T08:31:00.000Z',
      }]
      range = '0-0/1'
    } else if (table === 'orders') {
      range = '0-2/3'
    } else if (table === 'products') {
      range = '0-23/24'
    } else if (table === 'inventory_health') {
      range = '0-1/2'
    }

    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': range }, body: JSON.stringify(body) })
  })

  await page.route('**/functions/v1/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/manage-platform-credentials')) {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          credentials: [{
            id: 'phase-credential', merchant_code: merchant.merchant_code, platform: 'trendyol', seller_id: '1148158',
            is_active: true, last_sync_at: '2026-08-05T08:45:00.000Z', records_synced: 28,
          }],
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

test.beforeEach(async ({ page }) => {
  await mockPhaseOneMerchant(page)
})

test('products finish loading every page in a legacy account and can search beyond 1000 rows', async ({ page }) => {
  const offsets: number[] = []
  let unusedOperations = 0
  await page.route(/\/rest\/v1\/(inventory|product_platform_listings|product_channel_mappings)\?/, route => {
    unusedOperations++
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/rest/v1/products?*', async route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'))
    offsets.push(offset)
    const all = Array.from({ length: 1744 }, (_, index) => ({
      id: `product-${index}`, merchant_code: merchant.merchant_code, name: `منتج الفحص ${index}`,
      sku: `CAT-${index}`, platform_source: 'manual', images: [], cost_price: 10, target_net_price: 20,
    }))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(all.slice(offset, offset + 1000)) })
  })
  await page.goto('/products?account=legacy')
  await expect(page.getByPlaceholder('ابحث باسم المنتج أو SKU...')).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('status', { name: 'جارٍ تحميل المنتجات' })).toHaveCount(0)
  await page.getByPlaceholder('ابحث باسم المنتج أو SKU...').fill('CAT-1743')
  await expect(page.getByText('منتج الفحص 1743', { exact: true })).toBeVisible()
  expect(offsets).toEqual([0, 1000])
  expect(unusedOperations).toBe(0)
})

test('products stop waiting for a stalled supporting query and allow a successful retry', async ({ page }) => {
  test.setTimeout(45_000)
  let stalled = true
  await page.route('**/rest/v1/product_platform_prices?*', async route => {
    if (stalled) return // deliberately unresolved transport
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.goto('/products?account=legacy')
  await expect(page.getByRole('heading', { name: 'تعذّر تحميل المنتجات', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('status', { name: 'جارٍ تحميل المنتجات' })).toHaveCount(0)
  stalled = false
  await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click()
  await expect(page.getByPlaceholder('ابحث باسم المنتج أو SKU...')).toBeVisible({ timeout: 15000 })
})

test('phase-one dashboard renders the multi-channel operating summary', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  const dashboardData = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rest/v1/orders'))
  await page.goto('/')
  await dashboardData

  await expect(page.getByRole('heading', { name: 'صباح الخير، متجر المرحلة الأولى', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'المبيعات عبر الزمن', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'حالة المزامنة الآن', level: 2 })).toBeVisible()
  await expect(page.getByText('إجمالي الطلبات', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/[\u0660-\u0669\u06F0-\u06F9]/)
  await expect(page.locator('body')).not.toContainText('\u0635\u0641\u0631')
  await expect(page.getByText('مركز قرارات المتجر')).toHaveCount(0)
  await expect(page.getByText('لا يمكن اعتماد التقييم بعد')).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test('phase-one navigation contains the launch destinations', async ({ page }, testInfo) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' })
  for (const label of ['الرئيسية', 'الطلبات', 'دليل المنتجات']) {
    await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  if (testInfo.project.name === 'mobile-chromium') {
    await expect(nav.getByRole('button', { name: 'الربط', exact: true })).toBeVisible()
    await nav.getByRole('button', { name: 'المزيد', exact: true }).click()
    const more = page.getByRole('dialog', { name: 'المزيد والحساب' })
    for (const label of ['المنتجات', 'المخزون']) {
      await expect(more.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
    await more.getByRole('button', { name: 'إغلاق', exact: true }).click()
    await expect(more).toHaveCount(0)
  } else {
    for (const label of ['المنتجات', 'المخزون', 'الربط والتكاملات']) {
      await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible()
    }
  }
  for (const hidden of ['الأرباح والتحصيل', 'خطة العمل', 'مركز المتابعة', 'الفريق والصلاحيات']) {
    await expect(page.getByText(hidden, { exact: true })).toHaveCount(0)
  }
})

test('advanced merchant URLs return safely to the phase-one home', async ({ page }) => {
  const dashboardData = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rest/v1/orders'))
  await page.goto('/product-compare')
  await dashboardData
  await expect(page.getByRole('heading', { name: 'صباح الخير، متجر المرحلة الأولى', level: 1 })).toBeVisible()
  await expect(page.getByText('الأرباح والتحصيل', { exact: true })).toHaveCount(0)
})

for (const [path,title] of [['/statement','الأرباح والتحصيل'],['/security','الأمان والجلسات'],['/store-status','حالة المتجر']]) {
  test(`approved merchant route ${path} remains reachable`,async({page})=>{
    await page.goto(path)
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible({timeout:15000})
    await expect(page.getByRole('heading',{name:'صباح الخير، متجر المرحلة الأولى',exact:true})).toHaveCount(0)
  })
}

test.describe('deployment recovery', () => {
  test.use({ serviceWorkers: 'block' })

test('a stale deployment recovers once and preserves the workspace route and session', async ({ page }) => {
  await page.goto('/orders?status=processing#current')
  await expect(page.getByRole('heading', { name: 'الطلبات', exact: true })).toBeVisible()
  const originalSession = await page.evaluate(() => localStorage.getItem('sellpert-auth-v1'))
  // The fresh HTML references a newer entry. The dev server serves that same
  // module with a query suffix, modelling a deployment without live credentials.
  let freshChecks = 0
  await page.route('http://127.0.0.1:*/', async route => {
    if (route.request().resourceType() !== 'fetch') return route.continue()
    freshChecks += 1
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace(/(src="(?:\/src\/main\.tsx|\/assets\/index-[^"]+\.js))(")/, '$1?release=next$2') })
  })
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError'))),
  ])
  await expect(page.getByRole('heading', { name: 'الطلبات', exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe('/orders?status=processing#current')
  expect(await page.evaluate(() => localStorage.getItem('sellpert-auth-v1'))).toBe(originalSession)
  expect(freshChecks).toBe(1)
  let extraLoads = 0
  page.on('load', () => { extraLoads += 1 })
  await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError')))
  await page.waitForTimeout(500)
  expect(extraLoads).toBe(0)
  expect(freshChecks).toBe(1)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})

})
