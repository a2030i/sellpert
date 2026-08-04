import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  HttpError,
  authorizeMerchantSync,
  fetchJsonWithRetry,
  json,
  numberValue,
  parseSyncRange,
  splitRange,
} from '../_shared/sync.ts'
import { resolveSecretPayload } from '../_shared/credentialVault.ts'
import { normalizeTrendyolClaimStatus } from '../_shared/trendyolClaims.ts'
import {
  mapTrendyolOrderStatus,
  mergeTrendyolShipment,
  trendyolLineFinancials,
  trendyolPackageId,
} from '../_shared/trendyolOrders.ts'
import { normalizeTrendyolV2Products } from '../_shared/trendyolProducts.ts'
import { persistTrendyolQuestions } from '../_shared/trendyolQuestionInbox.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TRENDYOL_API = 'https://apigw.trendyol.com/integration/order/sellers'
const TRENDYOL_PRODUCT_API = 'https://apigw.trendyol.com/integration/product/sellers'
const TRENDYOL_FINANCE_API = 'https://apigw.trendyol.com/integration/finance/che/sellers'
const TRENDYOL_QUESTION_API = 'https://apigw.trendyol.com/integration/sellers'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  let logId = ''
  let mappingId = ''

  try {
    const body = await req.json()
    const merchantCode = String(body?.merchant_code || '')
    mappingId = String(body?.mapping_id || '')
    if (!merchantCode) throw new HttpError(400, 'merchant_code مطلوب')
    await authorizeMerchantSync(req, admin, SERVICE_KEY, merchantCode)

    const { data: merchant } = await admin.from('merchants')
      .select('subscription_status').eq('merchant_code', merchantCode).maybeSingle()
    if (!merchant) throw new HttpError(404, 'Merchant not found')
    if (merchant.subscription_status !== 'active') throw new HttpError(403, 'ACCOUNT_SUSPENDED')

    const credentials = await resolveCredentials(admin, merchantCode, mappingId)
    const { from, to } = parseSyncRange(body, 90)

    const { data: log, error: logError } = await admin.from('sync_logs').insert({
      merchant_code: merchantCode,
      platform: 'trendyol',
      status: 'running',
      records_synced: 0,
    }).select().single()
    if (logError) throw logError
    logId = log.id

    const auth = btoa(`${credentials.apiKey}:${credentials.apiSecret}`)
    const headers = {
      Authorization: `Basic ${auth}`,
      // Trendyol requires "Seller Id - Integration Company" on every request.
      'User-Agent': `${credentials.sellerId} - Sellpert`,
      Accept: 'application/json',
      // Saudi storefront selects the Gulf catalogue/currency/localized payload.
      storeFrontCode: 'SA',
    }

    const orders = new Map<string, any>()
    const shipments: any[] = []
    // The Stream endpoint is Trendyol's supported transport for periodic
    // synchronization. Each cursor remains bound to its original filters.
    for (const window of splitRange(from, to, 13)) {
      const packages = await fetchShipmentStream(credentials.sellerId, window.from, window.to, headers)
      for (const shipment of packages) {
        shipments.push(shipment)
        mergeTrendyolShipment(orders, shipment, merchantCode)
      }
    }

    const rows = [...orders.values()]
    await upsertRows(admin, rows)
    const daily = buildDaily(rows)

    const details: Record<string, unknown> = {
      orders: rows.length,
      packages: await syncOrderPackages(admin, merchantCode, shipments),
      order_days: daily.size,
      order_transport: 'stream',
    }
    const warnings: string[] = []
    details.order_items = await optionalResource('order_items', warnings, () =>
      syncOrderItems(admin, merchantCode, credentials.sellerId, shipments, headers))
    details.returns = await optionalResource('returns', warnings, () =>
      syncReturns(admin, merchantCode, credentials.sellerId, from, to, headers))
    details.settlements = await optionalResource('settlements', warnings, () =>
      syncSettlements(admin, merchantCode, credentials.sellerId, from, to, headers))
    const productResult = await optionalResource('products', warnings, () =>
      syncProducts(admin, merchantCode, credentials.sellerId, headers))
    details.products = typeof productResult === 'object' && productResult ? (productResult as any).products : productResult
    details.inventory = typeof productResult === 'object' && productResult ? (productResult as any).inventory : 0
    details.product_transport = typeof productResult === 'object' && productResult ? (productResult as any).transport : null
    details.approved_products = typeof productResult === 'object' && productResult ? (productResult as any).approved_products : 0
    details.unapproved_products = typeof productResult === 'object' && productResult ? (productResult as any).unapproved_products : 0
    details.customer_questions = await optionalResource('customer_questions', warnings, () =>
      syncCustomerQuestions(admin, merchantCode, credentials.sellerId, headers))
    // Settlement synchronization may refine order commissions. Rebuild the
    // financial layer only after every order and finance write has finished,
    // using the database's canonical source-precedence rules.
    const { data: performanceRows, error: performanceError } = await admin.rpc('rebuild_performance_data', {
      p_merchant_code: merchantCode,
    })
    if (performanceError) throw performanceError
    details.performance_days = numberValue(performanceRows)
    details.warnings = warnings

    const now = new Date().toISOString()
    const syncStatus = warnings.length > 0 ? 'partial' : 'success'
    await admin.from('sync_logs').update({
      status: syncStatus, records_synced: rows.length,
      error_message: warnings.length ? warnings.join(' | ').slice(0, 4000) : null,
      finished_at: now, details,
    }).eq('id', logId)
    await admin.from('platform_credentials').update({
      last_sync_at: now, records_synced: rows.length,
    }).eq('merchant_code', merchantCode).eq('platform', 'trendyol')
    if (mappingId) await admin.from('merchant_platform_mappings').update({
      last_sync_at: now,
      last_sync_status: syncStatus,
      records_synced: rows.length,
      last_sync_error: warnings.length ? warnings.join(' | ').slice(0, 4000) : null,
    }).eq('id', mappingId).eq('merchant_code', merchantCode)

    return json({ ok: true, status: syncStatus, partial: warnings.length > 0, records_synced: rows.length, ...details }, 200, corsHeaders)
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500
    if (logId) await admin.from('sync_logs').update({
      status: 'error', error_message: error.message, finished_at: new Date().toISOString(),
    }).eq('id', logId)
    if (mappingId) await admin.from('merchant_platform_mappings').update({
      last_sync_status: 'error', last_sync_error: error.message,
    }).eq('id', mappingId)
    return json({ error: error.message }, status, corsHeaders)
  }
})

