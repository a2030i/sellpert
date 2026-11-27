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

    if (table === 'marketplace_accounts') {
      body = [{id:'00000000-0000-4000-8000-000000000122',merchant_code:merchant.merchant_code,platform:'trendyol',label:'بيانات قديمة',status:'disconnected',is_legacy:true}]
    } else if (table === 'merchants') {
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


const oldNoon='00000000-0000-4000-8000-000000000122'
const active='00000000-0000-4000-8000-000000000123'
const oldAmazon='00000000-0000-4000-8000-000000000125'
const reviewAccounts=[
 {id:oldNoon,merchant_code:merchant.merchant_code,platform:'noon',label:'قديم نون',status:'disconnected',is_legacy:true},
 {id:oldAmazon,merchant_code:merchant.merchant_code,platform:'amazon',label:'قديم أمازون',status:'disconnected',is_legacy:true},
 {id:active,merchant_code:merchant.merchant_code,platform:'trendyol',label:'Trendyol الحالي',status:'active',is_legacy:false},
]
async function reviewFixture(page:Page){
 await mockPhaseOneMerchant(page)
 await page.route('**/rest/v1/marketplace_accounts?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reviewAccounts)}))
}

test('ads finish the complete legacy import and keep the connected account empty',async({page})=>{
 await reviewFixture(page)
 await page.route('**/rest/v1/ad_metrics?*',route=>{
   const u=new URL(route.request().url());const scope=u.searchParams.get('marketplace_account_id')||''
   const f=Number(u.searchParams.get('offset'));const count=scope.includes(oldNoon)?4928:0
   const rows=Array.from({length:Math.max(0,Math.min(1000,count-f))},(_,i)=>({id:String(f+i),marketplace_account_id:f+i===4927?oldAmazon:oldNoon,platform:f+i===4927?'amazon':'noon',campaign_name:'حملة المصدر',spend:1,revenue:2,impressions:10,clicks:1,orders:0,report_date:'2026-11-27',upload_id:'file-'+(f+i===4927?'amazon':'noon')}))
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)})
 })
 await page.goto('/marketing?account=legacy')
 await expect(page.getByText('4,928 ر.س',{exact:true})).toBeVisible({timeout:15000})
 await page.getByRole('combobox',{name:'نطاق حسابات البيع'}).selectOption(active)
 await expect(page.getByRole('heading',{name:'لا توجد بيانات إعلانية بعد'})).toBeVisible()
 await expect(page.getByText('4,928 ر.س',{exact:true})).toHaveCount(0)
})

test('inventory hides legacy shipments and reports missing movement and valuation honestly',async({page},testInfo)=>{
 await reviewFixture(page)
 const requested:string[]=[]
 await page.route(/\/rest\/v1\/inventory[^?]*\?/,route=>{
   const u=new URL(route.request().url()),table=u.pathname.split('/').pop()!
   requested.push(table)
   const selected=(u.searchParams.get('marketplace_account_id')||'').includes(active)
   const f=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit')||1000)
   let rows:any[]=[]
   const base={marketplace_account_id:selected?active:oldNoon,merchant_code:merchant.merchant_code,platform:selected?'trendyol':'noon',quantity:3,reserved_quantity:0,cost_price:0,selling_price:0,stock_value_cost:0,stock_value_retail:0,daily_velocity:0,sold_30d:0,data_age_days:null,data_as_of:null,health_status:'no_sales_data',is_active:true,last_updated:new Date().toISOString(),low_stock_threshold:1,ageing_class:'never_sold',age_days:1,tied_capital:null,last_sold:null}
   if(table==='inventory_pipeline_by_account')rows=selected?[]:[{...base,id:'shipment',asn_number:'NOON-SHIPMENT',asn_sent_at:'2026-11-01',expected_qty:3,delivered_qty:3,lost_qty:0}]
   else if(table==='inventory_reorder_recommendations_by_account')rows=[]
   else if(['inventory','inventory_health_by_account','inventory_ageing_by_account'].includes(table))rows=Array.from({length:selected?810:1},(_,i)=>({...base,id:'inv-'+i,sku:'SKU-'+i,product_name:selected?'منتج الحساب '+i:'منتج قديم نون'}))
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows.slice(f,f+limit))})
 })
 await page.goto('/inventory?account=legacy')
 await expect(page.getByText('NOON-SHIPMENT',{exact:true})).toBeVisible({timeout:15000})
 await page.getByRole('combobox',{name:'نطاق حسابات البيع'}).selectOption(active)
 await expect(page.getByText('بيانات البيع غير كافية لتوصية شراء',{exact:true})).toBeVisible({timeout:15000})
 await expect(page.getByText('لا توجد حاجة شراء عاجلة',{exact:true})).toHaveCount(0)
 await expect(page.getByText('NOON-SHIPMENT',{exact:true})).toHaveCount(0)
 await expect(page.getByText('منتج قديم نون',{exact:true})).toHaveCount(0)
 const valuation=page.getByText('قيمة المخزون (تكلفة)',{exact:true}).locator('..')
 await expect(valuation).toContainText('غير متاح')
 await expect(valuation).toContainText('0 من 810')
 expect(requested).toContain('inventory_ageing_by_account')
 expect(requested).not.toContain('inventory_ageing')
 expect(requested).not.toContain('inventory_pipeline')
 await valuation.scrollIntoViewIfNeeded()
 await page.screenshot({path:testInfo.outputPath('inventory-evidence.png')})
})

test('unconfigured Amazon does not claim automatic synchronization is running',async({page})=>{
 await reviewFixture(page)
 await page.route('**/functions/v1/amazon-connect',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({app_configured:false,connections:[],connection:null})}))
 await page.goto('/integrations')
 await expect(page.getByText('إعداد الربط لدى إدارة سيلبرت غير مكتمل.',{exact:false})).toBeVisible({timeout:15000})
 await expect(page.getByRole('button',{name:'ربط حساب أمازون',exact:true})).toHaveCount(0)
 await expect(page.getByText('لم تبدأ المزامنة لهذا الحساب.',{exact:false})).toBeVisible()
 await expect(page.getByText('سيتاح قريبًا',{exact:false})).toHaveCount(0)
 await expect(page.getByText('تُحدَّث طلبات هذا الحساب',{exact:false})).toHaveCount(0)
})
