import { expect, test, type Page, type Route } from '@playwright/test'
import { expectNoSeriousAccessibilityViolations } from './accessibility'

const merchant = {
  id: '00000000-0000-4000-8000-000000000111',
  merchant_code: 'M-E2E-001',
  name: 'متجر الاختبار',
  email: 'merchant@example.test',
  currency: 'SAR',
  role: 'merchant',
  subscription_plan: 'free',
  subscription_status: 'active',
  onboarding_done: true,
  is_active: true,
  created_at: '2026-08-01T08:00:00.000Z',
}

function unsignedToken() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: merchant.id, role: 'authenticated', exp: 2_000_000_000 })}.e2e`
}

async function mockAuthenticatedMerchant(page: Page) {
  const accessToken = unsignedToken()
  await page.addInitScript(({ session }) => {
    window.localStorage.setItem('sellpert-auth-v1', JSON.stringify(session))
  }, {
    session: {
      access_token: accessToken,
      refresh_token: 'e2e-refresh-token',
      expires_in: 3600,
      expires_at: 2_000_000_000,
      token_type: 'bearer',
      user: {
        id: merchant.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: merchant.email,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: merchant.created_at,
      },
    },
  })

  await page.route('**/auth/v1/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/user')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: merchant.id, role: 'authenticated', email: merchant.email }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const isMerchantLookup = url.pathname.endsWith('/merchants') && url.searchParams.has('id')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': isMerchantLookup ? '0-0/1' : '*/0' },
      body: JSON.stringify(isMerchantLookup ? [merchant] : []),
    })
  })

  await page.route('**/functions/v1/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/account-lifecycle')) {
      const body = route.request().postDataJSON() as { action?: string; resource?: string }
      if (body.action === 'status') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request: null }) })
        return
      }
      if (body.action === 'export-manifest') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            schema_version: '2.0', generated_at: '2026-08-03T20:00:00.000Z', merchant,
            resources: [{ key: 'orders', label: 'الطلبات' }, { key: 'products', label: 'المنتجات' }],
            excludes: ['مفاتيح API', 'أسرار API'],
          }),
        })
        return
      }
      if (body.action === 'export-page') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ resource: body.resource, label: body.resource, rows: [{ id: `${body.resource}-1`, merchant_code: merchant.merchant_code }], next_cursor: null, done: true }),
        })
        return
      }
    }
    if (url.pathname.endsWith('/platform-credentials')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ credentials: [] }) })
      return
    }
    if (url.pathname.endsWith('/manage-platform-credentials')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          credentials: [{
            id: 'credential-e2e', merchant_code: merchant.merchant_code, platform: 'trendyol',
            seller_id: '1148158', is_active: true, test_status: 'success',
            last_tested_at: '2026-08-03T08:00:00.000Z', last_sync_at: '2026-08-03T08:05:00.000Z',
            records_synced: 18, configured: true,
          }],
          job: null,
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

test('registered merchant reaches complete Trendyol actions without technical JSON', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  await page.goto('/integrations')
  await expect(page.getByRole('heading', { name: 'الربط ورفع الملفات' })).toBeVisible()
  await expect(page.getByText('متجر الاختبار', { exact: true })).toBeVisible()
  await expect(page.getByText('متصل', { exact: true })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'صفحة الربط ورفع الملفات')

  await page.getByRole('button', { name: 'خدمات Trendyol' }).click()
  await expect(page.getByText('نفّذ خدمات متجرك مباشرة دون أكواد أو خطوات تقنية')).toBeVisible()

  for (const action of [
    'ملصقات الشحن',
    'حالة التجهيز والفاتورة',
    'بيانات الشحن والتتبع',
    'شركة الشحن',
    'السعر والمخزون',
    'قرارات المرتجعات',
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(`^${action}`) })).toBeVisible()
  }

  await expect(page.getByText(/JSON/)).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test('core merchant workspace is accessible and stable before the first import', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  const routes = [
    { path: '/', heading: 'مركز قرارات المتجر', context: 'نظرة عامة' },
    { path: '/orders', heading: 'لا توجد طلبات بعد', context: 'الطلبات' },
    { path: '/products', heading: 'المنتجات', context: 'المنتجات' },
    { path: '/inventory', heading: 'المخزون', context: 'المخزون' },
    { path: '/statement', heading: 'الأرباح والتسويات', context: 'الأرباح والتسويات' },
    { path: '/marketing', heading: 'لا توجد بيانات إعلانية بعد', context: 'الإعلانات والأداء' },
    { path: '/actions', heading: 'خطة العمل', context: 'خطة العمل' },
    { path: '/notifications', heading: 'مركز المتابعة', context: 'مركز المتابعة' },
    { path: '/store-status', heading: 'حالة المتجر', context: 'حالة المتجر' },
    { path: '/activity', heading: 'سجل النشاط', context: 'سجل النشاط' },
    { path: '/security', heading: 'الأمان والجلسات', context: 'الأمان والجلسات' },
    { path: '/team', heading: 'الفريق', context: 'الفريق والصلاحيات' },
    { path: '/requests', heading: 'تذاكر الدعم', context: 'تذاكر الدعم' },
  ]

  for (const route of routes) {
    await page.goto(route.path)
    await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible()
    await expectNoSeriousAccessibilityViolations(page, `صفحة ${route.context}`)
  }

  expect(runtimeErrors).toEqual([])
})

test('store owner downloads a complete paged data archive without integration secrets', async ({ page }) => {
  await mockAuthenticatedMerchant(page)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'إعدادات المتجر' })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'صفحة إعدادات المتجر')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'تنزيل البيانات' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/^sellpert-M-E2E-001-\d{4}-\d{2}-\d{2}\.zip$/)
  await expect(page.getByText(/تم تنزيل نسخة كاملة: 2 قسمًا و.+ سجلًا/)).toBeVisible()
  await expect(page.getByText(/مفاتيح الربط والأسرار/)).toBeVisible()
})

test('decision center explains evidence, value and action without misleading estimates', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  const fulfillRows = (route: Route, rows: unknown[]) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' },
    body: JSON.stringify(rows),
  })

  await page.route('**/rest/v1/product_profitability**', route => fulfillRows(route, [
    { product_id: 'p-loss', sku: 'LOSS-1', product_name: 'منتج بخسارة', cost_price: 40, units_sold: 4, revenue: 160, platform_fees: 30, ad_spend: 70, returns_amount: 20, net_profit: -45.25, profit_margin_pct: -28.28 },
    { product_id: 'p-missing', sku: 'MISS-1', product_name: 'منتج ناقص التكلفة', cost_price: 0, units_sold: 2, revenue: 100, platform_fees: 10, ad_spend: 0, returns_amount: 0, net_profit: 90, profit_margin_pct: 90 },
  ]))
  await page.route('**/rest/v1/inventory_health**', route => fulfillRows(route, [
    { sku: 'LOSS-1', product_name: 'منتج بخسارة', quantity: 0, cost_price: 40, stock_value_cost: 0, daily_velocity: 1, sold_30d: 18, days_of_stock: 0, health_status: 'out_of_stock', data_as_of: '2026-08-03', data_age_days: 1 },
  ]))
  await page.route('**/rest/v1/ad_net_summary**', route => fulfillRows(route, [
    { platform: 'trendyol', total_spend: 500, total_gross: 410, total_net: 320, gross_roas: 0.82, net_roas: 0.64, fee_rate: 0.1, return_rate: 0.05 },
  ]))
  await page.route('**/rest/v1/monthly_cashflow**', route => fulfillRows(route, [
    { platform: 'trendyol', month: '2026-08-01', cash_in: 700, cash_out: 1000, net: -300, tx_count: 4 },
  ]))
  await page.route('**/rest/v1/orders**', route => fulfillRows(route, [
    { id: 'o1', merchant_code: merchant.merchant_code, platform: 'trendyol', order_id: 'T-1', status: 'delivered', product_name: 'منتج بخسارة', sku: 'LOSS-1', quantity: 1, unit_price: 100, total_amount: 100, platform_fee: 10, shipping_cost: 5, discount_amount: 0, currency: 'SAR', customer_city: 'Riyadh', order_date: '2026-08-03T10:00:00.000Z', created_at: '2026-08-03T10:00:00.000Z' },
  ]))
  await page.route('**/rest/v1/rpc/create_my_action**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'action-e2e', created: true }),
  }))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'مركز قرارات المتجر' })).toBeVisible()
  expect(runtimeErrors).toEqual([])
  await expect(page.getByRole('heading', { name: 'قرارات مرتبة حسب الأثر' })).toBeVisible()
  await expect(page.getByText('دليل قوي').first()).toBeVisible()
  await expect(page.getByText('الخسارة المسجلة')).toBeVisible()
  await expect(page.getByText('45.25 ر.س', { exact: true })).toBeVisible()
  await expect(page.getByText('ليست مبيعات مضمونة')).toBeVisible()
  await expect(page.getByText('قبل احتساب تكلفة المنتج')).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'مركز قرارات المتجر')

  await page.getByRole('button', { name: 'إضافة للمتابعة' }).first().click()
  await expect(page.getByText('أُضيف القرار إلى خطة العمل')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('dashboard-opportunities.png'), fullPage: true })
})
