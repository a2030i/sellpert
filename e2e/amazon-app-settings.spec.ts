import { expect, test, type Page } from '@playwright/test'

const admin = {
  id: '00000000-0000-4000-8000-000000000171', merchant_code: 'ADMIN-AMAZON-TEST',
  name: 'مدير الاختبار', email: 'amazon-admin@example.test', currency: 'SAR',
  role: 'admin', workspace_status: 'active', onboarding_done: true, is_active: true,
  owner_merchant_code: null, permissions: null, created_at: '2026-11-26T08:00:00.000Z',
}
const callback = 'https://app.sellpert.com/integrations/amazon/callback'
const emptyStatus = { configured: false, fields: { appId: false, clientId: false, clientSecret: false }, redirectUri: callback, draft: true }
const readyStatus = { ...emptyStatus, configured: true, fields: { appId: true, clientId: true, clientSecret: true } }
const values = { appId: 'test-app-id', clientId: 'test-client-id', clientSecret: 'test-client-secret' }

type SettingsMock = { statusCode?: number; saveFails?: boolean; configured?: boolean; needsReplacement?: boolean; role?: 'admin' | 'staff' }
async function mockAdmin(page: Page, options: SettingsMock = {}) {
  const actor = { ...admin, role: options.role || 'admin' }
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor.id, role: 'authenticated', exp: 2_000_000_000 })}.e2e`
  await page.addInitScript(({ session }) => localStorage.setItem('sellpert-auth-v1', JSON.stringify(session)), {
    session: { access_token: token, refresh_token: 'test-refresh', expires_in: 3600, expires_at: 2_000_000_000, token_type: 'bearer',
      user: { id: actor.id, aud: 'authenticated', role: 'authenticated', email: actor.email, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: actor.created_at } },
  })
  await page.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: actor.id, role: 'authenticated', email: actor.email }) }))
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url())
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify(url.pathname.endsWith('/merchants') ? [actor] : []) })
  })
  const saves: Record<string, string>[] = []
  await page.route('**/functions/v1/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/admin-integration-settings')) {
      const body = route.request().postDataJSON()
      if (body.action === 'save_amazon_config') {
        saves.push(body)
        await route.fulfill({ status: options.saveFails ? 500 : 200, contentType: 'application/json', body: JSON.stringify(options.saveFails ? { error: values.clientSecret } : { ...readyStatus, ok: true }) })
      } else {
        await route.fulfill({ status: options.statusCode || 200, contentType: 'application/json', body: JSON.stringify(options.statusCode === 403 ? { error: 'Forbidden' } : { ...(options.configured ? readyStatus : emptyStatus), needsReplacement: options.needsReplacement || false }) })
      }
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ credentials: [] }) })
  })
  return saves
}

async function fillCredentials(page: Page) {
  for (const [name, value] of Object.entries(values)) await page.locator(`.amazon-settings input[name="${name}"]`).fill(value)
}

test('Amazon admin saves a matched credential set once and clears all inputs', async ({ page }) => {
  const saves = await mockAdmin(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/admin/amazon')
  await expect(page.getByRole('heading', { name: 'إعدادات أمازون', exact: true })).toBeVisible()
  await expect(page.getByText('إعدادات التطبيق تحتاج استكمالًا', { exact: true })).toBeVisible()
  const inputs = page.locator('.amazon-settings input')
  await expect(inputs).toHaveCount(3)
  for (const input of await inputs.all()) {
    await expect(input).toHaveAttribute('type', 'password')
    await expect(input).toHaveValue('')
  }
  await page.getByRole('button', { name: 'حفظ إعدادات أمازون', exact: true }).click()
  await expect(page.locator('#amazon-appId')).toBeFocused()
  expect(saves).toEqual([])
  await fillCredentials(page)
  await page.getByRole('button', { name: 'حفظ إعدادات أمازون', exact: true }).click()
  await expect(page.getByText('إعدادات التطبيق مكتملة', { exact: true })).toBeVisible()
  expect(saves).toEqual([{ action: 'save_amazon_config', ...values }])
  for (const input of await inputs.all()) await expect(input).toHaveValue('')
  await expect(page.getByText(callback, { exact: true })).toBeVisible()
  await expect(page.getByText('وضع المسودة', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(values.clientSecret)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('failed save keeps drafts for retry without displaying provider error material', async ({ page }) => {
  await mockAdmin(page, { saveFails: true })
  await page.goto('/admin/amazon')
  await expect(page.locator('#amazon-appId')).toBeEnabled()
  await fillCredentials(page)
  await page.getByRole('button', { name: 'حفظ إعدادات أمازون', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('تعذر تنفيذ العملية')
  await expect(page.locator('#amazon-clientSecret')).toHaveValue(values.clientSecret)
  await expect(page.locator('body')).not.toContainText(values.clientSecret)
})

test('replacing shared settings requires confirmation and cancellation retains inputs', async ({ page }) => {
  const saves = await mockAdmin(page, { configured: true })
  await page.goto('/admin/amazon')
  await expect(page.locator('#amazon-appId')).toBeEnabled()
  await fillCredentials(page)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'استبدال إعدادات أمازون', exact: true }).click()
  expect(saves).toEqual([])
  await expect(page.locator('#amazon-appId')).toHaveValue(values.appId)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'استبدال إعدادات أمازون', exact: true }).click()
  await expect(page.locator('#amazon-appId')).toHaveValue('')
  expect(saves).toHaveLength(1)
})

test('server permission denial hides credential controls', async ({ page }) => {
  await mockAdmin(page, { statusCode: 403 })
  await page.goto('/admin/amazon')
  await expect(page.getByRole('alert')).toContainText('هذه الصفحة متاحة لمديري المنصة فقط')
  await expect(page.locator('.amazon-settings input')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'حفظ إعدادات أمازون', exact: true })).toHaveCount(0)
})

test('an explicit unreadable configuration status permits confirmed replacement', async ({ page }) => {
  const saves = await mockAdmin(page, { needsReplacement: true })
  await page.goto('/admin/amazon')
  await expect(page.getByRole('alert')).toContainText('تعذرت قراءة إعدادات أمازون المحفوظة')
  await expect(page.locator('#amazon-appId')).toBeEnabled()
  await fillCredentials(page)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'استبدال إعدادات أمازون', exact: true }).click()
  await expect(page.locator('#amazon-appId')).toHaveValue('')
  expect(saves).toHaveLength(1)
})

test('platform staff cannot open Amazon app configuration', async ({ page }) => {
  const saves = await mockAdmin(page, { role: 'staff' })
  await page.goto('/admin/amazon')
  await expect(page.locator('.amazon-settings')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'إعدادات أمازون', exact: true })).toHaveCount(0)
  expect(saves).toEqual([])
})
