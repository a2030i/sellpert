import { describe, expect, it } from 'vitest'
import { sellingAccountDataClient } from '../marketplaceDataScope'
import { summarizeSellpertCommission } from '../sellpertCommission'
import { buildOrderOperationQueue } from '../orderOperations'
function fixture() {
  const calls: unknown[][] = []
  const query: any = new Proxy({}, {get: (_, method) => (...args: unknown[]) => {calls.push([method,...args]);return query}})
  const client = {from:(table:string) => {calls.push(['from',table]);return query}, rpc:(name:string,args:any) => {calls.push(['rpc',name,args]);return query}}
  return {client,calls}
}
describe('selling-account data boundary', () => {
  it('captures the account selection so late requests cannot switch tenant or seller', () => {
    const {client,calls}=fixture();const ids=['seller-a']
    const scoped=sellingAccountDataClient(client,'workspace-a',ids)
    ids[0]='seller-b'
    scoped.from('orders').select('id,total_amount')
    expect(calls).toContainEqual(['eq','merchant_code','workspace-a'])
    expect(calls).toContainEqual(['in','marketplace_account_id',['seller-a']])
    expect(calls).toContainEqual(['select','id,total_amount,marketplace_account_id',undefined])
  })
  it('does not choose the first account for an aggregate write', () => {
    const {client}=fixture();const scoped=sellingAccountDataClient(client,'workspace-a',['seller-a','seller-b'])
    expect(() => scoped.from('inventory').insert({sku:'SAME'})).toThrow('اختر حساب')
    expect(() => scoped.from('orders').insert({merchant_code:'workspace-b',marketplace_account_id:'seller-a'})).toThrow()
    expect(() => scoped.from('orders').insert({marketplace_account_id:'seller-c'})).toThrow()
  })
  it('retains account provenance in natural upserts and safe fact RPCs', () => {
    const {client,calls}=fixture();const scoped=sellingAccountDataClient(client,'workspace-a',['seller-a'])
    scoped.from('product_platform_prices').upsert({product_id:'variant',platform:'amazon'},{onConflict:'product_id,platform'})
    expect(calls).toContainEqual(['upsert',{product_id:'variant',platform:'amazon',merchant_code:'workspace-a',marketplace_account_id:'seller-a'},{onConflict:'product_id,platform,marketplace_account_id'}])
    scoped.rpc('list_return_facts',{p_merchant_code:'workspace-a'})
    expect(calls).toContainEqual(['rpc','list_return_facts_by_account',{p_merchant_code:'workspace-a'}])
  })
  it('counts the same provider order reference in two accounts as two orders', () => {
    const orders=['seller-a','seller-b'].map(marketplace_account_id => ({marketplace_account_id,merchant_code:'workspace',platform:'amazon',order_id:'same',status:'delivered',total_amount:100}))
    expect(summarizeSellpertCommission(orders,{sellpert_fee_type:'fixed',sellpert_fee_value:5})).toMatchObject({eligibleOrders:2,commission:10,commissionableSales:200})
  })
  it('never associates a shipment with the other account’s identically numbered order', () => {
    const orders=['a','b'].map(marketplace_account_id => ({id:marketplace_account_id,marketplace_account_id,order_id:'same',platform:'trendyol',status:'pending'}))
    const result=buildOrderOperationQueue(orders,[{id:'package',marketplace_account_id:'a',order_id:'same',shipment_package_id:'same-package',status:'Created'}])
    expect(result.rows[0].order.id).toBe('a')
  })
})
