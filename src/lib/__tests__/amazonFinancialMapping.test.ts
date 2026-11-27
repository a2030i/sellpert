import { describe, expect, it } from 'vitest'
import { amazonFeeByOrder, amazonTransactionFee, mapAmazonFinancialTransaction, mapAmazonOrder, mapAmazonOrderItems } from '../../../supabase/functions/_shared/amazonOrders'

// Synthetic amounts follow Amazon's published recursive Breakdown/Currency
// model. No merchant records or live provider responses are used.
const amount = (value: number) => ({currencyAmount:value,currencyCode:'SAR'})
const breakdown = (type: string, value: number, children: unknown[] = []) => ({breakdownType:type,breakdownAmount:amount(value),breakdowns:children})

describe('Amazon financial breakdowns', () => {
  it('counts an expense parent once without counting its fee children again', () => {
    expect(amazonTransactionFee({breakdowns:[
      breakdown('Sales', 115, [breakdown('Product Charges', 115)]),
      breakdown('Expenses', -17.25, [breakdown('Commission', -11.5),breakdown('FBA fees', -5.75)]),
    ]})).toBe(17.25)
  })

  it('does not double count nested fee totals below a non-expense group', () => {
    expect(amazonTransactionFee({breakdowns:[
      breakdown('Transaction', 97.75, [
        breakdown('Product Charges', 115),
        breakdown('AmazonFees', -17.25, [breakdown('Commission', -11.5),breakdown('FBA fees', -5.75)]),
      ]),
    ]})).toBe(17.25)
  })

  it('nets refund reversals and keeps fees in separate sibling branches', () => {
    const tx = (breakdowns: unknown[]) => ({relatedIdentifiers:[{relatedIdentifierName:'ORDER_ID',relatedIdentifierValue:'O-1'}],breakdowns})
    const charges = tx([breakdown('Expenses', -17.25),breakdown('Other charges', -2, [breakdown('ShippingFee', -2)])])
    const refund = tx([breakdown('Refunds', -111.5, [breakdown('RefundedPrincipal', -115),breakdown('AmazonFees', 3.5)])])
    expect(amazonFeeByOrder([charges,refund]).get('O-1')).toBe(15.75)
  })

  it('preserves the deferred status and source currency in the transaction ledger', () => {
    const row = mapAmazonFinancialTransaction({
      transactionId:'T-DEFERRED',postedDate:'2026-11-20T10:00:00Z',transactionType:'Shipment',
      transactionStatus:'DEFERRED',totalAmount:amount(97.75),
      marketplaceDetails:{marketplaceId:'A17E79C6D8DWNP'},
      relatedIdentifiers:[{relatedIdentifierName:'ORDER_ID',relatedIdentifierValue:'O-1'}],
      items:[{contexts:[{contextType:'ProductContext',sku:'SKU-1',quantityShipped:2}]}],
    }, 'M-1')
    expect(row).toMatchObject({merchant_code:'M-1',order_id:'O-1',amount_type:'DEFERRED',credit:97.75,debit:0,net_amount:97.75,currency:'SAR',product_sku:'SKU-1',quantity_purchased:2})
  })
})


describe('Amazon zero quantity', () => {
  it('preserves a documented zero instead of inventing a sold unit', () => {
    const order = {
      orderId:'O-CANCELLED',createdTime:'2026-11-20T10:00:00Z',
      fulfillment:{fulfillmentStatus:'CANCELLED'},
      proceeds:{grandTotal:{amount:'0',currencyCode:'SAR'}},
      orderItems:[{orderItemId:'I-0',quantityOrdered:0,product:{sellerSku:'SKU-0'},proceeds:{proceedsTotal:{amount:'0',currencyCode:'SAR'}}}],
    }
    expect(mapAmazonOrder(order, 'M-1')).toMatchObject({quantity:0,total_amount:0,unit_price:0,status:'cancelled'})
    expect(mapAmazonOrderItems(order, 'M-1')[0]).toMatchObject({quantity:0,line_total:0,unit_price:0})
  })
})
