import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Trendyol fulfillment action contract', () => {
  const gateway = readFileSync('supabase/functions/trendyol-actions/index.ts', 'utf8')
  const syncBoundary = readFileSync('supabase/functions/_shared/sync.ts', 'utf8')
  const trendyolSync = readFileSync('supabase/functions/sync-trendyol/index.ts', 'utf8')
  const orders = readFileSync('src/pages/Orders.tsx', 'utf8')
  const statement = readFileSync('src/pages/Statement.tsx', 'utf8')
  const customerService = readFileSync('src/pages/CustomerService.tsx', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')
  const customerPermissionMigration = readFileSync('supabase/migrations/20260804204219_add_customer_service_permission.sql', 'utf8')
  const merchantCenter = readFileSync('src/components/TrendyolActionCenter.tsx', 'utf8')

  it('uses the current common-label path and explicit create/get actions', () => {
    expect(gateway).toContain("'packages.common_label_create'")
    expect(gateway).toContain("'packages.common_label_get'")
    expect(gateway).toContain('/common-label/{cargoTrackingNumber}')
    expect(gateway).not.toContain('/common-label/query')
  })

  it('exposes every supported gateway action except the compatibility alias', () => {
    const gatewayActions = [...gateway.matchAll(/^\s*'([^']+)'\s*:\s*\{/gm)]
      .map(match => match[1]).filter(action => action !== 'packages.common_label').sort()
    const exposedActions = [...merchantCenter.matchAll(/\{\s*action:'([^']+)'/g)]
      .map(match => match[1]).sort()
    expect(exposedActions).toEqual(gatewayActions)
  })

  it('blocks Product V1 before the Trendyol shutdown date and exposes V2 replacements', () => {
    expect(gateway).toContain('DEPRECATED_ACTIONS')
    expect(gateway).toContain("throw new HttpError(410")
    for (const action of ['products.list', 'products.create', 'products.update']) {
      expect(gateway).not.toContain(`  '${action}':          {`)
      expect(merchantCenter).not.toContain(`action:'${action}'`)
    }
    expect(merchantCenter).toContain("action:'products.v2_create'")
    expect(merchantCenter).toContain("action:'products.v2_update_content'")
    expect(merchantCenter).toContain("action:'products.v2_update_variant'")
  })

  it('streams request limits and reserves destructive actions for the store owner', () => {
    expect(gateway).toContain('readBoundedText(req, MAX_REQUEST_BYTES)')
    expect(gateway).toContain("definition.risk === 'destructive' && actor.kind === 'employee'")
    expect(gateway).not.toContain("const contentLength = Number(req.headers.get('content-length')")
  })

  it('binds label access to a tracking number owned by the merchant', () => {
    expect(gateway).toContain(".eq('merchant_code',merchantCode).eq('platform','trendyol')")
    expect(gateway).toContain(".eq('cargo_tracking_number',trackingNumber)")
    expect(gateway).toContain('رقم التتبع غير موجود ضمن شحنات هذا المتجر')
  })

  it('separates operational permissions from credential administration', () => {
    expect(gateway).toContain("return ['orders','integrations']")
    expect(gateway).toContain("return ['products','integrations']")
    expect(gateway).toContain("return ['statement','integrations']")
  })

  it('lets merchant teams refresh the Trendyol data they operate without credential access', () => {
    expect(trendyolSync).toContain("['integrations','orders','products','statement','customers']")
    expect(trendyolSync).toContain('authorizeMerchantSync(req, admin, SERVICE_KEY, merchantCode')
  })

  it('binds invoice links and files to a package owned by the merchant', () => {
    expect(gateway).toContain("!action.startsWith('invoices.')")
    expect(gateway).toContain("input?.payload?.serviceSourceId")
    expect(gateway).toContain('normalizeTrendyolInvoiceLink(input?.payload)')
    expect(orders).toContain("action:'invoices.send_link'")
    expect(orders).toContain('إرسال رابط الفاتورة')
  })

  it('offers label creation and download as merchant-facing order actions', () => {
    expect(orders).toContain("runPackageLabelAction('packages.common_label_create')")
    expect(orders).toContain("runPackageLabelAction('packages.common_label_get')")
    expect(orders).toContain('trendyol-label-${trackingNumber}.zpl')
  })

  it('keeps the merchant tracking form aligned with the gateway payload', () => {
    expect(gateway).toContain("input?.payload?.cargoSenderNumber")
    expect(gateway).toContain("input?.payload?.providerCode")
    expect(merchantCenter).toContain("cargoSenderNumber:form.tracking.trim()")
    expect(merchantCenter).toContain("providerCode:form.carrier.trim()")
    expect(merchantCenter).not.toContain("payload:{trackingNumber:form.tracking.trim()}")
  })

  it('sends order lines and invoice context for merchant package status changes', () => {
    expect(merchantCenter).toContain("lines:[{lineId,quantity}]")
    expect(merchantCenter).toContain("params:{invoiceNumber:form.invoiceNumber.trim()}")
    expect(merchantCenter).toContain("data?.data?.data_base64")
    expect(merchantCenter).not.toContain('payloadHint:\'{"status":"Shipped"}\'')
  })

  it('routes merchants to contextual records instead of asking them to discover technical identifiers', () => {
    expect(merchantCenter).toContain("label:'/orders'")
    expect(merchantCenter).toContain("status:'/orders'")
    expect(merchantCenter).toContain("stock:'/products'")
    expect(merchantCenter).toContain("approve_return:'/statement'")
    expect(merchantCenter).toContain('onClick={()=>chooseAction(id)}')
    expect(merchantCenter).not.toContain('onClick={()=>{setAction(id);setMessage(null)}}')
  })

  it('binds bulk price and inventory updates to linked products in the same merchant', () => {
    expect(gateway).toContain("if (action === 'products.price_inventory')")
    expect(gateway).toContain(".select('id,name,barcode,platform_source,raw').eq('merchant_code',merchantCode).in('barcode',barcodes)")
    expect(gateway).toContain('input.__bulkProducts = barcodes.map')
    expect(gateway).toContain("notes:product.listing?.notes || 'trendyol_price_inventory'")
    expect(gateway).toContain("upsert(rows,{ onConflict:'product_id,platform' })")
  })

  it('binds return decisions to pending claims owned by the same merchant and persists the result', () => {
    expect(gateway).toContain('await validateClaimContext(admin, merchantCode, action, input)')
    expect(gateway).toContain(".eq('merchant_code',merchantCode).eq('platform','trendyol').eq('claim_id',claimId)")
    expect(gateway).toContain("String(row.status || '').toLowerCase() !== 'pending'")
    expect(gateway).toContain("const nextStatus = action === 'claims.approve' ? 'approved' : 'rejected'")
    expect(gateway).toContain(".in('provider_claim_item_id',input.__claimItemIds || [])")
  })

  it('presents returns as merchant decisions without browser-native confirmations or technical identifiers', () => {
    expect(statement).toContain('إدارة المرتجعات')
    expect(statement).toContain('تأكيد القبول وإرساله')
    expect(statement).toContain('تحديث من Trendyol')
    expect(statement).not.toContain('window.confirm(`تأكيد ${label}')
    expect(statement).not.toContain('JSON')
  })

  it('separates customer-service permission from marketplace credential administration', () => {
    expect(syncBoundary).toContain("employeePermissions: string[] = ['integrations']")
    expect(gateway).toContain("if (action.startsWith('questions.')) return ['customers','integrations']")
    expect(customerPermissionMigration).toContain("ARRAY['customers', 'integrations']::text[]")
    expect(app).toContain("customers: 'customers'")
    expect(app).not.toContain("label: 'خدمة العملاء', key: 'customers'")
  })

  it('binds every customer reply to an unanswered question owned by the current merchant', () => {
    expect(gateway).toContain('await validateQuestionContext(admin, merchantCode, action, input)')
    expect(gateway).toContain(".eq('merchant_code',merchantCode).eq('question_id',questionId).maybeSingle()")
    expect(gateway).toContain("String(question.status || '').toUpperCase() !== 'WAITING_FOR_ANSWER'")
  })

  it('provides a merchant-facing customer inbox without native confirmations or technical question numbers', () => {
    expect(customerService).toContain('TrendyolCustomerInbox')
    expect(merchantCenter).toContain('مراجعة الرد قبل الإرسال')
    expect(merchantCenter).not.toContain("window.confirm('تأكيد إرسال هذا الرد")
    expect(merchantCenter).not.toContain('السؤال رقم {reply.question_id}')
  })
})
