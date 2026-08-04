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
    shipment_package_id: '3941019487', cargo_tracking_number: '4782465687', cargo_provider: 'Starlinks',
  }
  const product = {
    id: 'product-e2e-1', merchant_code: merchant.merchant_code, name: 'قهوة تركية 3 كجم',
    sku: 'TR-4999', barcode: '1492736729', category: 'قهوة', brand: 'Sellpert Test',
    description: 'قهوة تركية محمصة بعناية.', cost_price: 30, target_net_price: 54, sale_price: 54,
    msrp: 60, status: 'active', image_url: null, images: [], external_id: '1492736729',
    raw: {}, created_at: '2026-08-01T08:00:00.000Z',
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
    if (table === 'marketplace_action_logs') {
      await fulfillRows(route, productActionHistory)
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
      external_batch_id: batchId, started_at: '2026-08-04T15:30:00.000Z', finished_at: null,
      request: body,
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
  await page.getByRole('button', { name: 'إدارة المنتج' }).first().click()
  await expect(page).toHaveURL(new RegExp(`/product-detail\\?id=${product.id}`))
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible()
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
  await expect(page.getByText('اعتمد Trendyol التعديل', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'تقدم تعديل المنتج في Trendyol' })).toHaveAttribute('aria-valuenow', '100')
  await expect(page.getByRole('button', { name: 'مراجعة تعديل المنتج' })).toBeEnabled()
  await expectNoSeriousAccessibilityViolations(page, 'تفاصيل وإدارة منتج Trendyol')

  await page.goto('/notifications')
  await expect(page.getByRole('heading', { name: 'مركز المتابعة' })).toBeVisible()
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
