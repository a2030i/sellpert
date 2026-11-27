export type StockObservation = { poolId: string | null; available: number | null; fresh: boolean }
/** Sum physical pools once, only when all observations have an agreed identity. */
export function physicalAvailability(observations: StockObservation[]): number | null {
  if (!observations.length) return null
  const pools = new Map<string, number>()
  for (const observation of observations) {
    if (!observation.poolId || !observation.fresh || observation.available == null || !Number.isFinite(observation.available)) return null
    const quantity = Math.max(0, observation.available)
    if (pools.has(observation.poolId) && pools.get(observation.poolId) !== quantity) return null
    pools.set(observation.poolId, quantity)
  }
  return [...pools.values()].reduce((sum, value) => sum + value, 0)
}
export type BundleComponent = { productId: string; units: number; cost: number | null; available: number | null }
export function bundleSummary(components: BundleComponent[]) {
  if (!components.length || new Set(components.map(c => c.productId)).size !== components.length
    || components.some(c => !Number.isInteger(c.units) || c.units <= 0)) return { cost: null, available: null }
  const cost = components.some(c => c.cost == null || !Number.isFinite(c.cost) || c.cost <= 0)
    ? null : components.reduce((sum, c) => sum + c.cost! * c.units, 0)
  const available = components.some(c => c.available == null || !Number.isFinite(c.available) || c.available < 0)
    ? null : Math.min(...components.map(c => Math.floor(c.available! / c.units)))
  return { cost, available }
}
