import { expect, test, type Page } from '@playwright/test'

function collectRuntimeFailures(page: Page) {
  const failures: string[] = []
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') failures.push(`console: ${message.text()}`) })
  return failures
}

const formResponse = {
  ok: true,
  form: { id: 'form-e2e', name: 'طلب خدمة Sellpert', slug: 'sellpert-service-request', title: 'طلب عرض سعر', description: 'نموذج اختبار طلب الخدمة', version: 1 },
  questions: [
    { id: 'q1', key: 'signer_name', label: 'اسم الشخص المخول بالتوقيع', type: 'short_text', help_text: '', placeholder: 'أدخل الاسم الكامل', required: true, position: 0, options: [], config: { section: 'contact' } },
    { id: 'q2', key: 'business_email', label: 'البريد الإلكتروني للعمل', type: 'short_text', help_text: '', placeholder: 'name@company.com', required: true, position: 1, options: [], config: { section: 'contact', format: 'email' } },
    { id: 'q3', key: 'phone', label: 'رقم الجوال', type: 'short_text', help_text: '', placeholder: '5xxxxxxxx', required: true, position: 2, options: [], config: { section: 'contact', format: 'saudi_phone' } },
    { id: 'q4', key: 'product_count', label: 'عدد المنتجات', type: 'short_text', help_text: '', placeholder: '120', required: true, position: 3, options: [], config: { section: 'business', format: 'number' } },
    { id: 'q5', key: 'desired_channels', label: 'القنوات المطلوبة', type: 'multiple_choice', help_text: '', placeholder: '', required: true, position: 4, options: ['نون', 'أمازون'], config: { section: 'business', min: 1 } },
    { id: 'q6', key: 'noon_url', label: 'رابط نون', type: 'url', help_text: 'اختياري', placeholder: 'https://', required: false, position: 5, options: [], config: { section: 'channels' } },
    { id: 'q7', key: 'entity_type', label: 'نوع الكيان', type: 'single_choice', help_text: '', placeholder: '', required: true, position: 6, options: ['شركة / مؤسسة', 'وثيقة عمل حر'], config: { section: 'documents' } },
  ],
}

test('public service request validates dynamic questions and completes all four steps', async ({ page }) => {
  const failures = collectRuntimeFailures(page)
  let submissions = 0
  await page.route('**/functions/v1/pricing-request**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(formResponse) })
      return
    }
    submissions += 1
    expect(route.request().postDataBuffer()?.toString()).toContain('أحمد التجريبي')
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, reference_code: 'SP-20260828-E2E001' }) })
  })

  await page.goto('/pricing-request')
  await expect(page.getByRole('heading', { name: 'طلب عرض سعر' })).toBeVisible()
  await page.getByRole('button', { name: 'التالي', exact: true }).click()
  await expect(page.getByText('هذا الحقل مطلوب').first()).toBeVisible()

  await page.getByLabel('اسم الشخص المخول بالتوقيع*').fill('أحمد التجريبي')
  await page.getByLabel('البريد الإلكتروني للعمل*').fill('test@example.com')
  await page.getByLabel('رقم الجوال*').fill('501234567')
  await page.getByRole('button', { name: 'التالي', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'أخبرنا عن نشاطك' })).toBeVisible()

  await page.getByLabel('عدد المنتجات*').fill('120')
  await page.getByLabel('نون').check()
  await page.getByRole('button', { name: 'التالي', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'روابط قنوات البيع' })).toBeVisible()
  await page.getByLabel('رابط نون').fill('https://example.com/noon')
  await page.getByRole('button', { name: 'التالي', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'المستندات والتأكيد' })).toBeVisible()

  await page.getByLabel('شركة / مؤسسة').check()
  await page.getByRole('button', { name: 'إرسال الطلب' }).click()
  await expect(page.getByRole('heading', { name: 'وصلنا طلبك بنجاح' })).toBeVisible()
  await expect(page.getByText('SP-20260828-E2E001')).toBeVisible()
  expect(submissions).toBe(1)
  expect(failures).toEqual([])
})
