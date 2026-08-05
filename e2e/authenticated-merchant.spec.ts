import { expect, test, type Page, type Route } from '@playwright/test'
import { expectNoSeriousAccessibilityViolations } from './accessibility'

test.skip(true, 'محفوظة للمرحلة المتقدمة؛ واجهة الإطلاق تعرض مسارات المرحلة الأولى فقط')

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
  owner_merchant_code: null,
  permissions: null as Record<string, boolean> | null,
  created_at: '2026-08-01T08:00:00.000Z',
}

function unsignedToken() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: merchant.id, role: 'authenticated', exp: 2_000_000_000 })}.e2e`
}

async function mockAuthenticatedMerchant(
  page: Page,
  merchantOverride: Partial<typeof merchant> = {},
  options: { connectedMarketplace?: boolean } = {},
) {
  const activeMerchant = { ...merchant, ...merchantOverride }
  const connectedMarketplace = options.connectedMarketplace !== false
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
    const isMerchantUpdate = url.pathname.endsWith('/merchants') && route.request().method() === 'PATCH'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': isMerchantLookup || isMerchantUpdate ? '0-0/1' : '*/0' },
      body: isMerchantUpdate
        ? JSON.stringify({ ...activeMerchant, onboarding_done: true })
        : JSON.stringify(isMerchantLookup ? [activeMerchant] : []),
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
          credentials: connectedMarketplace ? [{
            id: 'credential-e2e', merchant_code: merchant.merchant_code, platform: 'trendyol',
            seller_id: '1148158', is_active: true, test_status: 'success',
            last_tested_at: '2026-08-03T08:00:00.000Z', last_sync_at: '2026-08-03T08:05:00.000Z',
            records_synced: 18, configured: true,
          }] : [],
          job: null,
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

test('new merchant reaches one clear first-value action instead of empty analytics', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page, { onboarding_done: false }, { connectedMarketplace: false })

  await page.goto('/')
  const onboarding = page.getByRole('dialog', { name: 'مرحبًا بك في Sellpert' })
  await expect(onboarding).toBeVisible()
  await onboarding.getByRole('button', { name: 'متابعة' }).click()
  await page.getByRole('button', { name: 'متابعة' }).click()
  await page.getByRole('button', { name: 'متابعة' }).click()
  await expect(page.getByRole('heading', { name: 'مساحة العمل جاهزة' })).toBeVisible()
  await page.getByRole('button', { name: 'الانتقال إلى نظرة عامة' }).click()

  await expect(page.getByRole('heading', { name: 'ابدأ تشغيل متجرك' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'اربط قناة البيع أو ارفع أول ملف' })).toBeVisible()
  await expect(page.getByText('مساحة معزولة', { exact: true })).toBeVisible()
  await expect(page.getByText('حالة واضحة', { exact: true })).toBeVisible()
  await expect(page.getByText('نتيجة قابلة للعمل', { exact: true })).toBeVisible()
  await expect(page.getByText('صافي التدفق النقدي الأخير')).toHaveCount(0)
  await expectNoSeriousAccessibilityViolations(page, 'لوحة بدء تشغيل متجر جديد')
  await page.screenshot({ path: testInfo.outputPath('new-merchant-first-value.png'), fullPage: true })

  await page.getByRole('button', { name: /الربط ورفع الملفات/ }).click()
  await expect(page).toHaveURL(/\/integrations$/)
  expect(runtimeErrors).toEqual([])
})

test('employee command search uses current names and hides unauthorized pages', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page, {
    role: 'employee',
    owner_merchant_code: merchant.merchant_code,
    permissions: {
      dashboard: true,
      orders: false,
      customers: false,
      products: true,
      inventory: false,
      marketing: false,
      statement: false,
      integrations: false,
      settings: false,
      team: false,
    },
  })

  await page.goto('/')
  await page.getByRole('button', { name: /ابحث عن صفحة أو منتج|بحث/ }).click()
  const commandSearch = page.getByRole('dialog', { name: 'البحث السريع' })
  await expect(commandSearch.getByPlaceholder('ابحث عن صفحة، منتج، أو تاجر...')).toBeVisible()
  await expect(commandSearch.getByText('مركز القرارات', { exact: true })).toBeVisible()
  await expect(commandSearch.getByText('المنتجات', { exact: true })).toBeVisible()
  await expect(commandSearch.getByText('الدعم ومركز المعرفة', { exact: true })).toBeVisible()
  await expect(commandSearch.getByText('الطلبات', { exact: true })).toHaveCount(0)
  await expect(commandSearch.getByText('الربط ورفع الملفات', { exact: true })).toHaveCount(0)
  await expect(commandSearch.getByText('الفريق والصلاحيات', { exact: true })).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test('Trendyol synchronization shows the real server stage and percentage', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  await page.route('**/functions/v1/manage-platform-credentials', async route => {
    const body = route.request().postDataJSON() as { action?: string }
    if (body.action === 'list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ credentials: [{
          id: 'credential-e2e', merchant_code: merchant.merchant_code, platform: 'trendyol',
          seller_id: '1148158', is_active: true, test_status: 'success', configured: true,
          last_tested_at: '2026-08-05T02:00:00.000Z', last_sync_at: null, records_synced: 0,
        }] }),
      })
      return
    }
    if (body.action === 'sync-status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: { status: 'processing', started_at: '2026-08-05T02:10:00.000Z' },
          log: { status: 'running', details: { stage: 'products', stage_label: 'تحديث المنتجات والصور والسعر والمخزون', progress_percent: 64 } },
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/integrations')
  await expect(page.getByText('تحديث المنتجات والصور والسعر والمخزون', { exact: true })).toBeVisible()
  const progress = page.getByRole('progressbar', { name: 'تقدم مزامنة Trendyol' })
  await expect(progress).toHaveAttribute('aria-valuenow', '64')
  await expect(page.getByText('٦٤٪', { exact: true })).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

test('merchant invites an employee without creating or sharing their password', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  let submitted: Record<string, unknown> | null = null

  await page.route('**/functions/v1/create-employee', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (body.action === 'invitation_status') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ statuses: [], truncated: false }) })
      return
    }
    submitted = body
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, merchant_code: 'E-0011223344556677', invitation_sent: true }),
    })
  })

  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'الفريق' })).toBeVisible()
  await page.getByRole('button', { name: 'إضافة موظف' }).click()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByLabel('الاسم الكامل').fill('سارة محمد')
  await page.getByLabel('البريد الإلكتروني').fill('sara@example.test')
  await page.getByRole('button', { name: 'إرسال دعوة آمنة' }).click()

  await expect.poll(() => submitted).toMatchObject({
    name: 'سارة محمد',
    email: 'sara@example.test',
  })
  expect(submitted).not.toHaveProperty('password')
  await expect(page.getByText('أُرسلت دعوة آمنة إلى sara@example.test')).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'دعوة موظف آمنة')
  await page.screenshot({ path: testInfo.outputPath('secure-team-invitation.png'), fullPage: true })
  expect(runtimeErrors).toEqual([])
})

test('merchant sees a pending team invitation and resends the correct access link', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  const employee = {
    id: '00000000-0000-4000-8000-000000000771',
    merchant_code: 'E-0011223344556677',
    name: 'سارة محمد',
    email: 'sara@example.test',
    whatsapp_phone: null,
    job_title: 'خدمة العملاء',
    permissions: { dashboard: true, customers: true },
    is_active: true,
    created_at: '2026-08-05T01:00:00.000Z',
  }
  let submitted: Record<string, unknown> | null = null

  await page.route('**/rest/v1/rpc/my_employees', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([employee]),
  }))
  await page.route('**/functions/v1/create-employee', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (body.action === 'invitation_status') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          statuses: [{ id: employee.id, status: 'pending', invited_at: employee.created_at, accepted_at: null, last_sign_in_at: null }],
          truncated: false,
        }),
      })
      return
    }
    submitted = body
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, link_type: 'invite' }) })
  })
  page.on('dialog', dialog => dialog.accept())

  await page.goto('/team')
  await expect(page.getByText('دعوة معلقة')).toBeVisible()
  await expect(page.getByText(/بانتظار القبول/)).toBeVisible()
  await page.getByRole('button', { name: 'إعادة إرسال الدعوة إلى سارة محمد' }).click()
  await expect.poll(() => submitted).toEqual({ action: 'send_access_link', employee_code: employee.merchant_code })
  await expect(page.getByText('أُعيد إرسال الدعوة إلى sara@example.test')).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'متابعة دعوة موظف معلقة')
  await page.screenshot({ path: testInfo.outputPath('pending-team-invitation.png'), fullPage: true })
  expect(runtimeErrors).toEqual([])
})

test('merchant sees a truthful purchase funding decision and opens bank evidence', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  await page.route('**/rest/v1/rpc/my_purchase_cash_readiness', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      horizon_days: 30, status: 'bank_balance_missing', confidence: 'low',
      bank: { balance: null, balance_date: null, age_days: null, is_fresh: false, currency: 'SAR', account_hint: null },
      payouts: { confirmed_total: 50.25, count: 1, api_count: 1, manual_count: 0, rows: [] },
      purchase_plan: { item_count: 2, unit_count: 20, estimated_cost: 300, data_as_of: '2026-08-05', age_days: 0, top_items: [] },
      readiness: { available_before_purchase: null, cash_after_purchase: null, funding_gap: null, coverage_pct: null },
      data_quality: { inventory_item_count: 2, demand_covered_count: 2, missing_cost_count: 0, stale_inventory_count: 0 },
      unconfirmed_sales: { gross_total: 1000, included_in_available_cash: false, rows: [] },
    }),
  }))

  await page.goto('/inventory')
  await expect(page.getByRole('heading', { name: 'جاهزية تمويل المشتريات' })).toBeVisible()
  await expect(page.getByText('أضف رصيد الحساب لتقييم القدرة الشرائية')).toBeVisible()
  await expect(page.getByText(/المبيعات غير المحوّلة.*لم تُحتسب ضمن النقد المتاح/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('purchase-cash-readiness.png'), fullPage: true })
  await page.getByRole('button', { name: /رفع كشف بنكي حديث/ }).click()
  await expect(page).toHaveURL(/\/statement\?tab=settlements$/)
  expect(runtimeErrors).toEqual([])
})

test('merchant completes product costs directly without preparing a technical file', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  const product = {
    id:'cost-product-e2e', merchant_code:merchant.merchant_code, name:'قهوة عربية فاخرة', sku:'COFFEE-COST-1',
    barcode:'628100000010', category:'قهوة', cost_price:0, target_net_price:54, status:'active',
    created_at:'2026-08-01T08:00:00Z', updated_at:'2026-08-01T08:00:00Z',
  }
  let submitted: any = null
  let savedCost = 0

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/rpc/bulk_update_product_costs')) {
      submitted = route.request().postDataJSON()
      savedCost = 24.75
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([{ updated_count:1, unmatched_identifiers:[], ambiguous_identifiers:[], invalid_rows:0 }]) })
      return
    }
    const table = url.pathname.split('/').pop()
    const rows = table === 'merchants' ? [merchant] : table === 'products' ? [{ ...product, cost_price:savedCost }] : []
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }, body:JSON.stringify(rows) })
  })

  await page.goto('/products?costs=import')
  const dialog = page.getByRole('dialog', { name:'استيراد تكاليف المنتجات' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('إدخال سريع بدون ملف')).toBeVisible()
  await dialog.getByLabel('تكلفة قهوة عربية فاخرة').fill('24.75')
  await dialog.getByRole('button', { name:'حفظ 1 تكلفة' }).click()
  await expect.poll(() => submitted).toEqual({
    p_updates:[{ identifier:'COFFEE-COST-1', cost_price:'24.75' }],
    p_merchant_code:merchant.merchant_code,
  })
  await expect(dialog.getByText('تم تحديث 1 منتج')).toBeVisible()
  await expect(dialog.getByText('100٪')).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'استكمال تكاليف المنتجات بدون ملف')
  await page.screenshot({ path:testInfo.outputPath('product-cost-quick-entry.png'), fullPage:true })
  expect(runtimeErrors).toEqual([])
})

test('registered merchant reaches complete Trendyol actions without technical JSON', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  await page.goto('/integrations')
  await expect(page.getByRole('heading', { name: 'الربط ورفع الملفات' })).toBeVisible()
  await expect(page.getByText('متجر الاختبار', { exact: true })).toBeVisible()
  await expect(page.getByText('متصل', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /عمليات Trendyol خلال 7 أيام/ })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'صفحة الربط ورفع الملفات')

  await page.getByRole('button', { name: /عمليات Trendyol خلال 7 أيام/ }).click()
  await expect(page).toHaveURL(/\/notifications\?tab=operations$/)
  await expect(page.getByRole('heading', { name: 'عمليات Trendyol' })).toBeVisible()

  await page.goto('/integrations')

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

test('merchant measures action effectiveness and opens the execution page', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  const actions = [{
    id:'action-e2e-1', title:'إعادة توريد المنتج الأعلى طلبًا', note:'نفد المنتج وله طلب مؤكد خلال آخر 30 يومًا.',
    expected_impact:'استعادة توفر المنتج', category:'inventory', priority:'urgent', status:'pending',
    due_date:'2026-08-03', source_key:'stockout-e2e', created_at:'2026-08-01T08:00:00Z',
    details:{ destination:'/inventory?status=out_of_stock' }, completion_result:null,
    completion_note:null, completion_recorded_at:null,
  }]
  const weeks = Array.from({ length:8 }, (_, index) => ({
    week_start:`2026-0${index < 4 ? '6' : '7'}-${String(index < 4 ? 1 + index * 7 : 1 + (index - 4) * 7).padStart(2, '0')}`,
    completed:index % 3, achieved:index % 2, partial:index % 3 === 2 ? 1 : 0, not_achieved:0,
  }))
  const effectiveness = {
    period_days:90, generated_at:'2026-08-05T01:00:00Z',
    open:{ total:1, in_progress:0, urgent:1, overdue:1, due_next_7_days:0 },
    completed:{ total:6, achieved:4, partial:1, not_achieved:1, unmeasured:0, measured:6, achieved_rate_pct:66.7, positive_rate_pct:83.3, average_cycle_days:2.4 },
    categories:[{ category:'inventory', completed:4, achieved:3, partial:1, not_achieved:0, achieved_rate_pct:75 }],
    weeks,
  }

  await page.route('**/rest/v1/merchant_requests**', route => route.fulfill({
    status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' }, body:JSON.stringify(actions),
  }))
  await page.route('**/rest/v1/rpc/my_action_effectiveness', route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify(effectiveness),
  }))

  await page.goto('/actions')
  await expect(page.getByRole('heading', { name:'خطة العمل' })).toBeVisible()
  await expect(page.getByRole('heading', { name:'فعالية التنفيذ' })).toBeVisible()
  await expect(page.getByText('66.7%', { exact:true })).toBeVisible()
  await expect(page.getByText('83.3%', { exact:true })).toBeVisible()
  await expect(page.getByText('2.4 يوم', { exact:true })).toBeVisible()
  await expect(page.getByText('النتائج حسب القسم')).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'خطة العمل وفعالية التنفيذ')

  await page.getByRole('button', { name:'فتح صفحة التنفيذ' }).click()
  await expect(page).toHaveURL(/\/inventory\?status=out_of_stock$/)
  expect(runtimeErrors).toEqual([])
})

test('merchant reviews and approves a Trendyol return without technical identifiers', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  const claim = {
    id:'return-e2e-1', merchant_code:merchant.merchant_code, platform:'trendyol', order_id:'11344951785',
    product_name:'قسط هندي حب 250 جم', sku:'4999', quantity:1, return_amount:23.75,
    reason:'I believe this item is not original', return_date:'2026-08-04', status:'pending',
    claim_id:'provider-claim-secret', provider_claim_item_id:'provider-item-secret',
    created_at:'2026-08-04T10:00:00.000Z', last_synced_at:'2026-08-04T10:00:00.000Z',
  }
  let currentStatus = 'pending'
  let approvePayload: any = null

  await page.route('**/rest/v1/rpc/list_return_facts**', async route => {
    const url = new URL(route.request().url())
    const pendingOnly = url.searchParams.get('status')?.includes('pending')
    const rows = pendingOnly && currentStatus !== 'pending' ? [] : [{ ...claim, status:currentStatus }]
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':rows.length ? '0-0/1' : '*/0' }, body:JSON.stringify(rows) })
  })
  await page.route('**/functions/v1/trendyol-actions', async route => {
    const body = route.request().postDataJSON() as any
    if (body.action === 'claims.approve') {
      approvePayload = body
      currentStatus = 'approved'
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'success' }) })
      return
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, data:[] }) })
  })
  await page.route('**/functions/v1/sync-trendyol', route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify({ ok:true, records_synced:1 }),
  }))

  await page.goto('/statement?tab=returns')
  await expect(page.getByText('إدارة المرتجعات', { exact:true })).toBeVisible()
  await expect(page.getByText('تحتاج قرارك').locator('..').getByText('1', { exact:true })).toBeVisible()
  await expect(page.getByRole('cell', { name:'قسط هندي حب 250 جم' })).toBeVisible()
  await expect(page.getByText('provider-claim-secret')).toHaveCount(0)
  await expect(page.getByText('provider-item-secret')).toHaveCount(0)
  await expectNoSeriousAccessibilityViolations(page, 'إدارة مرتجعات Trendyol')

  await page.getByRole('button', { name:'قبول الطلب' }).click()
  await expect(page.getByRole('dialog', { name:'تأكيد قبول طلب المرتجع' })).toBeVisible()
  await page.getByRole('button', { name:'تأكيد القبول وإرساله' }).click()
  await expect(page.getByText('تمت الموافقة')).toBeVisible()
  expect(approvePayload).toMatchObject({
    merchant_code:merchant.merchant_code,
    action:'claims.approve',
    path:{ claimId:'provider-claim-secret' },
    payload:{ claimLineItemIdList:['provider-item-secret'] },
    confirm:true,
  })
  expect(runtimeErrors).toEqual([])
})

test('accountant reconciles Trendyol settlements and sees exact transfer differences', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  const transactions = [
    { id:'tx-1', platform:'trendyol', settlement_id:'SET-1', transaction_date:'2026-08-01T10:00:00Z', posted_date:null, transaction_type:'Sale', debit:0, credit:100, net_amount:100, currency:'SAR', upload_id:null },
    { id:'tx-2', platform:'trendyol', settlement_id:'SET-1', transaction_date:'2026-08-01T10:01:00Z', posted_date:null, transaction_type:'CommissionNegative', debit:10, credit:0, net_amount:-10, currency:'SAR', upload_id:null },
    { id:'tx-3', platform:'trendyol', settlement_id:'SET-1', transaction_date:'2026-08-03T10:00:00Z', posted_date:'2026-08-03T10:00:00Z', transaction_type:'WireTransfer', debit:90, credit:0, net_amount:-90, currency:'SAR', upload_id:null },
    { id:'tx-4', platform:'trendyol', settlement_id:'SET-2', transaction_date:'2026-08-02T10:00:00Z', posted_date:null, transaction_type:'Sale', debit:0, credit:75, net_amount:75, currency:'SAR', upload_id:null },
    { id:'tx-5', platform:'trendyol', settlement_id:'SET-3', transaction_date:'2026-08-02T11:00:00Z', posted_date:null, transaction_type:'Sale', debit:0, credit:50, net_amount:50, currency:'SAR', upload_id:null },
    { id:'tx-6', platform:'trendyol', settlement_id:'SET-3', transaction_date:'2026-08-04T10:00:00Z', posted_date:'2026-08-04T10:00:00Z', transaction_type:'PaymentOrder', debit:45, credit:0, net_amount:-45, currency:'SAR', upload_id:null },
  ]
  const bankTransactions = [
    { id:'bank-1', transaction_date:'2026-08-04', value_date:'2026-08-04', description:'Trendyol payout SET-1', reference:'SET-1', debit:0, credit:90, net_amount:90, currency:'SAR' },
    { id:'bank-2', transaction_date:'2026-08-05', value_date:'2026-08-05', description:'Marketplace payout', reference:'TRANSFER-2', debit:0, credit:45, net_amount:45, currency:'SAR' },
  ]
  let bankMatches: any[] = []
  let refreshed = false

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    const object = (route.request().headers().accept || '').includes('application/vnd.pgrst.object')
    let payload: any = []
    if (table === 'merchants') payload = [merchant]
    else if (table === 'performance_data') payload = [{ merchant_code:merchant.merchant_code, platform:'trendyol', data_date:'2026-08-04', total_sales:225, platform_fees:10, ad_spend:0, order_count:3 }]
    else if (table === 'orders') payload = [{ id:'finance-order-1', sku:'SKU-1', quantity:1, status:'delivered', platform:'trendyol', platform_fee:10, upload_id:null, last_synced_at:'2026-08-04T10:00:00Z' }]
    else if (table === 'products') payload = [{ id:'finance-product-1', sku:'SKU-1', cost_price:40 }]
    else if (table === 'account_transactions') payload = transactions
    else if (table === 'bank_transactions') payload = bankTransactions
    else if (table === 'settlement_bank_matches') {
      if (route.request().method() === 'POST') {
        const inserted = route.request().postDataJSON() as any
        bankMatches = [{ id:'bank-match-1', bank_transaction_id:inserted.bank_transaction_id, platform:inserted.platform, settlement_id:inserted.settlement_id, expected_amount:inserted.expected_amount, confirmed_at:'2026-08-05T12:00:00Z' }]
        payload = []
      } else payload = bankMatches
    }
    else if (table === 'rpc' && url.pathname.endsWith('/merchant_payouts')) payload = { scheduled:[], pending_sales:[] }
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':Array.isArray(payload) && payload.length ? `0-${payload.length - 1}/${payload.length}` : '*/0' }, body:JSON.stringify(object ? (payload[0] ?? null) : payload) })
  })
  await page.route('**/functions/v1/sync-trendyol', async route => {
    refreshed = true
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, records_synced:transactions.length }) })
  })

  await page.goto('/statement?tab=settlements')
  await expect(page.getByRole('heading', { name:'الأرباح والتحصيل' })).toBeVisible()
  const panel = page.getByRole('region', { name:'مطابقة التسويات والتحويلات' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('مطابقة', { exact:true }).last()).toBeVisible()
  await expect(panel.getByText('بانتظار التحويل', { exact:true })).toBeVisible()
  await expect(panel.getByText('يوجد فرق', { exact:true })).toBeVisible()
  const settlementWithVariance = panel.locator('details').filter({ hasText:'تسوية SET-3' })
  await settlementWithVariance.getByText(/تسوية SET-3/).click()
  await expect(settlementWithVariance.getByText('الفرق').first().locator('..')).toContainText('5.00')
  await expect(panel.getByText(/JSON|transaction_type|net_amount/)).toHaveCount(0)
  const bankPanel = page.getByRole('region', { name:'المطابقة مع كشف البنك' })
  await expect(bankPanel).toBeVisible()
  await expect(bankPanel.getByText('وصل ومطابق', { exact:true })).toBeVisible()
  await expect(bankPanel.getByText('مطابقة محتملة', { exact:true })).toBeVisible()
  await expect(bankPanel.getByText(/JSON|transaction_key|bank_transaction_id/)).toHaveCount(0)
  await bankPanel.getByRole('button', { name:'تأكيد المطابقة' }).click()
  await expect(bankPanel.getByText('مؤكد من فريقك', { exact:true })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'مطابقة تسويات Trendyol')
  await panel.getByRole('button', { name:'تحديث من Trendyol' }).click()
  await expect.poll(() => refreshed).toBe(true)
  await expect(page.getByText('تم تحديث معاملات وتسويات Trendyol وإعادة المطابقة.')).toBeVisible()
  await page.screenshot({ path:testInfo.outputPath('settlement-reconciliation.png'), fullPage:false })
  await bankPanel.screenshot({ path:testInfo.outputPath('bank-reconciliation.png') })
  expect(runtimeErrors).toEqual([])
})

test('accountant imports an Arabic bank statement without exposing the full account number', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  let committedRows: any[] = []
  const uploadId = '10000000-0000-4000-8000-000000000001'

  await page.route('**/rest/v1/platform_file_uploads**', async route => {
    const method = route.request().method()
    const object = (route.request().headers().accept || '').includes('application/vnd.pgrst.object')
    const body = method === 'POST' ? (object ? { id:uploadId } : [{ id:uploadId }]) : []
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'*/0' }, body:JSON.stringify(body) })
  })
  await page.route('**/rest/v1/bank_transactions**', route => route.fulfill({
    status:200, contentType:'application/json', headers:{ 'content-range':committedRows.length ? `0-${committedRows.length - 1}/${committedRows.length}` : '*/0' },
    body:JSON.stringify(committedRows.map((row, index) => ({ id:`bank-import-${index}`, ...row, net_amount:Number(row.credit || 0) - Number(row.debit || 0) }))),
  }))
  await page.route('**/rest/v1/settlement_bank_matches**', route => route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'*/0' }, body:'[]' }))
  await page.route('**/rest/v1/rpc/commit_my_bank_statement', async route => {
    const body = route.request().postDataJSON() as any
    committedRows = body.p_rows
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ inserted:committedRows.length, processed:committedRows.length }) })
  })
  await page.route('**/storage/v1/object/merchant-imports/**', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ Key:'private-source' }) }))

  await page.goto('/statement?tab=settlements')
  const bankPanel = page.getByRole('region', { name:'المطابقة مع كشف البنك' })
  const csv = [
    'تاريخ العملية,الوصف,الرقم المرجعي,مدين,دائن,الرصيد,رقم الحساب',
    '03/08/2026,تحويل ترنديول SET-1,SET-1,,90.50,1500.50,SA0012345678',
    '04/08/2026,رسوم بنكية,FEE-1,2.25,,1498.25,SA0012345678',
  ].join('\n')
  await bankPanel.locator('input[type=file]').setInputFiles({ name:'bank-august.csv', mimeType:'text/csv', buffer:Buffer.from(csv, 'utf8') })
  await expect(bankPanel.getByText('bank-august.csv')).toBeVisible()
  await expect(bankPanel.getByText(/2 حركة/)).toBeVisible()
  await bankPanel.getByRole('button', { name:'استيراد ومطابقة' }).click()
  await expect(bankPanel.getByText('تم استيراد 2 حركة وإعادة المطابقة.')).toBeVisible()
  expect(committedRows).toHaveLength(2)
  expect(committedRows[0]).toMatchObject({ credit:90.5, debit:0, account_hint:'5678' })
  expect(JSON.stringify(committedRows)).not.toContain('SA0012345678')
  await expect(bankPanel.getByText('SA0012345678')).toHaveCount(0)
  await expectNoSeriousAccessibilityViolations(page, 'استيراد كشف البنك')
  expect(runtimeErrors).toEqual([])
})

test('merchant answers a Trendyol customer question from a dedicated service inbox', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  let status = 'WAITING_FOR_ANSWER'
  let sentReply: any = null
  const question = {
    question_id:'987654321', status, question_text:'هل المنتج مناسب للاستخدام اليومي؟',
    customer_name:'سارة', show_customer_name:true, product_name:'قهوة عربية فاخرة',
    image_url:null, barcode:'COFFEE-1', product_content_id:'product-internal-id', answer_text:null,
    answer_status:null, asked_at:'2026-08-04T09:00:00.000Z', answered_at:null,
    provider_updated_at:'2026-08-04T09:00:00.000Z', last_synced_at:'2026-08-04T09:05:00.000Z',
  }

  await page.route('**/functions/v1/trendyol-actions', async route => {
    const body = route.request().postDataJSON() as any
    if (body.action === 'questions.inbox') {
      await route.fulfill({
        status:200, contentType:'application/json',
        body:JSON.stringify({ ok:true, data:{
          questions:[{ ...question, status }],
          waitingCount:status === 'WAITING_FOR_ANSWER' ? 1 : 0,
          replies:sentReply ? [{ id:'reply-1', question_id:question.question_id, answer_text:sentReply.payload.text, status:'sent', requested_at:'2026-08-04T10:00:00.000Z', completed_at:'2026-08-04T10:00:01.000Z' }] : [],
        }}),
      })
      return
    }
    if (body.action === 'questions.answer') {
      sentReply = body
      status = 'ANSWERED'
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'success' }) })
      return
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, data:{ content:[question], totalElements:1 } }) })
  })

  await page.goto('/customers')
  await expect(page.getByRole('heading', { name:'خدمة العملاء' })).toBeVisible()
  await expect(page.getByText('هل المنتج مناسب للاستخدام اليومي؟')).toBeVisible()
  await expect(page.getByText('987654321')).toHaveCount(0)
  await expect(page.getByText('product-internal-id')).toHaveCount(0)
  await expectNoSeriousAccessibilityViolations(page, 'صندوق خدمة عملاء Trendyol')
  await testInfo.attach('customer-service-inbox', { body:await page.screenshot({ fullPage:false }), contentType:'image/png' })

  const answer = 'نعم، المنتج مناسب للاستخدام اليومي ويمكن تحضيره بالطريقة المعتادة.'
  await page.getByRole('textbox', { name:'الرد على سؤال قهوة عربية فاخرة' }).fill(answer)
  await page.getByRole('button', { name:'مراجعة الرد' }).click()
  await expect(page.getByRole('dialog', { name:'مراجعة الرد قبل الإرسال' })).toContainText(answer)
  await page.getByRole('button', { name:'تأكيد الإرسال' }).click()
  await expect(page.getByText('تم إرسال الرد إلى Trendyol للمراجعة.')).toBeVisible()
  expect(sentReply).toMatchObject({
    merchant_code:merchant.merchant_code,
    action:'questions.answer',
    path:{ questionId:'987654321' },
    payload:{ text:answer },
    confirm:true,
  })

  await page.getByRole('button', { name:/سجل الردود/ }).click()
  await expect(page.getByText(answer)).toBeVisible()
  await expect(page.getByText('تم الإرسال', { exact:true })).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

test('merchant imports a Noon order and goes directly to the resulting orders', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  const importedOrder = {
    id: 'noon-order-e2e', merchant_code: merchant.merchant_code, platform: 'noon', order_id: 'N-1001',
    status: 'delivered', product_name: null, sku: 'SKU-1001', quantity: 1, unit_price: 85,
    total_amount: 85, gross_amount: 85, platform_fee: 0, shipping_cost: 0, discount_amount: 0,
    currency: 'SAR', customer_city: null, order_date: '2026-08-03T10:00:00.000Z', created_at: '2026-08-04T10:00:00.000Z',
  }
  let saved = false
  let insertedOrders: unknown[] = []

  await page.route('**/storage/v1/object/merchant-imports/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'merchant-imports/source.csv' }),
  }))
  await page.route('**/rest/v1/rpc/commit_my_file_import**', async route => {
    const body = route.request().postDataJSON() as { p_payloads?: Array<{ table: string; rows: unknown[] }> }
    insertedOrders = body.p_payloads?.find(payload => payload.table === 'orders')?.rows || []
    saved = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        inserted: insertedOrders.length,
        processed: insertedOrders.length,
        derived: { amazon_orders_derived: 0, platform_prices_derived: 0, returns_derived: 0 },
      }),
    })
  })
  await page.route('**/rest/v1/platform_file_uploads**', async route => {
    const method = route.request().method()
    const url = new URL(route.request().url())
    if (method === 'POST') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'upload-noon-e2e' }) })
      return
    }
    if (method === 'PATCH') {
      if (route.request().postDataJSON()?.status === 'success') saved = true
      await route.fulfill({ status: 204, body: '' })
      return
    }
    const duplicateLookup = url.searchParams.has('fingerprint')
    const rows = saved && !duplicateLookup ? [{
      id: 'upload-noon-e2e', merchant_code: merchant.merchant_code, platform: 'noon', file_name: 'noon-sales.csv',
      file_type: 'noon_sales', detected_report: 'مبيعات نون', status: 'success', rows_inserted: 1,
      uploaded_at: '2026-08-04T10:00:00.000Z', storage_path: `${merchant.merchant_code}/upload-noon-e2e/noon-sales.csv`,
    }] : []
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': rows.length ? '0-0/1' : '*/0' }, body: JSON.stringify(rows) })
  })
  await page.route('**/rest/v1/orders**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': saved ? '0-0/1' : '*/0' }, body: JSON.stringify(saved ? [importedOrder] : []) })
  })

  await page.goto('/integrations')
  await page.getByRole('button', { name: 'رفع ملفات الآن' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'noon-sales.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'item_nr,partner_sku,sku,brand_code,family,fulfillment_model,status,offer_price,gmv_lcy,currency_code,order_timestamp,shipment_timestamp,delivered_timestamp',
      'N-1001,SKU-1001,NOON-1001,BRAND,coffee,FBN,delivered,85,85,SAR,2026-08-03T10:00:00Z,2026-08-03T11:00:00Z,2026-08-04T10:00:00Z',
    ].join('\n')),
  })

  await expect(page.getByText('مبيعات نون', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'حفظ الكل' }).click()
  await expect(page.getByRole('heading', { name: 'اكتمل استيراد بيانات متجرك' })).toBeVisible()
  await expect(page.getByText('السجلات المعالجة').locator('..').getByText('1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'عرض الطلبات' })).toBeVisible()
  await expect(page.getByText('الملفات المرفوعة سابقًا (1)')).toBeVisible()
  await expect.poll(() => insertedOrders).toHaveLength(1)
  await expect.poll(() => insertedOrders[0]).toMatchObject({ merchant_code: merchant.merchant_code, order_id: 'N-1001', platform: 'noon' })
  await expectNoSeriousAccessibilityViolations(page, 'نتيجة استيراد ملف منصة')
  await page.screenshot({ path: testInfo.outputPath('merchant-import-complete.png'), fullPage: true })

  await page.getByRole('button', { name: 'عرض الطلبات' }).click()
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByRole('button', { name: 'N-1001' })).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

test('merchant can identify and validate a custom Salla order export without administration help', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  await page.route('**/rest/v1/platform_file_uploads**', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: '[]',
  }))

  await page.goto('/integrations')
  await expect(page.getByText('طلبات جاهزة للرفع', { exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'رفع ملفات الآن' }).click()
  const platformSelect = page.getByLabel('منصة الملف')
  await expect(platformSelect).toBeVisible()
  await platformSelect.selectOption('salla')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'orders-custom.csv', mimeType: 'text/csv',
    buffer: Buffer.from([
      'رقم الطلب,حالة الطلب,إجمالي الطلب,تاريخ الطلب,اسم المنتج,SKU,الكمية,العملة,المدينة',
      'S-1001,تم التسليم,120,01/08/2026,قهوة عربية,SKU-1,1,SAR,الرياض',
      'S-1001,تم التسليم,120,01/08/2026,تمر فاخر,SKU-2,2,SAR,الرياض',
    ].join('\n'), 'utf8'),
  })

  await expect(page.getByText('طلبات سلة', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'حفظ الكل' })).toBeEnabled()
  await expectNoSeriousAccessibilityViolations(page, 'رفع طلبات سلة بقالب مخصص')
  await page.screenshot({ path: testInfo.outputPath('salla-custom-orders-ready.png'), fullPage: true })
  expect(runtimeErrors).toEqual([])
})

test('duplicate merchant file reaches a final skipped state without repeated saving', async ({ page }) => {
  await mockAuthenticatedMerchant(page)
  await page.route('**/rest/v1/platform_file_uploads**', async route => {
    const method = route.request().method()
    const url = new URL(route.request().url())
    if (method === 'GET' && url.searchParams.has('fingerprint')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
        id: 'existing-upload', uploaded_at: '2026-08-03T10:00:00.000Z', file_name: 'noon-sales.csv', rows_inserted: 1,
        storage_path: `${merchant.merchant_code}/existing-upload/noon-sales.csv`,
      }]) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/integrations')
  await page.getByRole('button', { name: 'رفع ملفات الآن' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'noon-sales.csv', mimeType: 'text/csv',
    buffer: Buffer.from('item_nr,partner_sku,sku,status,offer_price,gmv_lcy,currency_code,order_timestamp\nN-1001,SKU-1001,NOON-1001,delivered,85,85,SAR,2026-08-03T10:00:00Z'),
  })
  await expect(page.getByText(/هذا الملف مرفوع مسبقاً/)).toBeVisible()
  await page.getByRole('button', { name: 'حفظ الكل' }).click()
  await expect(page.getByText('مكرر — تم التخطي', { exact: true })).toBeVisible()
  await expect(page.getByText(/تُخطّي 1 ملف مكرر/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'حفظ الكل' })).toHaveCount(0)
  await expect(page.getByText('اكتمل', { exact: true }).first()).toBeVisible()
})

test('failed file uploads do not mark a new merchant data source as ready', async ({ page }) => {
  await mockAuthenticatedMerchant(page)
  let uploadStatusFilter = ''
  await page.route('**/functions/v1/manage-platform-credentials', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ credentials: [] }),
  }))
  await page.route('**/rest/v1/platform_file_uploads**', async route => {
    uploadStatusFilter = new URL(route.request().url()).searchParams.get('status') || ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '*/0' },
      body: '[]',
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'جاهزية مساحة العمل' })).toBeVisible()
  await expect(page.getByText('اربط Trendyol أو ارفع ملف منصة لإحضار بياناتك.')).toBeVisible()
  expect(uploadStatusFilter).toContain('success')
  expect(uploadStatusFilter).toContain('completed')
  expect(uploadStatusFilter).toContain('done')
  expect(uploadStatusFilter).not.toContain('failed')
  expect(uploadStatusFilter).not.toContain('partial')
})

test('first-time merchant completes onboarding without administration assistance', async ({ page }, testInfo) => {
  await mockAuthenticatedMerchant(page)
  const firstTimeMerchant = { ...merchant, onboarding_done: false }
  let persisted = false
  await page.route('**/rest/v1/merchants**', async route => {
    if (route.request().method() === 'PATCH') {
      persisted = route.request().postDataJSON()?.onboarding_done === true
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.pgrst.object+json',
        body: JSON.stringify({ id: merchant.id, onboarding_done: true }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify([firstTimeMerchant]),
    })
  })

  await page.goto('/')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'مرحبًا بك في Sellpert' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('first-time-onboarding.png'), fullPage: true })
  await page.getByRole('button', { name: /متابعة/ }).click()
  await page.getByRole('button', { name: /متابعة/ }).click()
  await page.getByRole('button', { name: /متابعة/ }).click()
  await page.getByRole('button', { name: 'الذهاب إلى الربط ورفع الملفات' }).click()

  await expect.poll(() => persisted).toBe(true)
  await expect(page).toHaveURL(/\/integrations$/)
  await expect(page.getByRole('heading', { name: 'الربط ورفع الملفات' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('core merchant workspace is accessible and stable before the first import', async ({ page }) => {
  test.setTimeout(60_000)
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  const routes = [
    { path: '/', heading: 'مركز قرارات المتجر', context: 'نظرة عامة' },
    { path: '/orders', heading: 'لا توجد طلبات بعد', context: 'الطلبات' },
    { path: '/products', heading: 'المنتجات', context: 'المنتجات' },
    { path: '/inventory', heading: 'المخزون', context: 'المخزون' },
    { path: '/statement', heading: 'الأرباح والتحصيل', context: 'الأرباح والتحصيل' },
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

test('financial statement never presents partial order costs as net profit', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  const performanceRows = [
    { id:'perf-noon-sales', merchant_code:merchant.merchant_code, platform:'noon', data_date:'2026-08-01', total_sales:65, order_count:2, platform_fees:8.97, ad_spend:0 },
    { id:'perf-noon-ads', merchant_code:merchant.merchant_code, platform:'noon', data_date:'2026-08-02', total_sales:0, order_count:0, platform_fees:0, ad_spend:835.48 },
    { id:'perf-trendyol-summary', merchant_code:merchant.merchant_code, platform:'trendyol', data_date:'2026-08-02', total_sales:4785, order_count:165, platform_fees:0, ad_spend:0 },
  ]
  const orderFacts = [
    { id:'order-detail-1', order_id:'NOON-1', merchant_code:merchant.merchant_code, platform:'noon', status:'shipped', sku:'SKU-1', quantity:1, total_amount:30, upload_id:'upload-1', order_date:'2026-08-01T08:00:00Z' },
    { id:'order-detail-2', order_id:'NOON-2', merchant_code:merchant.merchant_code, platform:'noon', status:'shipped', sku:'SKU-1', quantity:1, total_amount:35, upload_id:'upload-1', order_date:'2026-08-01T09:00:00Z' },
  ]
  const fulfillRows = (route: Route, rows: unknown[]) => route.fulfill({
    status:200,
    contentType:'application/json',
    headers:{ 'content-range':rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' },
    body:JSON.stringify(rows),
  })

  await page.route('**/rest/v1/performance_data**', route => fulfillRows(route, performanceRows))
  await page.route('**/rest/v1/rpc/list_order_operating_facts**', route => fulfillRows(route, orderFacts))
  await page.route('**/rest/v1/products**', route => fulfillRows(route, [{ id:'product-1', merchant_code:merchant.merchant_code, sku:'SKU-1', cost_price:10 }]))
  await page.route('**/rest/v1/ad_metrics**', route => fulfillRows(route, [{ id:'ad-1', merchant_code:merchant.merchant_code, platform:'noon', report_date:'2026-08-02', upload_id:'ads-upload' }]))

  await page.goto('/statement')
  await expect(page.getByRole('heading', { name:'الأرباح والتحصيل' })).toBeVisible()
  await expect(page.getByText('تفاصيل الطلبات تغطي 1% فقط من قيمة المبيعات. نعرض الصافي بعد التكاليف المعروفة ولا نسميه ربحًا حتى تكتمل الطلبات.')).toBeVisible()
  await expect(page.getByText('الصافي بعد التكاليف المعروفة', { exact:true }).first()).toBeVisible()
  await expect(page.getByText('صافي الربح التقديري', { exact:true })).toHaveCount(0)

  await page.getByRole('tab', { name:'تحليلات واتجاهات' }).click()
  await expect(page.getByText('هذه قائمة مؤقتة وليست صافي ربح نهائيًا؛ لن نعتمد تكلفة جزئية على كامل المبيعات.')).toBeVisible()
  await expect(page.getByText('تفاصيل الطلبات تغطي 1% من المبيعات')).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'قائمة مالية ببيانات طلبات جزئية')
  await page.screenshot({ path:testInfo.outputPath('partial-financial-data.png'), fullPage:true })
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

test('merchant can trace every order back to its API sync or uploaded source file', async ({ page }) => {
  await mockAuthenticatedMerchant(page)

  const uploadedAt = '2026-08-05T08:30:00.000Z'
  const syncedAt = '2026-08-05T09:45:00.000Z'
  const fileOrder = {
    id: 'order-file-lineage', merchant_code: merchant.merchant_code, platform: 'salla', order_id: 'SALLA-1001',
    status: 'delivered', product_name: 'منتج من ملف سلة', sku: 'SALLA-SKU', quantity: 1,
    unit_price: 80, total_amount: 80, gross_amount: 80, platform_fee: 4, shipping_cost: 0,
    discount_amount: 0, commission_rate: 5, vat_rate: 15, currency: 'SAR', customer_city: 'الرياض',
    order_date: '2026-08-05T08:00:00.000Z', created_at: uploadedAt, upload_id: 'upload-salla-1', last_synced_at: null,
    shipment_package_id: null, cargo_tracking_number: null, cargo_provider: null,
  }
  const apiOrder = {
    ...fileOrder,
    id: 'order-api-lineage', platform: 'amazon', order_id: 'AMAZON-1002', product_name: 'منتج من ربط أمازون',
    sku: 'AMAZON-SKU', upload_id: null, last_synced_at: syncedAt, order_date: '2026-08-05T09:00:00.000Z',
  }

  const fulfillRows = async (route: Route, rows: unknown[]) => {
    const wantsObject = (route.request().headers().accept || '').includes('application/vnd.pgrst.object')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' },
      body: JSON.stringify(wantsObject ? (rows[0] ?? null) : rows),
    })
  }

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    if (table === 'merchants') {
      await route.fallback()
      return
    }
    if (table === 'orders') {
      const select = url.searchParams.get('select') || ''
      await fulfillRows(route, select.includes('shipment_address')
        ? [{ raw: {}, shipment_address: { city: 'الرياض' }, invoice_address: { city: 'الرياض' }, last_synced_at: null, gross_amount: 80 }]
        : [apiOrder, fileOrder])
      return
    }
    if (table === 'platform_file_uploads') {
      await fulfillRows(route, [{
        id: 'upload-salla-1', platform: 'salla', file_name: 'طلبات-سلة-أغسطس.xlsx',
        file_type: 'salla_orders', uploaded_at: uploadedAt,
      }])
      return
    }
    await fulfillRows(route, [])
  })

  await page.goto('/orders')
  await expect(page.getByText('ملف سلة', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('API أمازون', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: fileOrder.order_id }).click()

  const dialog = page.getByRole('dialog', { name: `تفاصيل الطلب ${fileOrder.order_id}` })
  await expect(dialog.getByText('طلبات-سلة-أغسطس.xlsx', { exact: true })).toBeVisible()
  await expect(dialog.getByText('تاريخ رفع الملف', { exact: true })).toBeVisible()
  await expect(dialog.getByText('مصدر غير محدد', { exact: true })).toHaveCount(0)
})

test('platform comparison uses canonical orders and never product snapshots', async ({ page }) => {
  await mockAuthenticatedMerchant(page)
  let snapshotsRequested = false
  const comparisonOrders = [
    {
      id:'compare-amazon-1', merchant_code:merchant.merchant_code, platform:'amazon', order_id:'AMZ-1', status:'delivered',
      product_name:'منتج أمازون', sku:'AMZ-SKU', quantity:1, unit_price:300, total_amount:300, platform_fee:30,
      shipping_cost:0, currency:'SAR', customer_city:'Riyadh', order_date:'2026-08-05T08:00:00Z', created_at:'2026-08-05T08:00:00Z',
    },
    {
      id:'compare-trendyol-1', merchant_code:merchant.merchant_code, platform:'trendyol', order_id:'TY-1', status:'delivered',
      product_name:'منتج ترنديول', sku:'TY-SKU-1', quantity:1, unit_price:100, total_amount:100, platform_fee:10,
      shipping_cost:0, currency:'SAR', customer_city:'Jeddah', order_date:'2026-08-05T09:00:00Z', created_at:'2026-08-05T09:00:00Z',
    },
    {
      id:'compare-trendyol-2', merchant_code:merchant.merchant_code, platform:'trendyol', order_id:'TY-2', status:'cancelled',
      product_name:'منتج ترنديول', sku:'TY-SKU-2', quantity:1, unit_price:50, total_amount:50, platform_fee:5,
      shipping_cost:0, currency:'SAR', customer_city:'Jeddah', order_date:'2026-08-05T10:00:00Z', created_at:'2026-08-05T10:00:00Z',
    },
  ]

  await page.route('**/rest/v1/product_performance_snapshots**', async route => {
    snapshotsRequested = true
    await route.fulfill({
      status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' },
      body:JSON.stringify([{ platform:'trendyol', sold:999, net_sold:999, gross_sales:999999, snapshot_date:'2026-08-05' }]),
    })
  })
  await page.route('**/rest/v1/orders**', route => route.fulfill({
    status:200, contentType:'application/json', headers:{ 'content-range':'0-2/3' }, body:JSON.stringify(comparisonOrders),
  }))

  await page.goto('/orders')
  await page.getByRole('button', { name:'مقارنة المنصات' }).click()

  await expect(page.getByText('المقارنة مبنية على سجل الطلبات الظاهر ومرشحات الفترة والحالة الحالية فقط؛ ولا تخلط إحصاءات المنتجات المجمعة مع الطلبات.')).toBeVisible()
  await expect(page.locator('[data-testid="platform-comparison-card"][data-platform="amazon"]')).toHaveAttribute('data-order-count', '1')
  await expect(page.locator('[data-testid="platform-comparison-card"][data-platform="amazon"]')).toHaveAttribute('data-revenue', '300')
  await expect(page.locator('[data-testid="platform-comparison-card"][data-platform="trendyol"]')).toHaveAttribute('data-order-count', '2')
  await expect(page.locator('[data-testid="platform-comparison-card"][data-platform="trendyol"]')).toHaveAttribute('data-revenue', '150')
  await expect(page.getByTestId('platform-comparison-card')).toHaveCount(2)
  expect(snapshotsRequested).toBe(false)

  await page.getByLabel('تصفية الطلبات حسب المنصة').selectOption('amazon')
  await expect(page.getByTestId('platform-comparison-card')).toHaveCount(1)
  await expect(page.locator('[data-testid="platform-comparison-card"][data-platform="amazon"]')).toBeVisible()
  await expect(page.locator('[data-testid="platform-comparison-card"][data-platform="trendyol"]')).toHaveCount(0)
})

test('merchant sees the source and age of every inventory quantity and updates only the active tenant', async ({ page }, testInfo) => {
  await mockAuthenticatedMerchant(page)
  const now = new Date()
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
  let inventoryPatch: { url: string; body: Record<string, unknown> } | null = null

  const rows = [
    {
      id:'inventory-api-e2e', merchant_code:merchant.merchant_code, platform:'trendyol', sku:'TRENDYOL-FRESH',
      product_name:'مخزون ترنديول حديث', quantity:18, reserved_quantity:0, low_stock_threshold:5, cost_price:22,
      fulfillment_channel:'Merchant', is_active:true, upload_id:null, platform_source:'trendyol_api_v2',
      last_updated:now.toISOString(), last_synced_at:now.toISOString(), raw:{ variant:{ barcode:'628100000001' } },
    },
    {
      id:'inventory-file-e2e', merchant_code:merchant.merchant_code, platform:'noon', sku:'NOON-STALE',
      product_name:'مخزون نون قديم', quantity:4, reserved_quantity:1, low_stock_threshold:3, cost_price:15,
      fulfillment_channel:'Merchant', is_active:true, upload_id:'upload-noon-stock', platform_source:null,
      last_updated:fiveDaysAgo, last_synced_at:null, raw:{},
    },
  ]

  const fulfillRows = async (route: Route, data: unknown[]) => route.fulfill({
    status:200, contentType:'application/json',
    headers:{ 'content-range':data.length ? `0-${data.length - 1}/${data.length}` : '*/0' },
    body:JSON.stringify(data),
  })

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    if (table === 'merchants') { await route.fallback(); return }
    if (table === 'inventory' && route.request().method() === 'PATCH') {
      inventoryPatch = { url:url.toString(), body:route.request().postDataJSON() as Record<string, unknown> }
      await route.fulfill({ status:204, body:'' })
      return
    }
    if (table === 'inventory') { await fulfillRows(route, rows); return }
    if (table === 'platform_file_uploads') {
      await fulfillRows(route, [{ id:'upload-noon-stock', platform:'noon', file_name:'مخزون-نون-أغسطس.xlsx', file_type:'noon_inventory', uploaded_at:fiveDaysAgo }])
      return
    }
    await fulfillRows(route, [])
  })

  await page.goto('/inventory')
  await expect(page.getByText('API Trendyol', { exact:true })).toBeVisible()
  await expect(page.getByText('ملف نون', { exact:true })).toBeVisible()
  await expect(page.getByText('مخزون-نون-أغسطس.xlsx', { exact:true })).toBeVisible()
  await expect(page.getByText(/لا تعتمد قرار شراء على 1 سجل قديم/)).toBeVisible()
  await page.screenshot({ path:testInfo.outputPath('inventory-lineage-and-freshness.png'), fullPage:true })

  await page.getByRole('button', { name:'عرض السجلات القديمة' }).click()
  await expect(page.getByText('مخزون نون قديم', { exact:true })).toBeVisible()
  await expect(page.getByText('مخزون ترنديول حديث', { exact:true })).toHaveCount(0)
  await page.getByRole('button', { name:'تعديل', exact:true }).click()
  await page.getByLabel('الكمية الجديدة لـ مخزون نون قديم').fill('9')
  await page.getByRole('button', { name:'حفظ', exact:true }).click()

  await expect.poll(() => inventoryPatch).not.toBeNull()
  expect(inventoryPatch!.url).toContain(`merchant_code=eq.${merchant.merchant_code}`)
  expect(inventoryPatch!.body).toMatchObject({ quantity:9, platform_source:'manual_override' })
  await expect(page.getByText('تم حفظ الكمية وتسجيلها كتعديل يدوي.')).toBeVisible()
})

test('merchant follows a synced Trendyol order into product management', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)

  const order = {
    id: 'order-e2e-1', merchant_code: merchant.merchant_code, platform: 'trendyol', order_id: '11344951785',
    status: 'delivered', product_name: 'قهوة تركية 3 كجم', sku: 'TR-4999', quantity: 1,
    unit_price: 54, total_amount: 54, gross_amount: 54, platform_fee: 0, shipping_cost: 2,
    discount_amount: 0, commission_rate: 10, vat_rate: 15, currency: 'SAR', customer_city: 'الرياض',
    order_date: '2026-08-03T10:00:00.000Z', created_at: '2026-08-03T10:00:00.000Z',
    last_synced_at: '2026-08-03T10:05:00.000Z', upload_id: null,
    shipment_package_id: '3941019487', cargo_tracking_number: '4782465687', cargo_provider: 'Starlinks',
  }
  const product = {
    id: 'product-e2e-1', merchant_code: merchant.merchant_code, name: 'قهوة تركية 3 كجم',
    sku: 'TR-4999', barcode: '1492736729', category: 'قهوة', brand: 'Sellpert Test',
    description: 'قهوة تركية محمصة بعناية.', cost_price: 30, target_net_price: 54, sale_price: 54,
    msrp: 60, status: 'active', image_url: null, images: [], external_id: '1492736729',
    raw: {}, upload_id: 'upload-product-e2e', platform_source: 'trendyol_api_v2',
    last_synced_at: '2026-08-04T15:00:00.000Z', created_at: '2026-08-01T08:00:00.000Z',
  }
  const batchId = 'batch-e2e-20260804'
  let sentProductAction: Record<string, any> | null = null
  let productListing: Record<string, any> = {
    id: 'listing-e2e-1', merchant_code: merchant.merchant_code, product_id: product.id,
    platform: 'trendyol', title: product.name, description: product.description, images: [],
    delivery_status: 'success',
  }
  let productActionHistory: Record<string, any>[] = []

  const fulfillRows = async (route: Route, rows: unknown[]) => {
    const accept = route.request().headers().accept || ''
    const wantsObject = accept.includes('application/vnd.pgrst.object')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' },
      body: JSON.stringify(wantsObject ? (rows[0] ?? null) : rows),
    })
  }

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    if (table === 'orders') {
      const select = url.searchParams.get('select') || ''
      await fulfillRows(route, select.includes('shipment_address')
        ? [{ raw: {}, shipment_address: { city: 'الرياض' }, invoice_address: { city: 'الرياض' }, last_synced_at: '2026-08-03T10:05:00.000Z', gross_amount: 54 }]
        : [order])
      return
    }
    if (table === 'products') { await fulfillRows(route, [product]); return }
    if (table === 'platform_file_uploads') {
      await fulfillRows(route, [{ id:'upload-product-e2e', platform:'noon', file_name:'كتالوج-نون.xlsx', file_type:'noon_products', uploaded_at:'2026-08-01T07:55:00.000Z' }])
      return
    }
    if (table === 'order_items') {
      await fulfillRows(route, [{ id: 'item-e2e-1', merchant_code: merchant.merchant_code, platform: 'trendyol', order_id: order.order_id, line_id: 1, sku: product.sku, barcode: product.barcode, product_name: product.name, quantity: 1, unit_price: 54, line_total: 54, commission_rate: 10, shipment_package_id: order.shipment_package_id }])
      return
    }
    if (table === 'order_packages') {
      await fulfillRows(route, [{ id: 'package-e2e-1', merchant_code: merchant.merchant_code, platform: 'trendyol', order_id: order.order_id, shipment_package_id: order.shipment_package_id, status: 'Delivered', provider_status: 'Delivered', cargo_provider: order.cargo_provider, cargo_tracking_number: order.cargo_tracking_number, invoice_number: 'INV-1', invoice_status: 'Invoiced', modified_at: '2026-08-03T10:05:00.000Z', raw: {} }])
      return
    }
    if (table === 'product_profitability') {
      await fulfillRows(route, [{ product_id: product.id, sku: product.sku, product_name: product.name, units_sold: 8, revenue: 432, platform_fees: 49.68, ad_spend: 20, returns_amount: 0, net_profit: 122.32, profit_margin_pct: 28.31, roas: 4.2 }])
      return
    }
    if (table === 'inventory') {
      await fulfillRows(route, [{ id: 'inventory-e2e-1', merchant_code: merchant.merchant_code, platform: 'trendyol', sku: product.sku, product_name: product.name, quantity: 12, fulfillment_channel: 'Merchant' }])
      return
    }
    if (table === 'product_platform_prices') {
      await fulfillRows(route, [{ id: 'price-e2e-1', merchant_code: merchant.merchant_code, product_id: product.id, platform: 'trendyol', sale_price: 54, list_price: 60 }])
      return
    }
    if (table === 'platform_commission_rates') {
      await fulfillRows(route, [{ platform: 'trendyol', category: 'قهوة', commission_rate: 10 }])
      return
    }
    if (table === 'product_platform_listings') {
      if (route.request().method() !== 'GET') {
        const update = route.request().postDataJSON() as Record<string, any>
        productListing = { ...productListing, ...update, id: productListing.id }
        await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' })
        return
      }
      await fulfillRows(route, [productListing])
      return
    }
    if (table === 'list_marketplace_operation_facts') {
      const body = (route.request().postDataJSON() || {}) as Record<string, any>
      const rows = productActionHistory.filter(action =>
        (!body.p_product_id || action.target_id === body.p_product_id) &&
        (!body.p_order_id || action.target_type === 'order' && action.target_id === body.p_order_id),
      )
      await fulfillRows(route, rows)
      return
    }
    if (['product_performance_snapshots', 'returns', 'ad_metrics'].includes(table || '')) {
      await fulfillRows(route, [])
      return
    }
    await route.fallback()
  })

  await page.route('**/functions/v1/trendyol-actions', async route => {
    const body = route.request().postDataJSON() as Record<string, any>
    if (body.action === 'products.batch_result') {
      productListing = { ...productListing, delivery_status: 'success', delivery_error: null, last_verified_at: '2026-08-04T15:31:00.000Z' }
      productActionHistory = productActionHistory.map(action => ({ ...action, status: 'success', finished_at: '2026-08-04T15:31:00.000Z' }))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 'success', pendingApproval: false, error: null }),
      })
      return
    }
    sentProductAction = body
    productActionHistory = [{
      id: 'action-e2e-1', action: body.action, status: 'accepted', error_message: null,
      merchant_code: merchant.merchant_code, platform: 'trendyol', risk_level: 'write',
      reference: 'TY-20260804', started_at: '2026-08-04T15:30:00.000Z', finished_at: null,
      target_type: 'product', target_id: product.id,
    }]
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'accepted', pendingApproval: true, batchRequestId: batchId }),
    })
  })

  await page.goto('/orders')
  await expect(page.getByRole('heading', { name: 'الطلبات' })).toBeVisible()
  await expect(page.getByText('API Trendyol').first()).toBeVisible()
  await page.getByRole('button', { name: order.order_id }).click()

  const orderDialog = page.getByRole('dialog', { name: `تفاصيل الطلب ${order.order_id}` })
  await expect(orderDialog).toBeVisible()
  await expect(orderDialog.getByText('عمولة المنصة', { exact: true })).toBeVisible()
  await expect(orderDialog.getByText('صافي الطلب', { exact: true })).toBeVisible()
  const exactCommission = (-6.21).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س'
  await expect(orderDialog.getByText(exactCommission, { exact: true })).toBeVisible()
  await expect(orderDialog.getByText(order.cargo_tracking_number, { exact: true }).first()).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'تفاصيل طلب Trendyol متزامن')

  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'المنتجات' })).toBeVisible()
  await expect(page.getByText(product.name).first()).toBeVisible()
  await expect(page.getByText('ملف نون + API Trendyol', { exact:true }).first()).toBeVisible()
  await expect(page.getByText('ينقص 1 · 86%', { exact:true }).first()).toBeVisible()
  await expect(page.getByRole('progressbar', { name:'متوسط اكتمال بيانات المنتجات' })).toHaveAttribute('aria-valuenow', '86')
  await page.getByRole('button', { name:/تحتاج محتوى/ }).click()
  await expect(page.getByText(product.name).first()).toBeVisible()
  await page.getByRole('button', { name:/مكتملة/ }).click()
  await expect(page.getByText('لا توجد منتجات ضمن هذا الفلتر', { exact:true })).toBeVisible()
  await page.getByRole('button', { name:'عرض كل المنتجات' }).click()
  await expect(page.getByText(product.name).first()).toBeVisible()
  await page.getByRole('button', { name: 'إدارة المنتج' }).first().click()
  await expect(page).toHaveURL(new RegExp(`/product-detail\\?id=${product.id}`))
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible()
  await expect(page.getByRole('region', { name:'مصدر وجودة بيانات المنتج' }).getByText('كتالوج-نون.xlsx', { exact:true })).toBeVisible()
  await expect(page.getByText('البيانات الناقصة: الصورة.', { exact:true })).toBeVisible()
  await expect(page.getByText('إدارة المنتج في Trendyol')).toBeVisible()
  await expect(page.getByRole('button', { name: 'مراجعة تعديل المنتج' })).toBeVisible()
  await expect(page.getByText(/JSON/)).toHaveCount(0)
  const updatedTitle = 'قهوة تركية 3 كجم - عبوة محسّنة'
  await page.getByLabel('عنوان المنتج في Trendyol').fill(updatedTitle)
  await page.getByRole('button', { name: 'مراجعة تعديل المنتج' }).click()
  await expect(page.getByText('راجع تعديل بيانات المنتج', { exact: true })).toBeVisible()
  await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'تأكيد وإرسال إلى Trendyol' })).toBeVisible()
  await page.getByRole('button', { name: 'تأكيد وإرسال إلى Trendyol' }).click()
  await expect(page.getByText('تم الإرسال إلى Trendyol', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'تقدم تعديل المنتج في Trendyol' })).toHaveAttribute('aria-valuenow', '33')
  await expect(page.getByText('مرجع المتابعة: TY-20260804', { exact: true })).toBeVisible()
  await expect(page.getByText('تعديل محتوى المنتج', { exact: true })).toBeVisible()
  await expect(page.getByText('تعديل قيد المعالجة', { exact: true })).toBeVisible()
  await expect.poll(() => sentProductAction).toMatchObject({
    action: 'products.v2_update_content',
    confirm: true,
    merchant_code: merchant.merchant_code,
    payload: { items: [{ contentId: Number(product.external_id), title: updatedTitle }] },
  })
  await page.getByRole('button', { name: 'تحديث الحالة' }).click()
  await expect(page.getByText('اكتملت المعالجة في Trendyol', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'تقدم تعديل المنتج في Trendyol' })).toHaveAttribute('aria-valuenow', '100')
  await expect(page.getByRole('button', { name: 'مراجعة تعديل المنتج' })).toBeEnabled()
  await expectNoSeriousAccessibilityViolations(page, 'تفاصيل وإدارة منتج Trendyol')

  await page.goto('/notifications')
  await expect(page.getByRole('heading', { name: 'مركز المتابعة' })).toBeVisible()
  await page.getByRole('button', { name: 'تحديث المتابعة' }).click()
  await expect(page.getByRole('status')).toContainText('اكتمل فحص الطلبات والشحن والعملاء والربط')
  const operationsTab = page.getByRole('tab', { name: /^عمليات المنصات/ })
  await expect(operationsTab.getByText('1', { exact:true })).toBeVisible()
  await operationsTab.click()
  await expect(page.getByRole('heading', { name: 'عمليات Trendyol' })).toBeVisible()
  await expect(page.getByText('تعديل محتوى المنتج', { exact: true })).toBeVisible()
  await expect(page.getByText('اكتملت بنجاح', { exact: true })).toBeVisible()
  await expect(page.getByText('TY-20260804', { exact: true })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'سجل عمليات المنصات')
  await page.screenshot({ path:testInfo.outputPath('marketplace-operations.png'), fullPage:true })
  await page.getByRole('button', { name: 'فتح المنتج' }).click()
  await expect(page).toHaveURL(new RegExp(`/product-detail\\?id=${product.id}`))
  expect(runtimeErrors).toEqual([])
})

test('merchant starts preparing ready Trendyol shipments from one reviewed operations queue', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  const order = {
    id:'00000000-0000-4000-8000-000000000551', merchant_code:merchant.merchant_code, platform:'trendyol', order_id:'T-READY-551', status:'pending',
    product_name:'قهوة عربية', sku:'COFFEE-551', quantity:2, unit_price:50, total_amount:100, gross_amount:100, platform_fee:10, shipping_cost:0,
    currency:'SAR', customer_city:'Riyadh', order_date:'2026-08-04T10:00:00Z', upload_id:null, shipment_package_id:'PKG-551', cargo_tracking_number:null,
    cargo_provider:null, commission_rate:10, vat_rate:15, discount_amount:0, created_at:'2026-08-04T10:00:00Z',
  }
  const packageRow = { id:'package-551', order_id:order.order_id, shipment_package_id:'PKG-551', status:'pending', provider_status:'Created', cargo_tracking_number:null, invoice_number:null, invoice_status:null, modified_at:'2026-08-04T10:00:00Z', raw:{} }
  let submitted: any = null

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    const object = (route.request().headers().accept || '').includes('application/vnd.pgrst.object')
    let rows: any[] = []
    if (table === 'merchants') rows = [merchant]
    else if (table === 'orders') rows = [order]
    else if (table === 'product_performance_snapshots') rows = []
    else if (table === 'order_packages') rows = [packageRow]
    else if (table === 'order_items') rows = [{ id:'item-551', order_id:order.order_id, shipment_package_id:packageRow.shipment_package_id, line_id:77551, quantity:2 }]
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }, body:JSON.stringify(object ? (rows[0] ?? null) : rows) })
  })
  await page.route('**/functions/v1/trendyol-actions', async route => {
    submitted = route.request().postDataJSON()
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'success' }) })
  })

  await page.goto('/orders')
  const operations = page.getByRole('region', { name:'مركز تشغيل الطلبات' })
  await expect(operations).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'مركز تشغيل الطلبات')
  await expect(operations.getByRole('button', { name:/بانتظار التجهيز.*1/ })).toBeVisible()
  const taskList = operations.getByRole('list', { name:'مهام تشغيل الطلبات' })
  await expect(taskList.getByText('بدء تجهيز الطلب', { exact:true })).toBeVisible()
  await expect(taskList.getByText(order.order_id, { exact:true })).toBeVisible()
  await taskList.getByRole('button', { name:`فتح الطلب ${order.order_id}` }).click()
  const orderDialog = page.getByRole('dialog', { name:`تفاصيل الطلب ${order.order_id}` })
  await expect(orderDialog).toBeVisible()
  await orderDialog.getByRole('button', { name:'إغلاق' }).click()
  await operations.getByRole('button', { name:'بدء تجهيز الشحنات الجاهزة' }).click()
  const dialog = page.getByRole('dialog', { name:'مراجعة بدء تجهيز الشحنات' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(order.order_id, { exact:true })).toBeVisible()
  await expect(dialog.getByText(/PKG-551|JSON/)).toHaveCount(0)
  await page.screenshot({ path:testInfo.outputPath('order-operations-bulk-picking.png'), fullPage:true })
  await dialog.getByRole('button', { name:'تأكيد بدء تجهيز 1 شحنة' }).click()
  await expect.poll(() => submitted).toMatchObject({
    merchant_code:merchant.merchant_code, action:'packages.status', confirm:true, storefront:'SA',
    path:{ packageId:packageRow.shipment_package_id }, payload:{ status:'Picking', lines:[{ lineId:77551, quantity:2 }], params:{} },
  })
  await expect(operations.getByText('تم بدء تجهيز 1 شحنة في Trendyol بنجاح.')).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

test('merchant sends a customer invoice link from the order without technical fields', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  const order = {
    id:'00000000-0000-4000-8000-000000000552', merchant_code:merchant.merchant_code, platform:'trendyol', order_id:'T-INVOICE-552', status:'processing',
    product_name:'قهوة تركية', sku:'COFFEE-552', quantity:1, unit_price:54, total_amount:54, gross_amount:54, platform_fee:6.21, shipping_cost:0,
    currency:'SAR', customer_city:'Riyadh', order_date:'2026-08-04T10:00:00Z', upload_id:null, shipment_package_id:'552001', cargo_tracking_number:null,
    cargo_provider:null, commission_rate:10, vat_rate:15, discount_amount:0, created_at:'2026-08-04T10:00:00Z', raw:{}, shipment_address:{ city:'Riyadh' }, invoice_address:{ city:'Riyadh' },
  }
  const packageRow = { id:'package-552', order_id:order.order_id, shipment_package_id:'552001', status:'processing', provider_status:'Picking', cargo_tracking_number:null, invoice_number:'INV-OLD', invoice_status:'Rejected', invoice_rejected_reasons:['الصورة غير واضحة'], modified_at:'2026-08-04T10:00:00Z', raw:{} }
  let submitted: any = null

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    const object = (route.request().headers().accept || '').includes('application/vnd.pgrst.object')
    let rows: any[] = []
    if (table === 'merchants') rows = [merchant]
    else if (table === 'orders') rows = [order]
    else if (table === 'order_packages') rows = [packageRow]
    else if (table === 'order_items') rows = [{ id:'item-552', order_id:order.order_id, shipment_package_id:packageRow.shipment_package_id, line_id:77552, quantity:1, unit_price:54, line_total:54, commission_rate:10 }]
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }, body:JSON.stringify(object ? (rows[0] ?? null) : rows) })
  })
  await page.route('**/functions/v1/trendyol-actions', async route => {
    submitted = route.request().postDataJSON()
    await route.fulfill({ status:201, contentType:'application/json', body:JSON.stringify({ ok:true, status:'success' }) })
  })
  page.on('dialog', dialog => dialog.accept())

  await page.goto(`/orders?order=${order.order_id}`)
  await expect(page.getByRole('region', { name:'مركز تشغيل الطلبات' }).getByText('تصحيح الفاتورة', { exact:true })).toBeVisible()
  const dialog = page.getByRole('dialog', { name:`تفاصيل الطلب ${order.order_id}` })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('رابط الفاتورة الإلكتروني').fill('https://billing.example/invoices/T-INVOICE-552.pdf')
  await dialog.getByRole('button', { name:'إرسال رابط الفاتورة' }).click()
  await expect.poll(() => submitted).toMatchObject({
    merchant_code:merchant.merchant_code, action:'invoices.send_link', confirm:true,
    payload:{ shipmentPackageId:packageRow.shipment_package_id, invoiceLink:'https://billing.example/invoices/T-INVOICE-552.pdf' },
  })
  await expect(dialog.getByText('تم إرسال رابط الفاتورة إلى Trendyol وربطه بهذه الشحنة.')).toBeVisible()
  await expect(dialog.getByText('تم إرسال الفاتورة', { exact:true })).toBeVisible()
  await expect(dialog.getByText('sent', { exact:true })).toHaveCount(0)
  await expect(dialog.getByText(/JSON|shipmentPackageId|serviceSourceId/)).toHaveCount(0)
  await expectNoSeriousAccessibilityViolations(page, 'إرسال رابط الفاتورة من الطلب')
  await page.screenshot({ path:testInfo.outputPath('order-invoice-link.png'), fullPage:true })
  expect(runtimeErrors).toEqual([])
})

test('merchant prepares a local product for Trendyol without technical identifiers', async ({ page }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  const productId = '00000000-0000-4000-8000-000000000222'
  const product = {
    id:productId, merchant_code:merchant.merchant_code, name:'قهوة عربية فاخرة', sku:'COFFEE-1', barcode:'628100000001',
    category:'قهوة', brand:'علامة تجريبية', description:'قهوة عربية محمصة بعناية.', target_net_price:54, sale_price:54, msrp:60,
    vat_rate:20, model_code:'MODEL-1', platform_source:'excel', images:[{ url:'https://cdn.example.test/coffee.jpg' }], raw:{ quantity:10 },
  }

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    const accept = route.request().headers().accept || ''
    const object = accept.includes('application/vnd.pgrst.object')
    let rows: any[] = []
    if (table === 'merchants') rows = [merchant]
    else if (table === 'products') rows = [product]
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }, body:JSON.stringify(object ? (rows[0] ?? null) : rows) })
  })
  await page.route('**/functions/v1/trendyol-actions', async route => {
    const body = route.request().postDataJSON() as { action?:string }
    const data = body.action === 'categories.list'
      ? { categories:[{ id:1, name:'الأغذية', subCategories:[{ id:2, name:'القهوة', subCategories:[] }] }] }
      : body.action === 'seller.addresses'
        ? { shipmentAddresses:[{ id:3, addressName:'مستودع الرياض' }], returningAddresses:[{ id:4, addressName:'إرجاع الرياض' }] }
        : body.action === 'brands.search'
          ? { brands:[{ id:5, name:'علامة تجريبية' }] }
          : body.action === 'categories.v2_attributes'
            ? { categoryAttributes:[{ attribute:{ id:6, name:'نوع التحميص' }, required:true, allowCustom:false, attributeValues:[{ id:7, name:'متوسط' }] }] }
            : {}
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, data }) })
  })

  await page.goto(`/product-detail?id=${productId}`)
  await expect(page.getByRole('button', { name:'بدء تجهيز المنتج' })).toBeVisible()
  await page.getByRole('button', { name:'بدء تجهيز المنتج' }).click()
  await expect(page.getByText('تجهيز المنتج للنشر في Trendyol')).toBeVisible()
  await expect(page.locator('input[value="قهوة عربية فاخرة"]')).toBeVisible()

  const brandField = page.locator('label').filter({ hasText:'العلامة التجارية' })
  await brandField.getByRole('button', { name:'بحث' }).click()
  await brandField.getByRole('button', { name:'علامة تجريبية' }).click()
  await expect(brandField.getByText('تم الاختيار: علامة تجريبية')).toBeVisible()

  const categoryField = page.locator('label').filter({ hasText:'فئة Trendyol النهائية' })
  await categoryField.getByRole('textbox').fill('القهوة')
  await categoryField.getByRole('button', { name:/الأغذية.*القهوة/ }).click()
  await expect(page.getByText('نوع التحميص — إلزامي')).toBeVisible()
  await page.getByLabel('نوع التحميص — إلزامي').selectOption('7')
  await page.getByRole('button', { name:'مراجعة المنتج قبل النشر' }).click()
  await expect(page.getByText('راجع المنتج قبل إرساله')).toBeVisible()
  await expect(page.getByRole('button', { name:'تأكيد ونشر في Trendyol' })).toBeVisible()
  await expect(page.getByText(/JSON|معرّف العلامة|معرّف الفئة/)).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test('merchant corrects a rejected Trendyol product and returns it to review', async ({ page }) => {
  await mockAuthenticatedMerchant(page)
  const productId = '00000000-0000-4000-8000-000000000333'
  const product = {
    id:productId, merchant_code:merchant.merchant_code, name:'قهوة عربية فاخرة', sku:'COFFEE-REJECTED', barcode:'628100000002',
    category:'القهوة', brand:'علامة تجريبية', description:'قهوة عربية محمصة بعناية.', target_net_price:54, sale_price:54, msrp:60,
    vat_rate:20, model_code:'MODEL-2', platform_source:'trendyol_api_v2', images:[{ url:'https://cdn.example.test/coffee.jpg' }],
    raw:{ approvalStatus:'rejected', rejection:'الصورة لا تطابق المنتج' },
  }
  const listing = {
    id:'listing-rejected', merchant_code:merchant.merchant_code, product_id:productId, platform:'trendyol', title:product.name,
    description:product.description, images:['https://cdn.example.test/coffee.jpg'], notes:'trendyol_product_create',
    delivery_status:'failed', delivery_error:'الصورة لا تطابق المنتج', external_batch_id:'batch-rejected',
  }
  let submitted: any = null

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    const accept = route.request().headers().accept || ''
    const object = accept.includes('application/vnd.pgrst.object')
    let rows: any[] = []
    if (table === 'merchants') rows = [merchant]
    else if (table === 'products') rows = [product]
    else if (table === 'product_platform_listings') rows = [listing]
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }, body:JSON.stringify(object ? (rows[0] ?? null) : rows) })
  })
  await page.route('**/functions/v1/trendyol-actions', async route => {
    const body = route.request().postDataJSON() as any
    if (body.action === 'products.v2_update_unapproved') {
      submitted = body
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'accepted', batchRequestId:'batch-correction' }) })
      return
    }
    const data = body.action === 'categories.list'
      ? { categories:[{ id:1, name:'الأغذية', subCategories:[{ id:2, name:'القهوة', subCategories:[] }] }] }
      : body.action === 'seller.addresses'
        ? { shipmentAddresses:[{ id:3, addressName:'مستودع الرياض' }] }
        : body.action === 'brands.search'
          ? { brands:[{ id:5, name:'علامة تجريبية' }] }
          : body.action === 'categories.v2_attributes'
            ? { categoryAttributes:[{ attribute:{ id:6, name:'نوع التحميص' }, required:true, allowCustom:false, attributeValues:[{ id:7, name:'متوسط' }] }] }
            : {}
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, data }) })
  })

  await page.goto(`/product-detail?id=${productId}`)
  await expect(page.getByText('رفض Trendyol المنتج')).toBeVisible()
  await expect(page.getByText('الصورة لا تطابق المنتج')).toBeVisible()
  await page.getByRole('button', { name:'بدء تصحيح المنتج' }).click()

  const brandField = page.locator('label').filter({ hasText:'العلامة التجارية' })
  await brandField.getByRole('button', { name:'بحث' }).click()
  await brandField.getByRole('button', { name:'علامة تجريبية' }).click()
  const categoryField = page.locator('label').filter({ hasText:'فئة Trendyol النهائية' })
  await categoryField.getByRole('textbox').fill('القهوة')
  await categoryField.getByRole('button', { name:/الأغذية.*القهوة/ }).click()
  await page.getByLabel('نوع التحميص — إلزامي').selectOption('7')
  await page.getByRole('button', { name:'مراجعة المنتج قبل النشر' }).click()
  await page.getByRole('button', { name:'تأكيد وإعادة المراجعة' }).click()

  await expect.poll(() => submitted).toMatchObject({
    action:'products.v2_update_unapproved', product_id:productId, confirm:true,
    payload:{ items:[{ barcode:product.barcode, title:product.name, stockCode:product.sku }] },
  })
  expect(submitted.payload.items[0]).not.toHaveProperty('quantity')
  expect(submitted.payload.items[0]).not.toHaveProperty('salePrice')
  await expect(page.getByText('تم إرسال المنتج إلى Trendyol')).toBeVisible()
})

test('merchant updates ready Trendyol catalogue prices and inventory in one reviewed batch', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
  await mockAuthenticatedMerchant(page)
  const readyProduct = {
    id:'00000000-0000-4000-8000-000000000444', merchant_code:merchant.merchant_code, name:'قهوة تركية 3 كجم', sku:'COFFEE-BULK-1', barcode:'628100000044',
    category:'القهوة', target_net_price:54, sale_price:54, msrp:60, cost_price:30, status:'active', platform_source:'trendyol_api_v2', created_at:'2026-08-01T10:00:00Z',
  }
  const localProduct = {
    id:'00000000-0000-4000-8000-000000000445', merchant_code:merchant.merchant_code, name:'منتج محلي غير منشور', sku:'LOCAL-1', barcode:'628100000045',
    category:'القهوة', target_net_price:40, sale_price:40, msrp:45, cost_price:20, status:'active', platform_source:'excel', created_at:'2026-08-01T09:00:00Z',
  }
  let submitted: any = null

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    let rows: any[] = []
    if (table === 'merchants') rows = [merchant]
    else if (table === 'products') rows = [readyProduct, localProduct]
    else if (table === 'product_platform_prices') rows = [{ id:'price-1', product_id:readyProduct.id, merchant_code:merchant.merchant_code, platform:'trendyol', selling_price:54, commission_rate:10, is_active:true }]
    else if (table === 'platform_commission_rates') rows = [{ id:'rate-1', platform:'trendyol', category:'default', rate:10, vat_rate:1.5, shipping_fee:0, other_fees:0 }]
    else if (table === 'inventory') rows = [{ sku:readyProduct.sku, partner_sku:null, quantity:12 }]
    else if (table === 'product_platform_listings') rows = [{ product_id:readyProduct.id, delivery_status:'success', delivery_error:null, external_batch_id:null }]
    await route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }, body:JSON.stringify(rows) })
  })
  await page.route('**/functions/v1/trendyol-actions', async route => {
    submitted = route.request().postDataJSON()
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, status:'accepted', batchRequestId:'bulk-price-stock-1' }) })
  })

  await page.goto('/products')
  await expect(page.getByRole('region', { name:'تشغيل كتالوج Trendyol' })).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page, 'تشغيل كتالوج Trendyol جماعيًا')
  await page.getByRole('button', { name:'تحديد الجاهز (1)' }).click()
  await expect(page.getByText('1 منتج محدد')).toBeVisible()
  await page.getByRole('button', { name:'مراجعة وإرسال إلى Trendyol' }).click()
  const dialog = page.getByRole('dialog', { name:'مراجعة تحديث منتجات Trendyol' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(readyProduct.name, { exact:true })).toBeVisible()
  await expect(dialog.getByText('منتج محلي غير منشور', { exact:true })).toHaveCount(0)
  await expect(page.getByText(/JSON/)).toHaveCount(0)
  await page.screenshot({ path:testInfo.outputPath('trendyol-bulk-review.png'), fullPage:true })
  await page.getByRole('button', { name:'تأكيد وإرسال الدفعة' }).click()
  await expect.poll(() => submitted).toMatchObject({
    merchant_code:merchant.merchant_code,
    action:'products.price_inventory', confirm:true, storefront:'SA',
    payload:{ items:[{ barcode:readyProduct.barcode, quantity:12, salePrice:54, listPrice:60 }] },
  })
  await expect(page.getByText('تم إرسال 1 منتج إلى Trendyol، وتتم متابعة الدفعة الآن.')).toBeVisible()
  expect(runtimeErrors).toEqual([])
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
    { sku: 'LOSS-1', product_name: 'منتج بخسارة', quantity: 0, cost_price: 40, stock_value_cost: 0, daily_velocity: 1, sold_30d: 18, days_of_stock: 0, health_status: 'out_of_stock', data_as_of: '2026-07-29', data_age_days: 6 },
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
  await page.route('**/rest/v1/rpc/merchant_health_score**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      score: 72, rating: 'good', confidence: 'medium', coverage_pct: 80,
      data_as_of: '2026-08-04', data_age_days: 1,
      breakdown: {
        readiness: { available: true, score: 80, weight: 20 },
        profitability: { available: true, score: 65, weight: 25 },
        inventory: { available: true, score: 60, weight: 25 },
        demand: { available: true, score: 75, weight: 20 },
        marketing: { available: false, score: null, weight: 10 },
      },
    }),
  }))
  await page.route('**/rest/v1/rpc/revenue_forecast**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      last_30_sales: 100, forecast_30: 110, lower_30: 90, upper_30: 130,
      growth_rate_pct: 10, confidence: 'medium', is_actionable: true,
      observed_days: 30, active_days: 12, data_as_of: '2026-08-04', data_age_days: 1, caveat: 'ليست مبيعات مضمونة',
    }),
  }))
  await page.route('**/rest/v1/rpc/merchant_executive_brief**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      available: false, confidence: 'low', evidence_coverage_pct: 0,
      data_as_of: null, data_age_days: null,
      period: { start: null, end: null, previous_start: null, previous_end: null },
    }),
  }))
  await page.route('**/rest/v1/rpc/my_monthly_goal_progress**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      year: 2026, month: 8, month_start: '2026-08-01', month_end: '2026-08-31',
      target_amount: null, actual_sales: 100, attainment_pct: null, calendar_pace_pct: 16,
      projected_sales: 620, gap_amount: null, days_remaining: 26, required_daily_sales: null,
      active_order_days: 1, status: 'not_set', is_reliable: false,
    }),
  }))
  await page.route('**/rest/v1/rpc/create_my_action**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'action-e2e', created: true }),
  }))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'مركز قرارات المتجر' })).toBeVisible()
  expect(runtimeErrors).toEqual([])
  await expect(page.getByRole('region', { name: 'حداثة أدلة القرار' })).toContainText('تحتاج البيانات إلى تحديث')
  await expect(page.getByRole('region', { name: 'حداثة أدلة القرار' })).toContainText('المخزون')
  await expect(page.getByRole('button', { name: 'تحديث مصادر البيانات' })).toBeVisible()
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
  await page.getByRole('button', { name: 'تحديث مصادر البيانات' }).click()
  await expect(page).toHaveURL(/\/integrations/)
})