async function resolveCredentials(admin: any, merchantCode: string, mappingId: string) {
  if (mappingId) {
    const { data } = await admin.from('merchant_platform_mappings')
      .select('seller_id,merchant_code,platform,platform_connections(api_key,api_secret)')
      .eq('id', mappingId).eq('merchant_code', merchantCode).eq('platform', 'trendyol').maybeSingle()
    const connection = data?.platform_connections as any
    if (!data || !connection) throw new HttpError(404, 'Trendyol connection not found')
    assertCredentials(data.seller_id, connection.api_key, connection.api_secret)
    return { sellerId: data.seller_id, apiKey: connection.api_key, apiSecret: connection.api_secret }
  }

  const { data } = await admin.from('platform_credentials').select('seller_id,api_key,api_secret,extra')
    .eq('merchant_code', merchantCode).eq('platform', 'trendyol').eq('is_active', true).maybeSingle()
  if (!data) throw new HttpError(400, 'لا توجد بيانات ربط مفعلة لترنديول')
  const secret = await resolveSecretPayload(data)
  assertCredentials(secret.seller_id, secret.api_key, secret.api_secret)
  return { sellerId: secret.seller_id, apiKey: secret.api_key, apiSecret: secret.api_secret }
}

function assertCredentials(sellerId: unknown, apiKey: unknown, apiSecret: unknown) {
  if (!sellerId || !apiKey || !apiSecret) {
    throw new HttpError(400, 'بيانات Trendyol غير مكتملة (Seller ID / API Key / API Secret)')
  }
}

