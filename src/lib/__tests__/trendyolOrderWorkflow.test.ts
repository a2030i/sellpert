import { describe, expect, it } from 'vitest'
import { trendyolPackageTransitionError, trendyolPackageWorkflow } from '../trendyolOrderWorkflow'

describe('Trendyol package workflow', () => {
  it('requires Picking before invoice and tracking actions', () => {
    expect(trendyolPackageWorkflow({ provider_status: 'Created' })).toMatchObject({
      canStartPicking: true, canInvoice: false, canUpdateTracking: false, closed: false,
    })
    expect(trendyolPackageWorkflow({ provider_status: 'Picking' })).toMatchObject({
      canStartPicking: false, canInvoice: true, canUpdateTracking: true, closed: false,
    })
  })

  it('closes manual actions after invoice or shipping', () => {
    for (const provider_status of ['Invoiced', 'Shipped', 'Delivered', 'Cancelled', 'Returned']) {
      expect(trendyolPackageWorkflow({ provider_status })).toMatchObject({
        canStartPicking: false, canInvoice: false, canUpdateTracking: false, closed: true,
      })
    }
  })

  it('uses raw provider state before the normalized fallback', () => {
    expect(trendyolPackageWorkflow({ status: 'processing', raw: { shipmentPackageStatus: 'Invoiced' } }).closed).toBe(true)
    expect(trendyolPackageWorkflow({ status: 'processing' }).canInvoice).toBe(true)
  })

  it('enforces the same transitions at the API boundary', () => {
    expect(trendyolPackageTransitionError({ provider_status:'Created' }, 'packages.status', 'Invoiced')).toContain('Picking')
    expect(trendyolPackageTransitionError({ provider_status:'Picking' }, 'packages.status', 'Invoiced')).toBeNull()
    expect(trendyolPackageTransitionError({ provider_status:'Delivered' }, 'packages.tracking')).toContain('قيد التجهيز')
  })
})
