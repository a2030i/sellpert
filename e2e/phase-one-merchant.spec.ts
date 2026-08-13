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

    if (table === 'merchants') {
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

test('phase-one dashboard renders the multi-channel operating summary', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'مرحبًا متجر المرحلة الأولى', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'المبيعات عبر الزمن', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'حالة المزامنة', level: 2 })).toBeVisible()
  await expect(page.getByText('إجمالي الطلبات', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/[\u0660-\u0669\u06F0-\u06F9]/)
  await expect(page.locator('body')).not.toContainText('\u0635\u0641\u0631')
  await expect(page.getByText('مركز قرارات المتجر')).toHaveCount(0)
  await expect(page.getByText('لا يمكن اعتماد التقييم بعد')).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test('phase-one navigation contains the launch destinations', async ({ page }, testInfo) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'التنقل الرئيسي' }).or(page.locator('nav').last())
  for (const label of ['الرئيسية', 'الطلبات', 'المنتجات', 'المخزون', 'الربط']) {
    await expect(nav.getByText(label, { exact: true })).toBeVisible()
  }
  if (testInfo.project.name === 'desktop-chromium') {
    await expect(nav.getByText('دليل المنتجات', { exact: true })).toBeVisible()
  }
  for (const hidden of ['الأرباح والتحصيل', 'خطة العمل', 'مركز المتابعة', 'الفريق والصلاحيات']) {
    await expect(page.getByText(hidden, { exact: true })).toHaveCount(0)
  }
})

test('advanced merchant URLs return safely to the phase-one home', async ({ page }) => {
  await page.goto('/statement')
  await expect(page.getByRole('heading', { name: 'مرحبًا متجر المرحلة الأولى', level: 1 })).toBeVisible()
  await expect(page.getByText('الأرباح والتحصيل', { exact: true })).toHaveCount(0)
})