async function fetchShipmentStream(
  sellerId: string,
  from: Date,
  to: Date,
  headers: Record<string, string>,
) {
  const shipments: any[] = []
  let nextCursor = ''
  let requestCount = 0
  while (true) {
    const query = new URLSearchParams({
      lastModifiedStartDate: String(from.getTime()),
      lastModifiedEndDate: String(to.getTime()),
      size: '200',
    })
    if (nextCursor) query.set('nextCursor', nextCursor)
    const data = await fetchJsonWithRetry(
      `${TRENDYOL_API}/${encodeURIComponent(sellerId)}/orders/stream?${query}`,
      { headers },
      'Trendyol Orders Stream API',
    )
    const content = Array.isArray(data?.content) ? data.content : []
    shipments.push(...content)
    requestCount++

    if (!data?.hasMore) break
    const cursor = String(data?.nextCursor || '')
    if (!cursor || cursor === nextCursor) {
      throw new HttpError(502, 'Trendyol Orders Stream returned an invalid cursor')
    }
    if (requestCount >= 200) {
      throw new HttpError(502, 'Trendyol Orders Stream exceeded the safe cursor limit')
    }
    nextCursor = cursor
    // Trendyol recommends at least five seconds between cursor requests.
    await new Promise(resolve => setTimeout(resolve, 5_000))
  }
  return shipments
}

async function syncOrderPackages(admin: any, merchantCode: string, shipments: any[]) {
  const now = new Date().toISOString()
  const rows = shipments.flatMap((shipment:any) => {
    const packageId = trendyolPackageId(shipment)
    const orderId = String(shipment.orderNumber || '')
    if (!packageId || !orderId) return []
    const lines = Array.isArray(shipment.lines) ? shipment.lines : []
    return [{
      merchant_code: merchantCode,
      platform: 'trendyol',
      order_id: orderId,
      shipment_package_id: packageId,
      status: mapTrendyolOrderStatus(shipment.shipmentPackageStatus || shipment.status),
      provider_status: String(shipment.shipmentPackageStatus || shipment.status || '') || null,
      cargo_tracking_number: String(shipment.cargoTrackingNumber || shipment.trackingNumber || '') || null,
      cargo_tracking_link: shipment.cargoTrackingLink || null,
      cargo_sender_number: String(shipment.cargoSenderNumber || '') || null,
      cargo_provider: shipment.cargoProviderName || null,
      delivery_type: shipment.deliveryType || null,
      delivery_address_type: shipment.deliveryAddressType || null,
      invoice_number: String(shipment.invoiceNumber || '') || null,
      invoice_status: shipment.invoiceStatus || null,
      invoice_rejected_reasons: shipment.invoiceRejectedReasonKeys || null,
      line_count: lines.length,
      quantity: lines.reduce((sum:number, line:any) => sum + Math.max(1, Math.trunc(numberValue(line.quantity || 1))), 0),
      total_amount: numberValue(shipment.packageTotalPrice || shipment.totalPrice || shipment.packageGrossAmount),
      currency: shipment.currencyCode || 'SAR',
      modified_at: safeIsoDate(shipment.lastModifiedDate || shipment.createdDate || shipment.orderDate),
      last_synced_at: now,
      raw: shipment,
    }]
  })
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('order_packages').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,shipment_package_id',
    })
    if (error) throw error
  }
  return rows.length
}

