import {describe,it,expect} from 'vitest'
import {inventoryEvidence} from './inventoryEvidence'
describe('inventory evidence gates',()=>{
  it('does not turn absent sales/cost into an all-clear or zero capital',()=>{
    const rows=Array.from({length:810},()=>({quantity:3,cost_price:0,selling_price:0,daily_velocity:0,data_age_days:null}))
    expect(inventoryEvidence(rows)).toMatchObject({total:810,observed:0,costed:0,purchaseGate:'insufficient',costValue:null,retailValue:null,costCoverage:0})
  })
  it('discloses partial costs instead of presenting the known subtotal as a total',()=>{
    expect(inventoryEvidence([{quantity:2,cost_price:5},{quantity:1,cost_price:null}])).toMatchObject({costCoverage:50,costValue:null})
    expect(inventoryEvidence([{quantity:0,cost_price:null}]).costValue).toBe(0)
  })
  it('requires complete fresh movement and costs before an empty-recommendation all-clear',()=>{
    const row={quantity:30,cost_price:5,selling_price:10,daily_velocity:1,data_age_days:1}
    expect(inventoryEvidence([row])).toMatchObject({purchaseGate:'empty',costValue:150,retailValue:300})
    expect(inventoryEvidence([{...row,data_age_days:5}]).purchaseGate).toBe('stale')
    expect(inventoryEvidence([{...row,cost_price:0}]).purchaseGate).toBe('costs')
    expect(inventoryEvidence([row,{...row,data_age_days:null}]).purchaseGate).toBe('insufficient')
    expect(inventoryEvidence([]).purchaseGate).toBe('insufficient')
  })
})
