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
})
