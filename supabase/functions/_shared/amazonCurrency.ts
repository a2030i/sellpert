import { HttpError } from './sync.ts'

// Current financial aggregates are denominated in SAR and have no FX layer.
export const AMAZON_SAUDI_MARKETPLACE = 'A17E79C6D8DWNP'

export function selectAmazonSyncMarkets(marketplaces: unknown) {
  const ids = [...new Set<string>((Array.isArray(marketplaces) ? marketplaces : [])
    .map(market => typeof market?.id === 'string' ? market.id : '').filter(Boolean))]
  if (!ids.includes(AMAZON_SAUDI_MARKETPLACE)) {
    throw new HttpError(409, 'المزامنة متاحة حاليًا لحساب يبيع في أمازون السعودية وبالريال السعودي فقط')
  }
  return {
    marketplaceIds: [AMAZON_SAUDI_MARKETPLACE],
    warning: ids.some(id => id !== AMAZON_SAUDI_MARKETPLACE)
      ? 'تتم مزامنة سوق أمازون السعودية فقط؛ الأسواق الأخرى المرتبطة لا تدخل في التقارير المالية'
      : null,
  }
}

/** Reject explicit foreign currencies before native amounts reach SAR totals.
 * Missing amounts are legitimate for pending orders and remain allowed.
 */
export function assertAmazonSarAmounts(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertAmazonSarAmounts(item)
    return
  }
  if (!value || typeof value !== 'object') return
  const row = value as Record<string, unknown>
  for (const key of ['currencyCode', 'currency']) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== 'SAR') {
      throw new HttpError(502, 'توقفت مزامنة أمازون لأن البيانات تتضمن عملة غير الريال السعودي؛ لم تُحوّل المبالغ أو تُجمع')
    }
  }
  for (const child of Object.values(row)) assertAmazonSarAmounts(child)
}