function safeIsoDate(value: unknown) {
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function optionalResource(name: string, warnings: string[], task: () => Promise<any>) {
  try {
    return await task()
  } catch (error: any) {
    console.error(`[trendyol:${name}]`, error?.message || error)
    warnings.push(`${name}: ${error?.message || 'sync failed'}`)
    return 0
  }
}

async function syncOrderItems(admin: any, merchantCode: string, sellerId: string, shipments: any[], headers: Record<string,string>) {
  const catalogue = new Map<string, any>()
  const barcodes = [...new Set(shipments.flatMap(shipment =>
    (shipment.lines || []).map((line:any) => String(line.barcode || '')).filter(Boolean),
  ))]
  // Catalogue lookups are bounded and run in small groups to respect Trendyol
  // service limits while enriching order lines with product images.
  for (let start=0; start<barcodes.length; start+=5) {
    await Promise.all(barcodes.slice(start,start+5).map(async barcode => {
      try {
        const data = await fetchJsonWithRetry(
          `${TRENDYOL_PRODUCT_API}/${encodeURIComponent(sellerId)}/products/approved?barcode=${encodeURIComponent(barcode)}&page=0&size=10`,
          { headers }, 'Trendyol Product API', 2,
        )
        const content = data?.content || data?.items
        catalogue.set(barcode, Array.isArray(content) ? content[0] || null : content || data?.item || data)
      } catch (error:any) {
        console.warn(`[trendyol:catalogue] barcode=${barcode} ${error?.message || error}`)
      }
    }))
  }
  const now = new Date().toISOString()
  const rows:any[] = []
  for (const shipment of shipments) {
    const orderId = String(shipment.orderNumber || shipment.id || shipment.shipmentPackageId || '')
    for (let index=0; index<(shipment.lines || []).length; index++) {
      const line = shipment.lines[index]
      const barcode = String(line.barcode || '')
      const product = catalogue.get(barcode) || null
      const images = product?.images || product?.imageUrls || product?.content?.images || []
      const firstImage = Array.isArray(images) ? images[0] : null
      const financials = trendyolLineFinancials(line)
      rows.push({
        merchant_code:merchantCode, platform:'trendyol', order_id:orderId,
        shipment_package_id:String(shipment.shipmentPackageId || shipment.id || '') || null,
        line_id:String(line.lineId || line.id || `${shipment.shipmentPackageId || shipment.id}-${index}`),
        content_id:String(line.contentId || line.productCode || '') || null,
        barcode:barcode || null, sku:String(line.merchantSku || line.stockCode || line.sku || '') || null,
        product_name:product?.title || product?.productName || product?.name || line.productName || null,
        quantity:financials.quantity, unit_price:financials.unitPrice,
        line_total:financials.lineTotal,
        discount_amount:financials.discountTotal,
        // Trendyol Saudi displays commission inclusive of 15% VAT in the seller panel.
        commission_amount:financials.commissionAmount,
        commission_rate:financials.commissionRate || null, vat_rate:financials.vatRate || null,
        image_url:typeof firstImage === 'string' ? firstImage : firstImage?.url || product?.imageUrl || null,
        images:Array.isArray(images) ? images : null,
        product_url:product?.productUrl || product?.url || null,
        raw:line, catalog_raw:product, last_synced_at:now,
      })
    }
  }
  await enrichArabicTitles(admin, merchantCode, rows)
  for (let index=0; index<rows.length; index+=100) {
    const { error } = await admin.from('order_items').upsert(rows.slice(index,index+100), {
      onConflict:'merchant_code,platform,order_id,line_id',
    })
    if (error) throw error
  }
  return rows.length
}

async function enrichArabicTitles(admin:any, merchantCode:string, rows:any[]) {
  const titles = [...new Set(rows.map(row => String(row.product_name || '').trim()).filter(Boolean))]
  if (!titles.length) return
  const { data: cached } = await admin.from('order_items').select('product_name,product_name_ar')
    .eq('merchant_code',merchantCode).eq('platform','trendyol').in('product_name',titles)
    .not('product_name_ar','is',null)
  const translations = new Map<string,string>()
  for (const item of cached || []) if (item.product_name && item.product_name_ar) translations.set(item.product_name,item.product_name_ar)
  const missing = titles.filter(title => !translations.has(title) && !/[ء-ي]/.test(title))
  if (missing.length) {
    let apiKey = Deno.env.get('OPENROUTER_API_KEY') || ''
    if (!apiKey) {
      const { data } = await admin.from('platform_connections').select('api_key')
        .eq('platform','openrouter').eq('is_active',true).maybeSingle()
      apiKey = data?.api_key || ''
    }
    if (apiKey) for (let start=0; start<missing.length; start+=25) {
      const batch = missing.slice(start,start+25)
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method:'POST', headers:{ Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','HTTP-Referer':'https://sellpert.com','X-Title':'Sellpert Product Translation' },
          body:JSON.stringify({
            model:Deno.env.get('OPENROUTER_TRANSLATION_MODEL') || 'google/gemini-2.5-flash',
            temperature:0, max_tokens:2500,
            messages:[
              { role:'system', content:'ترجم أسماء المنتجات التالية إلى العربية التجارية الواضحة. حافظ على العلامة التجارية والأوزان والمقاسات والأكواد دون تغيير. أعد فقط JSON array من كائنات source وarabic وبنفس الترتيب.' },
              { role:'user', content:JSON.stringify(batch) },
            ],
          }),
        })
        if (!response.ok) throw new Error(`translation HTTP ${response.status}`)
        const data = await response.json()
        const content = String(data?.choices?.[0]?.message?.content || '')
        const jsonText = content.match(/\[[\s\S]*\]/)?.[0] || '[]'
        const translated = JSON.parse(jsonText)
        for (const item of translated) if (item?.source && item?.arabic) translations.set(String(item.source),String(item.arabic))
      } catch (error:any) {
        console.warn('[trendyol:translate]',error?.message || error)
      }
    }
  }
  for (const row of rows) {
    const original = String(row.product_name || '')
    row.product_name_ar = /[ء-ي]/.test(original) ? original : translations.get(original) || null
    row.translation_source = row.product_name_ar ? (row.product_name_ar === original ? 'trendyol' : 'ai') : null
  }
}

