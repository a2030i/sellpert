export type PurchaseReadinessStatus =
  | 'inventory_stale'
  | 'cost_data_incomplete'
  | 'no_purchase_needed'
  | 'bank_balance_missing'
  | 'bank_balance_stale'
  | 'ready'
  | 'shortfall'

export type PurchaseReadiness = {
  horizon_days: number
  status: PurchaseReadinessStatus
  confidence: 'high' | 'medium' | 'low'
  bank: {
    balance: number | null
    balance_date: string | null
    age_days: number | null
    is_fresh: boolean
    currency: string
    account_hint: string | null
  }
  payouts: {
    confirmed_total: number
    count: number
    rows: Array<{ platform: string; payout_date: string; amount: number; source: string }>
  }
  purchase_plan: {
    item_count: number
    unit_count: number
    estimated_cost: number
    data_as_of: string | null
    top_items: Array<{
      inventory_id: string
      platform: string
      sku: string
      product_name: string | null
      recommended_quantity: number
      estimated_cost: number
      urgency: 'critical' | 'high' | 'medium'
    }>
  }
  readiness: {
    available_before_purchase: number | null
    cash_after_purchase: number | null
    funding_gap: number | null
    coverage_pct: number | null
  }
  data_quality: {
    missing_cost_count: number
    stale_inventory_count: number
  }
  unconfirmed_sales: {
    gross_total: number
    included_in_available_cash: false
  }
}

const numberOrNull = (value: unknown) => value == null || value === '' ? null : Number(value)
const numberOrZero = (value: unknown) => Number(value || 0)

export function normalizePurchaseReadiness(value: unknown): PurchaseReadiness {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PURCHASE_READINESS')
  const raw = value as Record<string, any>
  const bank = raw.bank || {}
  const payouts = raw.payouts || {}
  const plan = raw.purchase_plan || {}
  const readiness = raw.readiness || {}
  const quality = raw.data_quality || {}
  const sales = raw.unconfirmed_sales || {}

  return {
    horizon_days: numberOrZero(raw.horizon_days) || 30,
    status: raw.status,
    confidence: raw.confidence,
    bank: {
      balance: numberOrNull(bank.balance), balance_date: bank.balance_date || null,
      age_days: numberOrNull(bank.age_days), is_fresh: bank.is_fresh === true,
      currency: bank.currency || 'SAR', account_hint: bank.account_hint || null,
    },
    payouts: {
      confirmed_total: numberOrZero(payouts.confirmed_total), count: numberOrZero(payouts.count),
      rows: Array.isArray(payouts.rows) ? payouts.rows.map((row: any) => ({ ...row, amount: numberOrZero(row.amount) })) : [],
    },
    purchase_plan: {
      item_count: numberOrZero(plan.item_count), unit_count: numberOrZero(plan.unit_count),
      estimated_cost: numberOrZero(plan.estimated_cost), data_as_of: plan.data_as_of || null,
      top_items: Array.isArray(plan.top_items) ? plan.top_items.map((row: any) => ({
        ...row, recommended_quantity: numberOrZero(row.recommended_quantity), estimated_cost: numberOrZero(row.estimated_cost),
      })) : [],
    },
    readiness: {
      available_before_purchase: numberOrNull(readiness.available_before_purchase),
      cash_after_purchase: numberOrNull(readiness.cash_after_purchase),
      funding_gap: numberOrNull(readiness.funding_gap), coverage_pct: numberOrNull(readiness.coverage_pct),
    },
    data_quality: {
      missing_cost_count: numberOrZero(quality.missing_cost_count),
      stale_inventory_count: numberOrZero(quality.stale_inventory_count),
    },
    unconfirmed_sales: {
      gross_total: numberOrZero(sales.gross_total), included_in_available_cash: false,
    },
  }
}
