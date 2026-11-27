import { expect, test, type Page } from '@playwright/test'
test.use({actionTimeout:15_000})
test.setTimeout(45_000)

const admin={id:'00000000-0000-4000-8000-000000000181',merchant_code:'ADMIN-RETURN',name:'مدير الاختبار',email:'return-admin@example.test',role:'admin',workspace_status:'active',is_active:true,onboarding_done:true}
const merchant={...admin,id:'00000000-0000-4000-8000-000000000182',merchant_code:'M-RETURN',name:'متجر اختبار الرجوع',email:'return-store@example.test',role:'merchant'}
const account={id:'00000000-0000-4000-8000-000000000183',merchant_code:merchant.merchant_code,platform:'amazon',label:'حساب أمازون التجريبي',external_seller_id:'test-seller',status:'pending',is_legacy:false}
const callback='/integrations/amazon/callback?state=test-state&selling_partner_id=test-seller&spapi_oauth_code=test-code'

async function setup(page:Page,options:{deny?:boolean;expired?:boolean;completeFails?:boolean}={}) {
  const encode=(value:object)=>Buffer.from(JSON.stringify(value)).toString('base64url')
  const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:admin.id,role:'authenticated',exp:2_000_000_000})}.e2e`
  await page.addInitScript(({actor,token,merchantCode,expired})=>{
    localStorage.setItem('sellpert-auth-v1',JSON.stringify({access_token:token,refresh_token:'test-refresh',expires_in:3600,expires_at:2_000_000_000,token_type:'bearer',user:{id:actor.id,aud:'authenticated',role:'authenticated',email:actor.email,app_metadata:{provider:'email',providers:['email']},user_metadata:{}}}))
    if(!sessionStorage.getItem('return-fixture-seeded')){
      sessionStorage.setItem('return-fixture-seeded','true')
      sessionStorage.setItem('sellpert.amazonConnectTarget',JSON.stringify({merchant_code:merchantCode,at:Date.now()-(expired?16*60_000:0)}))
    }
  },{actor:admin,token,merchantCode:merchant.merchant_code,expired:options.expired||false})
  await page.route('**/auth/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:admin.id,role:'authenticated',email:admin.email})}))
  await page.route('**/rest/v1/**',async r=>{
    const url=new URL(r.request().url()),table=url.pathname.split('/').pop()
    // The initial account selection can resolve after OAuth completion.
    if(table==='marketplace_accounts')await new Promise(resolve=>setTimeout(resolve,600))
    if(table==='merchants' && url.searchParams.has('merchant_code') && options.deny){await r.fulfill({status:403,contentType:'application/json',body:'{"message":"permission denied","code":"42501"}'});return}
    const rows=table==='merchants'?[url.searchParams.has('merchant_code')?merchant:admin]:table==='marketplace_accounts'?[account]:[]
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)})
  })
  const completions:Record<string,unknown>[]=[]
  await page.route('**/functions/v1/**',async r=>{
    const url=new URL(r.request().url()),body=r.request().postDataJSON()
    if(url.pathname.endsWith('/amazon-connect')){
      if(body.action==='complete'){
        completions.push(body)
        await r.fulfill({status:options.completeFails?400:200,contentType:'application/json',body:JSON.stringify(options.completeFails?{error:'رابط الربط غير صالح، ابدأ الربط من جديد'}:{ok:true})});return
      }
      const connections=completions.length&&!options.completeFails?[{marketplace_account_id:account.id,seller_id:'test-seller',is_active:true,marketplaces:[]}]:[]
      await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({app_configured:true,connections,connection:connections[0]||null})});return
    }
    await r.fulfill({status:200,contentType:'application/json',body:'{"credentials":[],"accounts":[],"channels":[]}'})
  })
  return completions
}

test('admin callback restores the originating workspace and completes exactly once',async({page},testInfo)=>{
  const completions=await setup(page),errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(callback)
  await expect(page.locator('article').filter({has:page.locator('strong',{hasText:'Amazon'})}).getByRole('combobox')).toHaveValue(account.id,{timeout:15_000})
  await expect(page.getByText('تم ربط حساب أمازون بنجاح.',{exact:true})).toBeVisible({timeout:15_000})
  expect(completions).toEqual([{action:'complete',merchant_code:merchant.merchant_code,state:'test-state',selling_partner_id:'test-seller',spapi_oauth_code:'test-code'}])
  await expect(page).toHaveURL(/\/integrations$/)
  expect(await page.evaluate(()=>sessionStorage.getItem('sellpert.amazonConnectTarget'))).toBeNull()
  await expect(page.getByText('متجر اختبار الرجوع').first()).toBeVisible()
  await page.getByText('تم ربط حساب أمازون بنجاح.',{exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({path:`/tmp/pr31-return-${testInfo.project.name}.png`})
  expect(errors).toEqual([])
  await page.reload()
  await expect(page.getByRole('heading',{name:'مركز تشغيل Sellpert',exact:true})).toBeVisible({timeout:15_000})
  expect(completions).toHaveLength(1)
})

test('denied workspace restore never consumes the consent callback',async({page},testInfo)=>{
  const completions=await setup(page,{deny:true})
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(callback)
  await expect(page.getByRole('alert')).toContainText('تعذر فتح مساحة التاجر لإكمال ربط أمازون.',{timeout:15_000})
  expect(completions).toHaveLength(0)
  expect(await page.evaluate(()=>sessionStorage.getItem('sellpert.amazonConnectTarget'))).toBeNull()
  await page.screenshot({path:`/tmp/pr31-return-error-${testInfo.project.name}.png`})
  await page.getByRole('button',{name:'العودة إلى لوحة الإدارة'}).click()
  await expect(page.getByText('تعذر فتح مساحة التاجر لإكمال ربط أمازون. ابدأ الربط من جديد من صفحة الربط والتكاملات.')).toHaveCount(0)
  await expect(page.locator('main').getByRole('heading').first()).toBeVisible({timeout:15_000})
  expect(errors).toEqual([])
})

test('expired return context does not restore a merchant or complete consent',async({page})=>{
  const completions=await setup(page,{expired:true})
  await page.goto(callback)
  await expect(page.getByRole('heading',{name:'مركز تشغيل Sellpert',exact:true})).toBeVisible({timeout:15_000})
  expect(completions).toHaveLength(0)
})

test('failed completion clears callback parameters and never claims connection success',async({page})=>{
  const completions=await setup(page,{completeFails:true})
  await page.goto(callback)
  await expect(page.locator('article').filter({has:page.locator('strong',{hasText:'Amazon'})}).getByRole('combobox')).toHaveValue(account.id,{timeout:15_000})
  await expect(page.getByText('رابط الربط غير صالح، ابدأ الربط من جديد',{exact:true})).toBeVisible({timeout:15_000})
  await expect(page).toHaveURL(/\/integrations$/)
  expect(completions).toHaveLength(1)
  await expect(page.getByText('تم ربط حساب أمازون بنجاح.',{exact:true})).toHaveCount(0)
})
