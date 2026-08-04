const CANCELLATION_REASON_IDS = new Set([500, 501, 502, 503, 504, 505, 506])

export type RequestedPackageLine = { lineId: string; quantity: number }

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

export function normalizeTrendyolCancelPayload(payload: any) {
  const lines = payload?.lines
  const reasonId = Number(payload?.reasonId)
  if (!Array.isArray(lines) || !lines.length || lines.length > 200 || !CANCELLATION_REASON_IDS.has(reasonId)) {
    throw new Error('اختر البنود والكميات وسبب تعذر التوفير')
  }
  const normalizedLines = lines.map((line:any) => ({
    lineId: positiveInteger(line?.lineId),
    quantity: positiveInteger(line?.quantity),
  }))
  if (normalizedLines.some(line => line.lineId === null || line.quantity === null)) {
    throw new Error('بيانات بنود الإلغاء غير صالحة')
  }
  return {
    lines: normalizedLines as Array<{ lineId:number; quantity:number }>,
    reasonId,
    shouldKeepPreviousStatus: payload?.shouldKeepPreviousStatus !== false,
  }
}

export function normalizeTrendyolSplitPayload(payload: any) {
  const splitPackages = payload?.splitPackages
  if (!Array.isArray(splitPackages) || !splitPackages.length || splitPackages.length > 20) {
    throw new Error('أضف مجموعة واحدة على الأقل لتقسيم الشحنة')
  }
  const normalizedGroups = splitPackages.map((group:any) => {
    if (!Array.isArray(group?.packageDetails) || !group.packageDetails.length) {
      throw new Error('بنود تقسيم الشحنة غير مكتملة')
    }
    return {
      packageDetails: group.packageDetails.map((line:any) => ({
        orderLineId: positiveInteger(line?.orderLineId),
        quantities: positiveInteger(line?.quantities),
      })),
    }
  })
  const details = normalizedGroups.flatMap(group => group.packageDetails)
  if (details.length > 200 || details.some(line => line.orderLineId === null || line.quantities === null)) {
    throw new Error('كميات تقسيم الشحنة غير صالحة')
  }
  return {
    splitPackages: normalizedGroups as Array<{ packageDetails:Array<{ orderLineId:number; quantities:number }> }>,
    shouldKeepPreviousStatus: payload?.shouldKeepPreviousStatus !== false,
  }
}

export function requestedTrendyolPackageLines(action: 'packages.cancel' | 'packages.split', payload: any): RequestedPackageLine[] {
  return action === 'packages.cancel'
    ? payload.lines.map((line:any) => ({ lineId:String(line.lineId), quantity:Number(line.quantity) }))
    : payload.splitPackages.flatMap((group:any) => group.packageDetails.map((line:any) => ({ lineId:String(line.orderLineId), quantity:Number(line.quantities) })))
}

export function trendyolPackageLinesAreAvailable(
  requested: RequestedPackageLine[],
  availableRows: Array<{ line_id:unknown; quantity:unknown }>,
) {
  const available = new Map(availableRows.map(line => [String(line.line_id), Number(line.quantity)]))
  const requestedTotals = new Map<string,number>()
  for (const line of requested) requestedTotals.set(line.lineId, (requestedTotals.get(line.lineId) || 0) + line.quantity)
  return [...requestedTotals].every(([lineId, quantity]) => available.has(lineId) && quantity <= Number(available.get(lineId) || 0))
}
