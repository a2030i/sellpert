export type InventoryEvidenceRow = {
  quantity?: number | null; cost_price?: number | null; selling_price?: number | null
  daily_velocity?: number | null; sold_30d?: number | null; data_age_days?: number | null
}

/** Unknown costs and absent sales observations must not become zero-valued decisions. */
export function inventoryEvidence(rows: InventoryEvidenceRow[]) {
  const total=rows.length
  const costed=rows.filter(r=>Number(r.cost_price)>0).length
  const observed=rows.filter(r=>r.data_age_days!=null && Number(r.daily_velocity)>0).length
  const stale=rows.some(r=>r.data_age_days!=null && Number(r.data_age_days)>2)
  const costValue=total && rows.every(r=>Number(r.quantity)<=0 || Number(r.cost_price)>0)
    ? rows.reduce((sum,r)=>sum+Math.max(Number(r.quantity)||0,0)*Number(r.cost_price||0),0) : null
  const retailValue=total && rows.every(r=>Number(r.quantity)<=0 || Number(r.selling_price)>0)
    ? rows.reduce((sum,r)=>sum+Math.max(Number(r.quantity)||0,0)*Number(r.selling_price||0),0) : null
  return {total,costed,observed,stale,costValue,retailValue,
    costCoverage:total?100*costed/total:0,velocityCoverage:total?100*observed/total:0,
    purchaseGate:!total || observed<total ? 'insufficient' as const
      : stale ? 'stale' as const : costed<total ? 'costs' as const : 'empty' as const}
}
