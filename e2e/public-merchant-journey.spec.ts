import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAccessibilityViolations } from './accessibility'

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
  await expectNoSeriousAccessibilityViolations(page, 'صفحة تسجيل الدخول')

  await page.getByRole('button', { name: 'إنشاء متجر', exact: true }).click()
  await expect(page.getByLabel('اسم المتجر')).toBeVisible()
  await expect(page.getByLabel(/رقم الجوال/)).toBeVisible()
  await expect(page.getByLabel('تأكيد كلمة المرور')).toBeVisible()
  await expect(page.getByRole('button', { name: 'إنشاء المتجر والبدء' })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'نموذج إنشاء المتجر')

  await page.route('**/auth/v1/signup**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'signup-e2e', email: 'new@example.test' }, session: null }),
  }))
  await page.getByLabel('اسم المتجر').fill('متجر جديد')
  await page.getByLabel('البريد الإلكتروني').fill('new@example.test')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('SafeMerchant42!')
  await page.getByLabel('تأكيد كلمة المرور').fill('SafeMerchant42!')
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

test('expired Auth links show a merchant-friendly recovery path and remove provider details', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page)
  const providerDescription = encodeURIComponent('Email link is invalid or has expired')

  await page.goto(`/auth/recovery#error=access_denied&error_code=otp_expired&error_description=${providerDescription}`)

  await expect(page.getByRole('alert')).toContainText('انتهت صلاحية رابط التحقق أو الاستعادة')
  await expect(page.getByText('Email link is invalid or has expired')).toHaveCount(0)
  await expect.poll(() => page.url()).not.toContain('error_code')
  await expect(page).toHaveURL(/\/$/)
  await expectNoSeriousAccessibilityViolations(page, 'خطأ رابط التحقق المنتهي')
  await page.screenshot({ path: testInfo.outputPath('expired-auth-link.png'), fullPage: true })

  expect(failures).toEqual([])
})
