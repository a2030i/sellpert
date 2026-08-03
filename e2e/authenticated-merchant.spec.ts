import { expect, test, type Page } from '@playwright/test'

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
  await mockAuthenticatedMerchant(page)

  await page.goto('/integrations')
  await expect(page.getByRole('heading', { name: 'الربط ورفع الملفات' })).toBeVisible()
  await expect(page.getByText('متجر الاختبار', { exact: true })).toBeVisible()
  await expect(page.getByText('متصل', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'خدمات Trendyol' }).click()
  await expect(page.getByText('نفّذ خدمات متجرك مباشرة دون أكواد أو خطوات تقنية')).toBeVisible()

  for (const action of [
    'طباعة ملصق الشحن',
    'تحديث حالة التجهيز',
    'تحديث رقم التتبع',
    'تغيير شركة الشحن',
    'تحديث السعر والمخزون',
    'قبول طلب مرتجع',
  ]) {
    await expect(page.getByRole('button', { name: new RegExp(action) })).toBeVisible()
  }

  await expect(page.getByText(/JSON/)).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test('store owner downloads a complete paged data archive without integration secrets', async ({ page }) => {
  await mockAuthenticatedMerchant(page)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'إعدادات المتجر' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'تنزيل البيانات' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/^sellpert-M-E2E-001-\d{4}-\d{2}-\d{2}\.zip$/)
  await expect(page.getByText(/تم تنزيل نسخة كاملة: 2 قسمًا و2 سجلًا/)).toBeVisible()
  await expect(page.getByText(/مفاتيح الربط أو الأسرار/)).toBeVisible()
})
