import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeMerchantSync, HttpError, json } from '../_shared/sync.ts'
import { resolveSecretPayload } from '../_shared/credentialVault.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const API = 'https://apigw.trendyol.com'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
}

type Risk = 'read' | 'write' | 'destructive'
type Definition = { method: string; path: string; risk: Risk; storefront?: boolean; binary?: boolean }

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
  'products.price_inventory': { method:'POST',   path:'/integration/inventory/sellers/{sellerId}/products/price-and-inventory', risk:'write' },
  'products.batch_result':    { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/batch-requests/{batchRequestId}', risk:'read' },
  'products.v2_create':       { method:'POST',   path:'/integration/product/sellers/{sellerId}/v2/products', risk:'write' },
  'products.v2_base':         { method:'GET',    path:'/integration/product/sellers/{sellerId}/product/{barcode}', risk:'read' },
  'products.v2_unapproved':   { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/unapproved', risk:'read' },
  'products.v2_approved':     { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/approved', risk:'read' },
  'products.v2_stock_price':  { method:'GET',    path:'/integration/product/sellers/{sellerId}/products/approved/inventory-and-price', risk:'read' },
  'products.v2_update_unapproved': { method:'PUT', path:'/integration/product/sellers/{sellerId}/products/unapproved-bulk-update', risk:'write' },
  'products.v2_update_content':    { method:'PUT', path:'/integration/product/sellers/{sellerId}/products/content-bulk-update', risk:'write' },
  'products.v2_update_variant':    { method:'PUT', path:'/integration/product/sellers/{sellerId}/products/variant-bulk-update', risk:'write' },
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
  'packages.tracking':        { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/tracking-details', risk:'write' },
  'packages.status':          { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}', risk:'write' },
  'packages.cancel':          { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/items/unsupplied', risk:'destructive' },
  'packages.split':           { method:'POST',path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/split-packages', risk:'write' },
  'packages.alternative':     { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/alternative-delivery', risk:'write' },
  'packages.cargo_provider':  { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/cargo-providers', risk:'write' },
  'packages.box_info':        { method:'PUT', path:'/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/box-info', risk:'write' },
  'packages.common_label':    { method:'GET', path:'/integration/sellers/{sellerId}/common-label/query', risk:'read', binary:true },
  'seller.addresses':         { method:'GET', path:'/integration/sellers/{sellerId}/addresses', risk:'read' },

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
  'invoices.send_file':       { method:'POST',   path:'/integration/sellers/{sellerId}/seller-invoice-file', risk:'write' },
  'invoices.delete_link':     { method:'DELETE', path:'/integration/sellers/{sellerId}/seller-invoice-links/delete', risk:'destructive' },
  'finance.settlements':      { method:'GET', path:'/integration/finance/che/sellers/{sellerId}/settlements', risk:'read', storefront:true },
  'finance.other':            { method:'GET', path:'/integration/finance/che/sellers/{sellerId}/other-financials', risk:'read', storefront:true },
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:cors })
  if (req.method !== 'POST') return json({ error:'Method not allowed' }, 405, cors)
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
    if (definition.risk !== 'read' && input?.confirm !== true) {
      throw new HttpError(409, 'يجب تأكيد العملية قبل إرسالها إلى Trendyol')
    }
    const idempotencyKey = clean(req.headers.get('idempotency-key') || input?.idempotency_key)
    if (definition.risk !== 'read' && !idempotencyKey) throw new HttpError(400, 'idempotency_key مطلوب للعمليات التي تغيّر البيانات')

    if (idempotencyKey) {
      const { data: previous } = await admin.from('marketplace_action_logs')
        .select('status,response,error_message,external_batch_id').eq('merchant_code', merchantCode)
        .eq('platform','trendyol').eq('action',action).eq('idempotency_key',idempotencyKey).maybeSingle()
      if (previous?.status === 'success') return json({ ok:true, replayed:true, data:previous.response, batchRequestId:previous.external_batch_id }, 200, cors)
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
    let body: string | undefined
    if (!['GET','DELETE'].includes(definition.method) && input?.payload !== undefined) {
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
    const batchId = String(result?.batchRequestId || result?.batch_request_id || '') || null
    await admin.from('marketplace_action_logs').update({
      status:'success', response:sanitize(result), external_batch_id:batchId, finished_at:new Date().toISOString(),
    }).eq('id',logId)
    return json({ ok:true, action, risk:definition.risk, batchRequestId:batchId, data:result }, 200, cors)
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
function sanitize(value:any):any {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > 2000 ? `[omitted ${value.length} chars]` : value
  if (Array.isArray(value)) return value.slice(0,200).map(sanitize)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0,200).map(([k,v]) => [k,/secret|token|password|file|base64/i.test(k)?'[redacted]':sanitize(v)]))
  return value
}
function trendyolError(data:any,status:number) {
  const message = data?.errors?.map((e:any)=>e.message || e.key).filter(Boolean).join('، ') || data?.message || data?.error
  return `Trendyol ${status}: ${message || 'رفض العملية'}`
}
function toBase64(bytes:Uint8Array) {
  let binary=''; const chunk=0x8000
  for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode(...bytes.subarray(i,i+chunk))
  return btoa(binary)
}
