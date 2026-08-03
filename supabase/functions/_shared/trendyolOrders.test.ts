import { mergeTrendyolShipment, trendyolLineFinancials, trendyolPackageId } from './trendyolOrders.ts'
import { trendyolPackageTransitionError, trendyolPackageWorkflow } from './trendyolPackageWorkflow.ts'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

Deno.test('Trendyol stream amounts use documented unit and package fields', () => {
  const line = trendyolLineFinancials({
    quantity: 3, lineGrossAmount: 60, lineTotalDiscount: 6,
    lineUnitPrice: 54, commission: 10, vatRate: 15,
  })
  assert(line.lineTotal === 162, 'net line total did not multiply the unit price')
  assert(line.grossTotal === 180, 'gross line total did not multiply the unit price')
  assert(line.discountTotal === 18, 'discount did not multiply the unit amount')
  assert(Math.abs(line.commissionAmount - 18.63) < 0.000001, 'Saudi commission VAT was not applied exactly once')

  const orders = new Map<string, any>()
  mergeTrendyolShipment(orders, {
    id: 999, shipmentPackageId: 333, orderNumber: 'ORDER-1',
    packageGrossAmount: 200, packageTotalDiscount: 20, packageTotalPrice: 180,
    currencyCode: 'SAR', status: 'Created',
    lines: [{ quantity: 2, lineGrossAmount: 100, lineTotalDiscount: 10, lineUnitPrice: 90, commission: 10 }],
  }, 'merchant-a', '2026-08-03T00:00:00.000Z')
  const order = orders.get('ORDER-1')
  assert(trendyolPackageId({ id:999, shipmentPackageId:333 }) === '333', 'provider package id lost precedence')
  assert(order.total_amount === 180 && order.gross_amount === 200, 'package totals were not authoritative')
  assert(order.discount_amount === 20 && Math.abs(order.platform_fee - 20.7) < 0.000001, 'discount or commission is incorrect')
})

Deno.test('Trendyol split orders remain actionable when one package is open', () => {
  const orders = new Map<string, any>()
  mergeTrendyolShipment(orders, {
    shipmentPackageId:1, orderNumber:'SPLIT-1', packageTotalPrice:100,
    status:'Delivered', lines:[{ quantity:1, lineUnitPrice:100 }],
  }, 'merchant-a')
  mergeTrendyolShipment(orders, {
    shipmentPackageId:2, orderNumber:'SPLIT-1', packageTotalPrice:50,
    status:'Picking', lines:[{ quantity:1, lineUnitPrice:50 }],
  }, 'merchant-a')
  assert(orders.get('SPLIT-1').status === 'processing', 'closed package hid an actionable split package')
})

Deno.test('Trendyol write workflow enforces Picking before invoicing and tracking', () => {
  assert(trendyolPackageWorkflow({ provider_status:'Created' }).canStartPicking, 'Created package cannot start')
  assert(
    trendyolPackageTransitionError({ provider_status:'Created' }, 'packages.status', 'Invoiced')?.includes('Picking'),
    'invoice transition bypassed Picking',
  )
  assert(
    trendyolPackageTransitionError({ provider_status:'Picking' }, 'packages.status', 'Invoiced') === null,
    'valid invoice transition was rejected',
  )
  assert(
    trendyolPackageTransitionError({ provider_status:'Delivered' }, 'packages.tracking') !== null,
    'tracking update was accepted for a closed package',
  )
})
