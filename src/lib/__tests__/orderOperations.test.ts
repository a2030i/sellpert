import { describe, expect, it } from 'vitest'
import { buildOrderOperationQueue } from '../orderOperations'

describe('merchant order operations queue', () => {
  const orders = [
    { id:'o1', order_id:'T-1', platform:'trendyol', status:'pending', order_date:'2026-08-04' },
    { id:'o2', order_id:'A-1', platform:'amazon', status:'pending', order_date:'2026-08-04' },
  ]

  it('keeps Trendyol packages attached to their merchant-visible order workflow', () => {
    const queue = buildOrderOperationQueue(orders, [
      { id:'p1', order_id:'T-1', shipment_package_id:'pkg-1', provider_status:'Created' },
      { id:'p2', order_id:'A-1', shipment_package_id:'pkg-2', provider_status:'Created' },
    ])
    expect(queue.rows).toHaveLength(1)
    expect(queue.picking.map(row => row.package.shipment_package_id)).toEqual(['pkg-1'])
  })

  it('separates invoice and tracking queues after preparation starts', () => {
    const queue = buildOrderOperationQueue(orders, [
      { id:'p1', order_id:'T-1', shipment_package_id:'pkg-1', provider_status:'Picking', cargo_tracking_number:null, invoice_number:null },
    ])
    expect(queue.picking).toHaveLength(0)
    expect(queue.invoicing).toHaveLength(1)
    expect(queue.tracking).toHaveLength(1)
    expect(queue.tasks.map(task => task.kind)).toEqual(['invoicing', 'tracking'])
  })

  it('keeps a rejected invoice actionable even when an old invoice number exists', () => {
    const queue = buildOrderOperationQueue(orders, [
      {
        id:'p1', order_id:'T-1', shipment_package_id:'pkg-1', provider_status:'Picking',
        invoice_number:'INV-OLD', invoice_status:'Rejected', invoice_rejected_reasons:['الصورة غير واضحة'],
        cargo_tracking_number:'TRACK-1',
      },
    ])

    expect(queue.invoicing).toHaveLength(1)
    expect(queue.invoicing[0].needsInvoiceCorrection).toBe(true)
    expect(queue.tasks).toHaveLength(1)
    expect(queue.tasks[0]).toMatchObject({ kind:'invoicing', label:'تصحيح الفاتورة', priority:0 })
  })
})
