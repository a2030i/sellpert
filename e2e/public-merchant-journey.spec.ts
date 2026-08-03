import { expect, test, type Page } from '@playwright/test'

function collectRuntimeFailures(page: Page) {
  const failures: string[] = []
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  return failures
}

async function expectHealthyViewport(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const layout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    bodyFont: getComputedStyle(document.body).fontFamily,
    fontFaces: Array.from(document.fonts).map(face => ({ family: face.family, status: face.status })),
    externalFontRequests: performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(url => /fonts\.(googleapis|gstatic)\.com/.test(url)),
  }))
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.bodyFont).toContain('Noto Sans Arabic Variable')
  expect(layout.fontFaces.some(face => face.family.includes('Noto Sans Arabic Variable') && face.status === 'loaded')).toBe(true)
  expect(layout.fontFaces.some(face => face.family.includes('Alexandria Variable'))).toBe(true)
  expect(layout.fontFaces.some(face => face.family.includes('IBM Plex Sans Variable'))).toBe(true)
  expect(layout.externalFontRequests).toEqual([])
}

test('merchant can understand and navigate the complete public entry journey', async ({ page }) => {
  const failures = collectRuntimeFailures(page)

  await page.goto('/')
  await expect(page).toHaveTitle(/Sellpert/)
  await expect(page.getByRole('heading', { name: 'Sellpert' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).first()).toBeVisible()
  await expectHealthyViewport(page)

  await page.getByRole('button', { name: 'إنشاء متجر', exact: true }).click()
  await expect(page.getByLabel('اسم المتجر')).toBeVisible()
  await expect(page.getByLabel(/رقم الجوال/)).toBeVisible()
  await expect(page.getByLabel('تأكيد كلمة المرور')).toBeVisible()
  await expect(page.getByRole('button', { name: 'إنشاء المتجر والبدء' })).toBeVisible()

  await page.route('**/auth/v1/signup', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'signup-e2e', email: 'new@example.test' }, session: null }),
  }))
  await page.getByLabel('اسم المتجر').fill('متجر جديد')
  await page.getByLabel('البريد الإلكتروني').fill('new@example.test')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('SafeMerchant42')
  await page.getByLabel('تأكيد كلمة المرور').fill('SafeMerchant42')
  await page.getByRole('button', { name: 'إنشاء المتجر والبدء' }).click()
  await expect(page.getByText('تم إنشاء متجرك. افتح رسالة التحقق في بريدك ثم سجّل الدخول.')).toBeVisible()
  await expect(page.getByRole('button', { name: /إعادة المحاولة بعد/ })).toBeDisabled()

  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).first().click()
  await page.getByLabel('البريد الإلكتروني').fill('')
  await page.getByRole('button', { name: 'نسيت كلمة المرور؟' }).click()
  await expect(page.getByText(/أدخل بريدك الإلكتروني أولًا/)).toBeVisible()

  expect(failures).toEqual([])
})

test('legal pages are reachable and readable without an account', async ({ page }) => {
  const failures = collectRuntimeFailures(page)

  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'سياسة الخصوصية' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'البيانات التي نعالجها' })).toBeVisible()
  await expectHealthyViewport(page)

  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: 'شروط الاستخدام' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'الاستخدام المقبول' })).toBeVisible()
  await expectHealthyViewport(page)

  expect(failures).toEqual([])
})