async function pagedContent(url: string, headers: Record<string, string>, pageSize = 200) {
  const rows: any[] = []
  let page = 0
  while (true) {
    const separator = url.includes('?') ? '&' : '?'
    const data = await fetchJsonWithRetry(`${url}${separator}page=${page}&size=${pageSize}`, { headers }, 'Trendyol API')
    const content = Array.isArray(data) ? data : (data?.content || data?.items || [])
    rows.push(...content)
    const totalPages = numberValue(data?.totalPages)
    if (content.length < pageSize || (totalPages > 0 && page + 1 >= totalPages)) break
    page++
  }
  return rows
}

async function syncReturns(admin: any, merchantCode: string, sellerId: string, from: Date, to: Date, headers: Record<string, string>) {
  const params = new URLSearchParams({ startDate: String(from.getTime()), endDate: String(to.getTime()) })
  const claims = await pagedContent(`${TRENDYOL_API}/${encodeURIComponent(sellerId)}/claims?${params}`, headers)
  const rows: any[] = []
  for (const claim of claims) {
    const claimId = String(claim.id || claim.claimId || '')
    const items = claim.items || claim.claimItems || claim.lines || [claim]
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      const line = item.orderLine || item.line || item
      const nestedClaimItems = Array.isArray(item.claimItems) ? item.claimItems : []
      const providerClaimItem = nestedClaimItems[nestedClaimItems.length - 1] || item
      const lineId = String(item.id || item.claimItemId || line.id || index)
      if (!claimId) continue
      rows.push({
        merchant_code: merchantCode, platform: 'trendyol', claim_id: claimId, claim_line_id: lineId,
        order_id: String(claim.orderNumber || line.orderNumber || line.orderId || '') || null,
        product_name: line.productName || line.name || null,
        sku: line.merchantSku || line.stockCode || line.barcode || null,
        quantity: Math.max(1, numberValue(item.quantity || line.quantity || 1)),
        return_amount: numberValue(item.amount || line.price || claim.totalPrice),
        provider_claim_item_id: providerClaimItem.id ? String(providerClaimItem.id) : null,
        reason: providerClaimItem.customerClaimItemReason?.name || providerClaimItem.trendyolClaimItemReason?.name || item.customerClaimItemReason?.name || item.reason?.name || item.reason || claim.reason || null,
        return_date: new Date(claim.claimDate || claim.createdDate || claim.lastModifiedDate || Date.now()).toISOString().slice(0, 10),
        status: normalizeTrendyolClaimStatus(providerClaimItem.claimItemStatus?.name || providerClaimItem.status || item.claimItemStatus?.name || item.status || claim.status),
        raw: { claim, item, providerClaimItem }, last_synced_at: new Date().toISOString(),
      })
    }
  }
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('returns').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,claim_id,claim_line_id',
    })
    if (error) throw error
  }
  return rows.length
}

