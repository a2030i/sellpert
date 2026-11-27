import { createClient } from 'npm:@supabase/supabase-js@2.104.0'
import { loadAmazonCaller } from '../_shared/amazonActor.ts'
import { authorizeMarketplaceWorkspace } from '../_shared/marketplaceAccountActor.ts'
import { requireMarketplaceAccount } from '../_shared/marketplaceAccountScope.ts'
import { HttpError, json } from '../_shared/sync.ts'
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
Deno.serve(async req => {
  if (req.method==='OPTIONS') return json({ok:true},200,cors)
  if (req.method!=='POST') return json({error:'Method not allowed'},405,cors)
  try {
    const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'') || ''
    if (!token || token===key) throw new HttpError(401,'Unauthorized')
    const admin=createClient(url,key)
    const {data:{user},error}=await admin.auth.getUser(token)
    if (error || !user) throw new HttpError(401,'Unauthorized')
    const caller=await loadAmazonCaller(createClient,url,key,token,user.id)
    const body=await req.json()
    const merchant=await authorizeMarketplaceWorkspace(admin,caller,user.id,body.merchant_code)
    if (body.action==='list') {
      const {data,error}=await admin.from('marketplace_accounts').select('id,merchant_code,platform,label,external_seller_id,status,is_legacy,created_at,updated_at').eq('merchant_code',merchant).order('created_at')
      if (error) throw error
      return json({accounts:data || []},200,cors)
    }
    if (body.action==='create') {
      const platform=String(body.platform || '')
      if (!['amazon','salla','trendyol','noon','zid','warehouse','other'].includes(platform)) throw new HttpError(400,'منصة غير مدعومة')
      const label=String(body.label || '').trim()
      if (!label || label.length>120) throw new HttpError(400,'أدخل اسمًا للحساب من 1 إلى 120 حرفًا')
      const {count,error:countError}=await admin.from('marketplace_accounts').select('id',{count:'exact',head:true}).eq('merchant_code',merchant).eq('is_legacy',false)
      if (countError) throw countError
      if ((count || 0)>=50) throw new HttpError(409,'وصلت إلى الحد الأقصى للحسابات؛ تواصل مع الإدارة')
      const {data,error}=await admin.from('marketplace_accounts').insert({merchant_code:merchant,platform,label}).select('id,platform,label,status').single()
      if (error) throw error
      return json({account:data},200,cors)
    }
    const account=await requireMarketplaceAccount(admin,merchant,String(body.platform || ''),body.marketplace_account_id,false)
    if (body.action==='rename') {
      const label=String(body.label || '').trim()
      if (!label || label.length>120) throw new HttpError(400,'أدخل اسمًا صحيحًا للحساب')
      const {error}=await admin.from('marketplace_accounts').update({label,updated_at:new Date().toISOString()}).eq('id',account.id).eq('merchant_code',merchant)
      if (error) throw error
      return json({ok:true},200,cors)
    }
    if (body.action==='disconnect') {
      const {error}=await admin.rpc('disconnect_marketplace_account',{p_account_id:account.id,p_merchant_code:merchant})
      if (error) throw new HttpError(409,'تعذر إلغاء الربط أثناء المزامنة. أعد المحاولة لاحقًا.')
      return json({ok:true},200,cors)
    }
    throw new HttpError(400,'Unsupported action')
  } catch (error) {
    return json({error:error instanceof HttpError ? error.message : 'تعذر إكمال إدارة حسابات البيع'},error instanceof HttpError ? error.status : 500,cors)
  }
})
