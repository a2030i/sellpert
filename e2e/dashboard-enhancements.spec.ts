import { expect, test, type Page } from '@playwright/test'

const merchant = {
  id: '00000000-0000-4000-8000-000000000991',
  merchant_code: 'M-DASHBOARD-E2E',
  name: 'متجر الاختبار',
  email: 'dashboard@example.test',
  currency: 'SAR',
  role: 'merchant',
  workspace_status: 'active',
  onboarding_done: true,
  is_active: true,
  owner_merchant_code: null,
  permissions: null,
  created_at: '2026-08-01T08:00:00.000Z',
}

const adminMerchant = { ...merchant, id:'00000000-0000-4000-8000-000000000992', merchant_code:'ADMIN-E2E', name:'مدير الاختبار', email:'admin@example.test', role:'admin' }

function unsignedToken(user=merchant) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: 'authenticated', exp: 2_000_000_000 })}.e2e`
}

async function mockDashboard(page: Page, actor=merchant) {
  let sellpertTerm = actor.role === 'admin'
    ? {merchant_code:merchant.merchant_code,sellpert_fee_type:'none',sellpert_fee_value:0}
    : {merchant_code:merchant.merchant_code,sellpert_fee_type:'percentage',sellpert_fee_value:2.5}
  await page.addInitScript(({ session }) => {
    window.localStorage.setItem('sellpert-auth-v1', JSON.stringify(session))
  }, {
    session: {
      access_token: unsignedToken(actor), refresh_token: 'e2e-refresh', expires_in: 3600,
      expires_at: 2_000_000_000, token_type: 'bearer',
      user: { id: actor.id, aud: 'authenticated', role: 'authenticated', email: actor.email, app_metadata: {}, user_metadata: {}, created_at: actor.created_at },
    },
  })

  await page.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: actor.id, role: 'authenticated', email: actor.email }) }))
  await page.route('**/functions/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/manage-platform-credentials') || path.endsWith('/platform-credentials')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ credentials: [], job: null }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop()
    let body: unknown = []
    if (table === 'unified_product_catalog') body = {
      items:[{ id:'product-1', name:'خلطة القهوة الموحدة', name_en:'Unified Coffee', sku:'MASTER-SKU-1', barcode:'6280000000011', brand:'Sellpert', category:'توابل أخرى', image_url:null, cost_price:50, sale_price:null, target_net_price:100, catalog_status:'active', inventory:12, mappings:[{id:'mapping-1',platform:'noon',identifier_type:'sku',identifier_value:'NOON-SKU-1',status:'linked'}], match_status:'linked' }],
      stats:{total:1,linked:1,review:0,unknown:0}, filtered_count:1,
    }
    if (table === 'merchants') body = url.searchParams.has('id') ? [actor] : actor.role === 'admin' ? [actor,merchant] : [actor]
    if (table === 'orders') body = [
      { order_id:'AMZ-1', platform:'amazon', status:'delivered', product_name:'RAW-AMAZON-CODE', sku:'AMZ-SKU-1', quantity:1, total_amount:100, currency:'SAR', order_date:'2026-08-12T08:00:00Z' },
      { order_id:'NOON-1', platform:'noon', status:'delivered', product_name:'RAW-NOON-CODE', sku:'NOON-SKU-1', quantity:2, total_amount:200, currency:'SAR', order_date:'2026-08-12T10:00:00Z' },
      { order_id:'TY-1', platform:'trendyol', status:'delivered', product_name:'RAW-TRENDYOL-CODE', sku:'TY-SKU-1', quantity:3, total_amount:300, currency:'SAR', order_date:'2026-08-13T10:00:00Z' },
    ]
    if (table === 'order_items') body = [
      { order_id:'TY-1', platform:'trendyol', barcode:'6280000000011', sku:'TY-SKU-1', product_name:'RAW-TRENDYOL-CODE', quantity:3, line_total:300 },
    ]
    if (table === 'inventory') body = [
      { sku:'AMZ-SKU-1', product_name:'RAW-AMAZON-CODE', platform:'amazon', quantity:0, reserved_quantity:0 },
      { sku:'NOON-SKU-1', product_name:'RAW-NOON-CODE', platform:'noon', quantity:12, reserved_quantity:0 },
      { sku:'TY-SKU-1', product_name:'RAW-TRENDYOL-CODE', platform:'trendyol', quantity:0, reserved_quantity:0 },
    ]
    if (table === 'products') body = [
      { id:'product-1', name:'خلطة القهوة الموحدة', name_en:'Unified Coffee', sku:'MASTER-SKU-1', barcode:'6280000000011', psku_code:null, noon_sku_child:null, asin:null, external_id:null, supplier_sku:null, model_code:null, commission_rate:9 },
    ]
    if (table === 'product_platform_prices') body = [{ product_id:'product-1', platform:'noon', selling_price:100, override_price:null, commission_rate:5, category_key:'grocery', commission_source:'category' }]
    if (table === 'platform_fee_categories') body = [{ platform:'noon', category_key:'grocery', commission_rate:5, commission_fbn_fba:null, min_fee_sar:0 }]
    if (table === 'merchant_platform_finance_settings') {
      const posted=route.request().postDataJSON() as {shipping_cost_tax_inclusive?:number}|null
      body=[{platform:'noon',shipping_cost_tax_inclusive:posted?.shipping_cost_tax_inclusive??12}]
    }
    if (table === 'merchant_contract_terms') {
      const posted=route.request().postDataJSON() as {merchant_code?:string;sellpert_fee_type?:'none'|'percentage'|'fixed';sellpert_fee_value?:number}|null
      if (posted?.merchant_code) sellpertTerm={merchant_code:posted.merchant_code,sellpert_fee_type:posted.sellpert_fee_type||'none',sellpert_fee_value:posted.sellpert_fee_value||0}
      body=[sellpertTerm]
    }
    if (table === 'product_channel_mappings') body = [
      { product_id:'product-1', platform:'amazon', identifier_value:'AMZ-SKU-1', source_sku:'AMZ-SKU-1', source_barcode:null, source_name:'RAW-AMAZON-CODE', match_status:'linked' },
      { product_id:'product-1', platform:'noon', identifier_value:'NOON-SKU-1', source_sku:'NOON-SKU-1', source_barcode:null, source_name:'RAW-NOON-CODE', match_status:'linked' },
      { product_id:'product-1', platform:'trendyol', identifier_value:'TY-SKU-1', source_sku:'TY-SKU-1', source_barcode:'6280000000011', source_name:'RAW-TRENDYOL-CODE', match_status:'linked' },
    ]
    const count=Array.isArray(body)?body.length:1
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': count ? `0-${count - 1}/${count}` : '*/0' }, body: JSON.stringify(body) })
  })
}

test('merchant dashboard combines multiple platforms across all dashboard data', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  await mockDashboard(page)
  await page.goto('/')

  const chart = page.locator('.sales-panel')
  await expect(chart.getByRole('heading', { name: 'المبيعات عبر الزمن' })).toBeVisible()
  const platformControl = page.locator('.platform-control')
  await expect(platformControl.locator('summary')).toContainText('كل المنصات')
  await platformControl.locator('summary').click()
  await expect(platformControl.getByRole('checkbox')).toHaveCount(4)

  await platformControl.getByRole('checkbox', { name:'Trendyol' }).uncheck()
  await expect(platformControl.locator('summary')).toContainText('2 منصات')
  await expect(chart.locator('.panel-head p')).toContainText('2 طلبًا')
  await expect(chart.locator('.panel-head p')).toContainText('300')
  await expect(page.getByText('منتجات نافدة', { exact:true }).locator('..').locator('strong')).toHaveText('1')

  await platformControl.getByRole('checkbox', { name:'نون' }).uncheck()
  await expect(platformControl.locator('summary')).toContainText('أمازون')
  await expect(chart.locator('.panel-head p')).toContainText('1 طلبًا')
  await expect(chart.locator('.panel-head p')).toContainText('100')

  await platformControl.getByRole('checkbox', { name:'نون' }).check()
  await expect(chart.locator('.panel-head p')).toContainText('2 طلبًا')
  await expect(chart.locator('.panel-head p')).toContainText('300')
  await page.screenshot({ path:testInfo.outputPath('multi-platform-filter.png'), fullPage:true })

  await expect(page.getByText('خلطة القهوة الموحدة', { exact:true })).toBeVisible()
  await expect(page.getByText('RAW-TRENDYOL-CODE', { exact:true })).toHaveCount(0)
  expect(runtimeErrors).toEqual([])

  await page.getByRole('button', { name:'تسجيل الخروج' }).click()
  await expect(page.getByRole('button', { name:'تسجيل الدخول', exact:true }).last()).toBeVisible()
})

test('product catalog deducts the merchant-wide Sellpert contract fee and saves tax-inclusive shipping', async ({ page }, testInfo) => {
  await mockDashboard(page)
  await page.goto('/product-catalog')
  await page.getByLabel('اختيار منصة حساب الربحية').selectOption('noon')

  await expect(page.getByRole('columnheader', {name:'سعر البيع'})).toBeVisible()
  await expect(page.getByRole('columnheader', {name:'قيمة عمولة المنصة'})).toBeVisible()
  await expect(page.getByRole('columnheader', {name:'عمولة Sellpert'})).toBeVisible()
  await expect(page.getByRole('columnheader', {name:'صافي المبلغ الواصل'})).toBeVisible()
  const row=page.getByRole('row').filter({hasText:'خلطة القهوة الموحدة'})
  await expect(row).toContainText('100')
  await expect(row).toContainText('50')
  await expect(row).toContainText('5%')
  await expect(row).toContainText('5.75')
  await expect(row).toContainText('12')
  await expect(row).toContainText('2.5')
  await expect(row).toContainText('79.75')
  await expect(row).toContainText('29.75')
  await expect(row).toContainText('مربح')

  await page.getByLabel('تكلفة الشحن شاملة الضريبة').fill('15')
  await page.getByRole('button',{name:'حفظ'}).click()
  await expect(row).toContainText('76.75')
  await page.screenshot({path:testInfo.outputPath('catalog-profitability.png'),fullPage:true})
})

test('admin sets one Sellpert contract commission for the whole merchant', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'لوحة الإدارة الحالية مخصصة للشاشات المكتبية')
  await mockDashboard(page,adminMerchant)
  await page.goto('/')
  await page.getByRole('button',{name:'التجار والمنتجات'}).click()
  await page.getByRole('button',{name:'التجار',exact:true}).click()
  await page.getByRole('button',{name:'تعديل عمولة Sellpert لمتجر متجر الاختبار'}).click()
  await page.getByLabel('طريقة احتساب عمولة Sellpert').selectOption('fixed')
  await page.getByLabel('قيمة عمولة Sellpert').fill('4')
  await page.getByRole('button',{name:'حفظ العقد'}).click()
  await expect(page.getByText('تم حفظ عمولة Sellpert لمتجر متجر الاختبار: 4 ر.س')).toBeVisible()
  await expect(page.getByRole('button',{name:'تعديل عمولة Sellpert لمتجر متجر الاختبار'})).toHaveText('4 ر.س')
  await page.screenshot({path:testInfo.outputPath('admin-sellpert-contract-fee.png'),fullPage:true})
})