async function syncSettlements(admin: any, merchantCode: string, sellerId: string, from: Date, to: Date, headers: Record<string, string>) {
  const financeHeaders = { ...headers, storeFrontCode: 'SA' }
  const transactions: any[] = []
  // Finance API enforces a short date interval as well; use the same safe
  // 13-day windows as orders and retrieve Sale/Return independently.
  for (const window of splitRange(from, to, 13)) {
    for (const transactionType of ['Sale', 'Return']) {
      const params = new URLSearchParams({
        transactionType, startDate: String(window.from.getTime()), endDate: String(window.to.getTime()),
      })
      transactions.push(...await pagedContent(
        `${TRENDYOL_FINANCE_API}/${encodeURIComponent(sellerId)}/settlements?${params}`,
        financeHeaders,
        500,
      ))
    }
  }
  const rows = transactions.map((tx: any, index: number) => {
    const transactionNo = String(tx.id || tx.transactionId || tx.transactionNumber || `${tx.orderNumber || 'tx'}-${tx.transactionDate || index}-${tx.transactionType || ''}`)
    const type = String(tx.transactionType || tx.type || 'settlement')
    const isDebit = /return|deduction|debit/i.test(type)
    const gross = numberValue(tx.credit || tx.debt || tx.amount || tx.totalPrice || tx.paymentPrice)
    const sellerRevenue = numberValue(tx.sellerRevenue || tx.netAmount || gross - numberValue(tx.commissionAmount))
    return {
      merchant_code: merchantCode, platform: 'trendyol', transaction_no: transactionNo,
      transaction_date: new Date(tx.transactionDate || tx.createdDate || Date.now()).toISOString(),
      posted_date: tx.paymentDate ? new Date(tx.paymentDate).toISOString() : null,
      transaction_type: type, order_id: String(tx.orderNumber || tx.orderId || '') || null,
      description: tx.description || tx.transactionType || null,
      product_name: tx.productName || null, product_sku: tx.merchantSku || tx.stockCode || null,
      product_barcode: tx.barcode || null, amount_type: tx.amountType || type,
      amount_description: tx.amountDescription || tx.description || null,
      debit: isDebit ? Math.abs(gross) : numberValue(tx.debt),
      credit: isDebit ? numberValue(tx.credit) : Math.abs(gross),
      net_amount: isDebit ? -Math.abs(sellerRevenue) : sellerRevenue,
      // This integration is explicitly scoped to the Saudi storefront.
      // Never label a missing currency as TRY in a Saudi merchant ledger.
      currency: tx.currencyCode || tx.currency || 'SAR', marketplace: 'Trendyol',
      settlement_id: String(tx.settlementId || tx.paymentOrderId || '') || null, raw: tx,
    }
  })
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('account_transactions').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,transaction_no',
    })
    if (error) throw error
  }
  const orderFinancials = new Map<string, { fee: number; rate: number }>()
  for (const tx of transactions) {
    const orderId = String(tx.orderNumber || tx.orderId || '')
    if (!orderId) continue
    const current = orderFinancials.get(orderId) || { fee: 0, rate: 0 }
    const sign = /return/i.test(String(tx.transactionType || tx.type || '')) ? -1 : 1
    current.fee += sign * numberValue(tx.commissionAmount)
    current.rate = Math.max(current.rate, numberValue(tx.commissionRate))
    orderFinancials.set(orderId, current)
  }
  for (const [orderId, financial] of orderFinancials) {
    const { error } = await admin.from('orders').update({
      platform_fee: Math.max(0, financial.fee), commission_rate: financial.rate || null,
    }).eq('merchant_code', merchantCode).eq('platform', 'trendyol').eq('order_id', orderId)
    if (error) throw error
  }
  return rows.length
}

