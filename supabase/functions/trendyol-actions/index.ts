import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeMerchantSync, HttpError, json } from '../_shared/sync.ts'
import { resolveSecretPayload } from '../_shared/credentialVault.ts'
import { trendyolPackageProviderStatus, trendyolPackageTransitionError } from '../_shared/trendyolPackageWorkflow.ts'
import { decodeTrendyolInvoiceFile } from '../_shared/trendyolInvoice.ts'
import { validateTrendyolAnswerText, validateTrendyolQuestionQuery } from '../_shared/trendyolQuestions.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const API = 'https://apigw.trendyol.com'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
}

type Risk = 'read' | 'write' | 'destructive'
type Definition = { method: string; path: string; risk: Risk; storefront?: boolean; binary?: boolean; multipart?: boolean }

// Every outbound request is selected from this fixed registry. Callers cannot
// provide a host, path, or method, preventing the gateway from becoming SSRF.
const ACTIONS: Record<string, Definition> = {
  // Product catalogue and reference data
  'products.list':            { method:'GET',    path:'/integration/product/sellers/{sellerId}/products', risk:'read' },
  'products.create':          { method:'POST',   path:'/integration/product/sellers/{sellerId}/products', risk:'write' },
  'products.update':          { method:'PUT',    path:'/integration/product/sellers/{sellerId}/products', risk:'write' },
  'products.delete':          { method:'DELETE', path:'/integration/product/sellers/{sellerId}/products', risk:'destructive' },
  'products.archive':         { method:'PUT',    path:'/integration/product/sellers/{sellerId}/products/archive-state', risk:'destructive' },
  'products.unlock':          { method:'PUT',    path:'/integration/product/sellers/{sellerId}/products/unlock', risk:'write' },
  'products.buybox':          { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/buybox-information', risk:'read' },
  'products.qc_audit':        { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/{contentId}/update-audits', risk:'read' },
  'products.price_inventory': { method:'POST',   path:'/integration/inventory/sellers/{sellerId}/products/price-and-inventory', risk:'write', storefront:true },
  'products.batch_result':    { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/batch-requests/{batchRequestId}', risk:'read' },
  'products.v2_create':       { method:'POST',   path:'/integration/product/sellers/{sellerId}/v2/products', risk:'write', storefront:true },
  'products.v2_base':         { method:'GET',    path:'/integration/product/sellers/{sellerId}/product/{barcode}', risk:'read', storefront:true },
  'products.v2_unapproved':   { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/unapproved', risk:'read', storefront:true },
  'products.v2_approved':     { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/approved', risk:'read', storefront:true },
  'products.v2_stock_price':  { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/approved/inventory-and-price', risk:'read', storefront:true },
  'products.v2_update_unapproved': { method:'PUT', path:'/integration/product/sellers/{sellerId}/products/unapproved-bulk-update', risk:'write', storefront:true },
  'products.v2_update_content':    { method:'POST', path:'/integration/product/sellers/{sellerId}/products/content-bulk-update', risk:'write', storefront:true },
  'products.v2_update_variant':    { method:'POST', path:'/integration/product/sellers/{sellerId}/products/variant-bulk-update', risk:'write', storefront:true },
  'products.v2_update_delivery':   { method:'POST', path:'/integration/product/sellers/{sellerId}/products/delivery-info-bulk-update', risk:'write', storefront:true },
  'brands.list':              { method:'GET',    path:'/integration/product/brands', risk:'read' },
  'brands.search':            { method:'GET',    path:'/integration/product/brands/by-name', risk:'read' },
  'brands.create':            { method:'POST',   path:'/integration/product/sellers/{sellerId}/brands', risk:'write' },
  'categories.list':          { method:'GET',    path:'/integration/product/product-categories', risk:'read' },
  'categories.attributes':    { method:'GET',    path:'/integration/product/product-categories/{categoryId}/attributes', risk:'read' },
  'categories.v2_attributes': { method:'GET',    path:'/integration/product/categories/{categoryId}/attributes', risk:'read' },
  'categories.v2_values':     { method:'GET',    path:'/integration/product/categories/{categoryId}/attributes/{attributeId}/values', risk:'read' },
  'videos.list':              { method:'GET',    path:'/integration/video/sellers/{sellerId}/videos', risk:'read' },
  'videos.upload':            { method:'POST',   path:'/integration/video/sellers/{sellerId}/videos', risk:'write' },

  // Orders, packages, cargo and labels
  'orders.list':              { method:'GET', path:'/integration/order/sellers/{sellerId}/orders', risk:'read' },
  'orders.stream':            { method:'GET', path:'/integration/order/sellers/{sellerId}/orders/stream', risk:'read', storefront:true },
  'packages.tracking':        { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/tracking-details', risk:'write', storefront:true },
  'packages.status':          { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}', risk:'write', storefront:true },
  'packages.cancel':          { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/items/unsupplied', risk:'destructive' },
  'packages.split':           { method:'POST',path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/split-packages', risk:'write' },
  'packages.alternative':     { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/alternative-delivery', risk:'write' },
  'packages.cargo_provider':  { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/cargo-providers', risk:'write' },
  'packages.box_info':        { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/box-info', risk:'write' },
  'packages.common_label_create': { method:'POST', path:'/integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}', risk:'write', storefront:true },
  'packages.common_label_get':    { method:'GET',  path:'/integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}', risk:'read', binary:true, storefront:true },
  // Compatibility alias for callers created before the explicit create/get flow.
  'packages.common_label':        { method:'GET',  path:'/integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}', risk:'read', binary:true, storefront:true },
  'seller.addresses':         { method:'GET', path:'/integration/sellers/{sellerId}/addresses', risk:'read' },

  // Customer questions
  'questions.list':           { method:'GET',  path:'/integration/qna/sellers/{sellerId}/questions/filter', risk:'read' },
  'questions.detail':         { method:'GET',  path:'/integration/qna/sellers/{sellerId}/questions/{questionId}', risk:'read' },
  'questions.answer':         { method:'POST', path:'/integration/qna/sellers/{sellerId}/questions/{questionId}/answers', risk:'write' },

  // Webhooks
  'webhooks.list':            { method:'GET',    path:'/integration/webhook/sellers/{sellerId}/webhooks', risk:'read' },
  'webhooks.create':          { method:'POST',   path:'/integration/webhook/sellers/{sellerId}/webhooks', risk:'write' },
  'webhooks.update':          { method:'PUT',    path:'/integration/webhook/sellers/{sellerId}/webhooks/{webhookId}', risk:'write' },
  'webhooks.delete':          { method:'DELETE', path:'/integration/webhook/sellers/{sellerId}/webhooks/{webhookId}', risk:'destructive' },
  'webhooks.activate':        { method:'PATCH',  path:'/integration/webhook/sellers/{sellerId}/webhooks/{webhookId}/activate', risk:'write' },

  // Claims and returns
  'claims.list':              { method:'GET',  path:'/integration/order/sellers/{sellerId}/claims', risk:'read' },
  'claims.create':            { method:'POST', path:'/integration/order/sellers/{sellerId}/claims/create', risk:'write' },
  'claims.approve':           { method:'PUT',  path:'/integration/order/sellers/{sellerId}/claims/{claimId}/items/approve', risk:'write' },
  'claims.reject':            { method:'PUT',  path:'/integration/order/sellers/{sellerId}/claims/{claimId}/issue', risk:'destructive' },
  'claims.issue_reasons':     { method:'GET',  path:'/integration/order/claim-issue-reasons', risk:'read' },
  'claims.audit':             { method:'GET',  path:'/integration/order/sellers/{sellerId}/claims/items/{claimItemId}/audit', risk:'read' },

  // Invoices and finance
  'invoices.send_link':       { method:'POST',   path:'/integration/sellers/{sellerId}/seller-invoice-links', risk:'write' },
  'invoices.send_file':       { method:'POST',   path:'/integration/sellers/{sellerId}/seller-invoice-file', risk:'write', storefront:true, multipart:true },
  'invoices.delete_link':     { method:'DELETE', path:'/integration/sellers/{sellerId}/seller-invoice-links/delete', risk:'destructive' },
  'finance.settlements':      { method:'GET', path:'/integration/finance/che/sellers/{sellerId}/settlements', risk:'read', storefront:true },
  'finance.other':            { method:'GET', path:'/integration/finance/che/sellers/{sellerId}/other-financials', risk:'read', storefront:true },
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:cors })
  if (req.method !== 'POST') return json({ error:'Method not allowed' }, 405, cors)
  const contentLength = Number(req.headers.get('content-length') || 0)
  // A 10 MB invoice expands to about 13.4 MB when transported as base64 JSON.
  if (contentLength > 15_000_000) return json({ error:'حجم الطلب يتجاوز الحد المسموح' }, 413, cors)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  let logId = ''
  try {
    const input = await req.json()
    const merchantCode = String(input?.merchant_code || '')
    const action = String(input?.action || '')
    if (!merchantCode) throw new HttpError(400, 'merchant_code مطلوب')
    await authorizeMerchantSync(req, admin, SERVICE_KEY, merchantCode)
    const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
    const actorId = bearer && bearer !== SERVICE_KEY
      ? (await admin.auth.getUser(bearer)).data?.user?.id || null
      : null
    const definition = ACTIONS[action]
    if (!definition) throw new HttpError(400, 'عملية Trendyol غير مدعومة')
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
    const { count: recentCount } = await admin.from('marketplace_action_logs')
      .select('id', { count:'exact', head:true }).eq('merchant_code',merchantCode)
      .eq('platform','trendyol').gte('started_at',oneMinuteAgo)
    if ((recentCount || 0) >= 60) throw new HttpError(429, 'تم تجاوز حد العمليات المؤقت؛ حاول بعد دقيقة')
    if (definition.risk !== 'read' && input?.confirm !== true) {
      throw new HttpError(409, 'يجب تأكيد العملية قبل إرسالها إلى Trendyol')
    }
    validateActionInput(action, input)
    await validatePackageContext(admin, merchantCode, action, input)
    const idempotencyKey = clean(req.headers.get('idempotency-key') || input?.idempotency_key)
    if (definition.risk !== 'read' && !idempotencyKey) throw new HttpError(400, 'idempotency_key مطلوب للعمليات التي تغيّر البيانات')

    if (idempotencyKey) {
      const { data: previous } = await admin.from('marketplace_action_logs')
        .select('status,response,error_message,external_batch_id').eq('merchant_code', merchantCode)
        .eq('platform','trendyol').eq('action',action).eq('idempotency_key',idempotencyKey).maybeSingle()
      if (previous && ['success','accepted','processing','partial'].includes(previous.status)) {
        return json({ ok:true, replayed:true, status:previous.status, data:previous.response, batchRequestId:previous.external_batch_id }, 200, cors)
      }
      if (previous?.status === 'running') throw new HttpError(409, 'العملية نفسها قيد التنفيذ')
    }

    const credentials = await resolveCredentials(admin, merchantCode)
    const path = buildPath(definition.path, { sellerId:credentials.sellerId, ...(input?.path || {}) })
    const url = new URL(path, API)
    for (const [key, value] of Object.entries(input?.query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    const safeRequest = sanitize({ path:input?.path || {}, query:input?.query || {}, payload:input?.payload || null })
    const { data: log, error: logError } = await admin.from('marketplace_action_logs').insert({
      merchant_code:merchantCode, platform:'trendyol', action, risk_level:definition.risk,
      idempotency_key:idempotencyKey || null, status:'running', request:safeRequest, created_by:actorId,
    }).select('id').single()
    if (logError) throw logError
    logId = log.id

    const headers: Record<string,string> = {
      Authorization:`Basic ${btoa(`${credentials.apiKey}:${credentials.apiSecret}`)}`,
      'User-Agent':`${credentials.sellerId} - Sellpert`, Accept:'application/json',
    }
    if (definition.storefront) headers.storeFrontCode = clean(input?.storefront) || 'SA'
    if (definition.storefront && input?.language) headers['Accept-Language'] = clean(input.language)
    let body: BodyInit | undefined
    if (definition.multipart) {
      const invoice = decodeTrendyolInvoiceFile(input?.payload)
      const form = new FormData()
      form.append('shipmentPackageId', invoice.shipmentPackageId)
      if (invoice.invoiceNumber) form.append('invoiceNumber', invoice.invoiceNumber)
      if (invoice.invoiceDateTime) form.append('invoiceDateTime', invoice.invoiceDateTime)
      form.append('file', new Blob([invoice.bytes], { type:invoice.contentType }), invoice.fileName)
      body = form
    } else if (!['GET','DELETE'].includes(definition.method) && input?.payload !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(input.payload)
    }
    // Some DELETE endpoints accept a JSON body (for example product deletion).
    if (definition.method === 'DELETE' && input?.payload !== undefined) {
      headers['Content-Type'] = 'application/json'; body = JSON.stringify(input.payload)
    }
    const response = await fetch(url, { method:definition.method, headers, body })
    const contentType = response.headers.get('content-type') || ''
    let result: any
    if (contentType.includes('application/json')) result = await response.json().catch(() => ({}))
    else {
      const bytes = new Uint8Array(await response.arrayBuffer())
      result = { content_type:contentType, file_name:response.headers.get('content-disposition'), data_base64:toBase64(bytes) }
    }
    if (!response.ok) throw new HttpError(response.status, trendyolError(result, response.status))
    if (action === 'products.batch_result') {
      const batchId = clean(input?.path?.batchRequestId)
      const batchState = normalizeBatchState(result)
      const now = new Date().toISOString()
      await admin.from('marketplace_action_logs').update({
        status:batchState.status, response:sanitize(result), error_message:batchState.error,
        finished_at:['success','partial','failed'].includes(batchState.status) ? now : null,
      }).eq('merchant_code',merchantCode).eq('platform','trendyol').eq('external_batch_id',batchId)
        .neq('action','products.batch_result')
      await admin.from('product_platform_listings').update({
        delivery_status:batchState.status, delivery_error:batchState.error,
        last_verified_at:now,
      }).eq('merchant_code',merchantCode).eq('platform','trendyol').eq('external_batch_id',batchId)
      await admin.from('marketplace_action_logs').update({
        status:'success', response:sanitize(result), finished_at:now,
      }).eq('id',logId)
      return json({ ok:true, status:batchState.status, pendingApproval:['accepted','processing'].includes(batchState.status), error:batchState.error, data:result }, 200, cors)
    }
    const batchId = String(result?.batchRequestId || result?.batch_request_id || '') || null
    const finalStatus = batchId ? 'accepted' : 'success'
    await admin.from('marketplace_action_logs').update({
      status:finalStatus, response:sanitize(result), external_batch_id:batchId,
      finished_at:batchId ? null : new Date().toISOString(),
    }).eq('id',logId)
    return json({ ok:true, status:finalStatus, pendingApproval:Boolean(batchId), action, risk:definition.risk, batchRequestId:batchId, data:result }, 200, cors)
  } catch (error:any) {
    if (logId) await admin.from('marketplace_action_logs').update({
      status:'failed', error_message:String(error?.message || error).slice(0,4000), finished_at:new Date().toISOString(),
    }).eq('id',logId)
    return json({ error:error?.message || 'Trendyol operation failed' }, error instanceof HttpError ? error.status : 500, cors)
  }
})

async function resolveCredentials(admin:any, merchantCode:string) {
  const { data } = await admin.from('platform_credentials').select('seller_id,api_key,api_secret,extra')
    .eq('merchant_code',merchantCode).eq('platform','trendyol').eq('is_active',true).maybeSingle()
  if (!data) throw new HttpError(409, 'ربط Trendyol غير مفعّل')
  const secret = await resolveSecretPayload(data)
  if (!secret?.seller_id || !secret?.api_key || !secret?.api_secret) throw new HttpError(409, 'بيانات Trendyol غير مكتملة')
  return { sellerId:String(secret.seller_id), apiKey:String(secret.api_key), apiSecret:String(secret.api_secret) }
}

function buildPath(template:string, values:Record<string,unknown>) {
  return template.replace(/\{(\w+)\}/g, (_,key) => {
    const value = values[key]
    if (value === undefined || value === null || value === '') throw new HttpError(400, `${key} مطلوب`)
    return encodeURIComponent(String(value))
  })
}
function clean(value:unknown) { return typeof value === 'string' ? value.trim() : '' }
async function validatePackageContext(admin:any,merchantCode:string,action:string,input:any) {
  if (!action.startsWith('packages.') && action !== 'invoices.send_file') return
  if (['packages.common_label','packages.common_label_create','packages.common_label_get'].includes(action)) {
    const trackingNumber = clean(String(input?.path?.cargoTrackingNumber || ''))
    if (!/^[a-zA-Z0-9_-]{3,80}$/.test(trackingNumber)) throw new HttpError(400, 'رقم تتبع الشحنة غير صالح')
    const { data: labelPackage, error: labelError } = await admin.from('order_packages')
      .select('provider_status,status,raw').eq('merchant_code',merchantCode).eq('platform','trendyol')
      .eq('cargo_tracking_number',trackingNumber).limit(1).maybeSingle()
    if (labelError) throw labelError
    if (!labelPackage) throw new HttpError(404, 'رقم التتبع غير موجود ضمن شحنات هذا المتجر')
    if (action === 'packages.common_label_create') {
      const state = trendyolPackageProviderStatus(labelPackage).toLowerCase().replace(/[^a-z]/g,'')
      if (!['picking','processing','invoiced'].includes(state)) {
        throw new HttpError(409, 'ابدأ تجهيز الشحنة قبل طلب ملصق الشحن')
      }
    }
    return
  }
  const packageId = clean(String(input?.path?.packageId || input?.payload?.shipmentPackageId || ''))
  if (!/^\d+$/.test(packageId)) throw new HttpError(400, 'رقم شحنة Trendyol غير صالح')

  const { data: packageRow, error } = await admin.from('order_packages')
    .select('provider_status,status,raw')
    .eq('merchant_code',merchantCode).eq('platform','trendyol')
    .eq('shipment_package_id',packageId).maybeSingle()
  if (error) throw error
  if (!packageRow) throw new HttpError(404, 'الشحنة غير موجودة في هذا المتجر؛ حدّث الطلبات ثم حاول مجددًا')

  if (action === 'invoices.send_file') return

  const transitionError = trendyolPackageTransitionError(packageRow,action,String(input?.payload?.status || ''))
  if (transitionError) throw new HttpError(409,transitionError)
}
function validateActionInput(action:string,input:any) {
  if (action === 'questions.list') {
    try { validateTrendyolQuestionQuery(input?.query) }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'مرشح الأسئلة غير صالح') }
  }
  if (action === 'questions.detail' || action === 'questions.answer') {
    if (!/^\d+$/.test(clean(String(input?.path?.questionId || '')))) throw new HttpError(400, 'رقم سؤال Trendyol غير صالح')
  }
  if (action === 'questions.answer') {
    try { input.payload = { text:validateTrendyolAnswerText(input?.payload?.text) } }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'نص الرد غير صالح') }
  }
  if (action === 'invoices.send_file') {
    try { decodeTrendyolInvoiceFile(input?.payload) }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'ملف الفاتورة غير صالح') }
  }
  if (action === 'products.v2_update_content') {
    const items = input?.payload?.items
    if (!Array.isArray(items) || items.length < 1 || items.length > 1000) throw new HttpError(400, 'أرسل من 1 إلى 1,000 منتج في كل تحديث للمحتوى')
    for (const item of items) {
      const contentId = Number(item?.contentId)
      if (!Number.isInteger(contentId) || contentId < 1) throw new HttpError(400, 'معرّف منتج Trendyol غير صالح')
      const title = clean(item?.title)
      const description = clean(item?.description)
      const images = item?.images
      const hasImages = Array.isArray(images) && images.length > 0
      if (!title && !description && !hasImages) throw new HttpError(400, 'أرسل تعديلًا واحدًا على الأقل للعنوان أو الوصف أو الصور')
      if (images !== undefined) {
        if (!Array.isArray(images) || images.length < 1) throw new HttpError(400, 'أرسل صورة واحدة على الأقل للمنتج')
        for (const image of images) {
          const url = clean(image?.url)
          try {
            if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid')
          } catch {
            throw new HttpError(400, 'رابط صورة المنتج غير صالح؛ استخدم رابطًا مباشرًا للصورة')
          }
        }
      }
    }
  }
  if (action === 'products.price_inventory') {
    const items = input?.payload?.items
    if (!Array.isArray(items) || items.length < 1 || items.length > 1000) throw new HttpError(400, 'أرسل من 1 إلى 1000 منتج في كل تحديث')
    for (const item of items) {
      const quantity = Number(item?.quantity), salePrice = Number(item?.salePrice), listPrice = Number(item?.listPrice)
      if (!clean(item?.barcode)) throw new HttpError(400, 'باركود المنتج مطلوب')
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20000) throw new HttpError(400, 'المخزون يجب أن يكون عددًا صحيحًا بين 0 و20,000')
      if (!Number.isFinite(salePrice) || salePrice < 0 || !Number.isFinite(listPrice) || listPrice < salePrice) throw new HttpError(400, 'السعر قبل الخصم يجب ألا يقل عن سعر البيع')
    }
  }
  if (action === 'packages.status') {
    const status = String(input?.payload?.status || '')
    const lines = input?.payload?.lines
    if (!['Picking','Invoiced'].includes(status)) throw new HttpError(400, 'حالة الطلب المدعومة هي بدء التجهيز أو إصدار الفاتورة')
    if (!Array.isArray(lines) || !lines.length || lines.length > 200 || lines.some((line:any) => !Number.isFinite(Number(line?.lineId)) || !Number.isInteger(Number(line?.quantity)) || Number(line.quantity) < 1)) throw new HttpError(400, 'بنود الطلب غير مكتملة')
    if (status === 'Invoiced' && !clean(input?.payload?.params?.invoiceNumber)) throw new HttpError(400, 'رقم الفاتورة مطلوب')
  }
  if (action === 'packages.tracking') {
    if (!clean(input?.payload?.cargoSenderNumber) || !clean(input?.payload?.providerCode)) throw new HttpError(400, 'رقم التتبع وشركة الشحن مطلوبان')
  }
  if (action === 'packages.common_label_create') {
    const format = clean(input?.payload?.format).toUpperCase()
    const boxQuantity = Number(input?.payload?.boxQuantity ?? 1)
    const volumetricHeight = input?.payload?.volumetricHeight
    if (format !== 'ZPL') throw new HttpError(400, 'صيغة ملصق Trendyol المدعومة هي ZPL')
    if (!Number.isInteger(boxQuantity) || boxQuantity < 1 || boxQuantity > 100) throw new HttpError(400, 'عدد الطرود يجب أن يكون بين 1 و100')
    if (volumetricHeight !== undefined && (!Number.isFinite(Number(volumetricHeight)) || Number(volumetricHeight) <= 0)) {
      throw new HttpError(400, 'الوزن الحجمي غير صالح')
    }
  }
  if (action === 'claims.approve') {
    const claimItems = input?.payload?.claimLineItemIdList
    if (!clean(input?.path?.claimId) || !Array.isArray(claimItems) || !claimItems.length || claimItems.length > 100 || claimItems.some((id:any) => !clean(id))) {
      throw new HttpError(400, 'بيانات عناصر المرتجع غير مكتملة')
    }
  }
  if (action === 'claims.reject') {
    const reasonId = Number(input?.query?.claimIssueReasonId)
    if (!clean(input?.path?.claimId) || !Number.isInteger(reasonId) || reasonId < 1 || !clean(input?.query?.claimItemIdList)) {
      throw new HttpError(400, 'اختر سبب الرفض وتأكد من بيانات المرتجع')
    }
  }
}
function sanitize(value:any):any {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > 2000 ? `[omitted ${value.length} chars]` : value
  if (Array.isArray(value)) return value.slice(0,200).map(sanitize)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0,200).map(([k,v]) => [k,/secret|token|password|file|base64/i.test(k)?'[redacted]':sanitize(v)]))
  return value
}
function trendyolError(data:any,status:number) {
  const message = readableError(data?.errors || data?.message || data?.error || data)
  return `Trendyol ${status}: ${message || 'رفض العملية'}`
}
function readableError(value:any):string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(readableError).filter(Boolean).join('، ')
  if (typeof value === 'object') {
    const preferred = ['message','detail','description','reason','error','errors','key','title']
      .map(key => readableError(value[key])).filter(Boolean)
    if (preferred.length) return [...new Set(preferred)].join(' — ')
    try { return JSON.stringify(value) } catch { return 'استجابة غير مفهومة من Trendyol' }
  }
  return String(value)
}
function normalizeBatchState(result:any):{status:'processing'|'success'|'partial'|'failed',error:string|null} {
  const rawStatus = String(result?.status || result?.batchRequestStatus || result?.batchStatus || '').toUpperCase()
  const items = Array.isArray(result?.items) ? result.items : Array.isArray(result?.content) ? result.content : []
  const failed = items.filter((item:any) => {
    const status = String(item?.status || item?.itemStatus || '').toUpperCase()
    return status.includes('FAIL') || status.includes('REJECT') || Boolean(item?.failureReasons?.length || item?.errors?.length)
  })
  const succeeded = items.filter((item:any) => {
    const status = String(item?.status || item?.itemStatus || '').toUpperCase()
    return status.includes('SUCCESS') || status.includes('COMPLETE') || status.includes('APPROV')
  })
  const error = failed.length ? readableError(failed.flatMap((item:any) => item.failureReasons || item.errors || item.message || [])) || 'رفض Trendyol بعض التعديلات' : null
  if (failed.length && succeeded.length) return { status:'partial', error }
  if (failed.length && (items.length === failed.length || rawStatus.includes('FAIL') || rawStatus.includes('REJECT'))) return { status:'failed', error }
  if (['COMPLETED','COMPLETE','SUCCESS','SUCCEEDED','APPROVED'].some(value => rawStatus.includes(value))) return { status:'success', error:null }
  if (['FAILED','REJECTED','CANCELLED'].some(value => rawStatus.includes(value))) return { status:'failed', error:error || 'رفض Trendyol التعديل' }
  return { status:'processing', error:null }
}
function toBase64(bytes:Uint8Array) {
  let binary=''; const chunk=0x8000
  for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode(...bytes.subarray(i,i+chunk))
  return btoa(binary)
}
