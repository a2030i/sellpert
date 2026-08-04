import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Trendyol fulfillment action contract', () => {
  const gateway = readFileSync('supabase/functions/trendyol-actions/index.ts', 'utf8')
  const orders = readFileSync('src/pages/Orders.tsx', 'utf8')
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
})