async function syncProducts(admin: any, merchantCode: string, sellerId: string, headers: Record<string, string>) {
  const localizedHeaders = { ...headers, 'Accept-Language': 'ar' }
  const [approvedContent, unapprovedContent] = await Promise.all([
    pagedProductV2(`${TRENDYOL_PRODUCT_API}/${encodeURIComponent(sellerId)}/products/approved`, localizedHeaders, 100),
    pagedProductV2(`${TRENDYOL_PRODUCT_API}/${encodeURIComponent(sellerId)}/products/unapproved`, localizedHeaders, 1000),
  ])
  const now = new Date().toISOString()
  const normalized = normalizeTrendyolV2Products(merchantCode, approvedContent, unapprovedContent, now)
  const products = normalized.products
  for (let index = 0; index < products.length; index += 100) {
    const { error } = await admin.from('products').upsert(products.slice(index, index + 100), { onConflict: 'merchant_code,sku' })
    if (error) throw error
  }
  const inventory = normalized.inventory
  for (let index = 0; index < inventory.length; index += 100) {
    const { error } = await admin.from('inventory').upsert(inventory.slice(index, index + 100), { onConflict: 'merchant_code,sku,platform' })
    if (error) throw error
  }
  return {
    products: products.length,
    inventory: inventory.length,
    approved_products: normalized.approvedVariants,
    unapproved_products: normalized.unapprovedVariants,
    transport: 'v2',
  }
}

async function syncCustomerQuestions(
  admin: any,
  merchantCode: string,
  sellerId: string,
  headers: Record<string, string>,
) {
  const params = new URLSearchParams({
    status: 'WAITING_FOR_ANSWER',
    orderByField: 'CreatedDate',
    orderByDirection: 'DESC',
  })
  const questions = await pagedContent(
    `${TRENDYOL_QUESTION_API}/${encodeURIComponent(sellerId)}/questions/filter?${params}`,
    headers,
    50,
  )
  await persistTrendyolQuestions(
    admin,
    merchantCode,
    { content: questions, totalElements: questions.length },
    'WAITING_FOR_ANSWER',
  )
  return questions.length
}

async function pagedProductV2(url: string, headers: Record<string, string>, size: number) {
  const rows: any[] = []
  let page = 0
  let nextPageToken = ''
  let requestCount = 0

  while (true) {
    const query = new URLSearchParams({ size: String(size) })
    if (nextPageToken) query.set('nextPageToken', nextPageToken)
    else query.set('page', String(page))
    const data = await fetchJsonWithRetry(`${url}?${query}`, { headers }, 'Trendyol Product V2 API')
    const content = Array.isArray(data?.content) ? data.content : []
    rows.push(...content)
    requestCount++

    if (!content.length || content.length < size) break
    const token = String(data?.nextPageToken || '')
    if (token) {
      if (token === nextPageToken) throw new HttpError(502, 'Trendyol Product V2 returned an invalid page token')
      nextPageToken = token
    } else {
      const totalPages = Number(data?.totalPages || 0)
      if (!Number.isFinite(totalPages) || page + 1 >= totalPages) break
      page++
    }
    if (requestCount >= 500) throw new HttpError(502, 'Trendyol Product V2 exceeded the safe pagination limit')
  }

  return rows
}

async function upsertRows(admin: any, rows: any[]) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('orders').upsert(rows.slice(index, index + 100), {
      onConflict: 'merchant_code,platform,order_id',
    })
    if (error) throw error
  }
}

function buildDaily(rows: any[]) {
  const daily = new Map<string, { sales: number; orders: number }>()
  for (const row of rows) {
    if (row.status === 'cancelled') continue
    const date = row.order_date.slice(0, 10)
    const value = daily.get(date) || { sales: 0, orders: 0 }
    value.sales += numberValue(row.total_amount)
    value.orders++
    daily.set(date, value)
  }
  return daily
}
