import { describe, it, expect } from 'vitest'
import { bundleSummary, physicalAvailability } from '../catalogStructure'
describe('physical inventory identities', () => {
  it('does not count a shared warehouse twice', () => {
    expect(physicalAvailability([{poolId:'a',available:10,fresh:true},{poolId:'a',available:10,fresh:true}])).toBe(10)
    expect(physicalAvailability([{poolId:'a',available:10,fresh:true},{poolId:'b',available:7,fresh:true}])).toBe(17)
  })
  it('does not invent totals for unknown, stale or conflicting pools', () => {
    expect(physicalAvailability([{poolId:null,available:10,fresh:true}])).toBeNull()
    expect(physicalAvailability([{poolId:'a',available:10,fresh:false}])).toBeNull()
    expect(physicalAvailability([{poolId:'a',available:10,fresh:true},{poolId:'a',available:8,fresh:true}])).toBeNull()
  })
})
describe('virtual bundle capacity and incomplete costs', () => {
  const components = [{productId:'a',units:2,cost:3,available:12},{productId:'b',units:1,cost:4,available:5}]
  it('uses the limiting component without adding virtual units to physical stock', () => {
    expect(bundleSummary(components)).toEqual({cost:10,available:5})
  })
  it('keeps cost and stock uncertainty independent', () => {
    expect(bundleSummary([{...components[0],cost:null},components[1]])).toEqual({cost:null,available:5})
    expect(bundleSummary([{...components[0],available:null},components[1]])).toEqual({cost:10,available:null})
    expect(bundleSummary([components[0],components[0]])).toEqual({cost:null,available:null})
  })
})
