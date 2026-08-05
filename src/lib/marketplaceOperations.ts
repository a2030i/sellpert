import { supabase } from './supabase'

export type MarketplaceOperationTarget = 'product' | 'products' | 'order' | 'orders' | 'questions' | 'returns' | 'integration'

export interface MarketplaceOperationFact {
  id: string
  merchant_code: string
  platform: string
  action: string
  risk_level: string
  status: string
  reference?: string | null
  error_message?: string | null
  started_at: string
  finished_at?: string | null
  target_type: MarketplaceOperationTarget
  target_id?: string | null
}

export function listMarketplaceOperationFacts(options: {
  merchantCode: string
  platform?: string | null
  productId?: string | null
  orderId?: string | null
  packageId?: string | null
  limit?: number
}) {
  return supabase.rpc('list_marketplace_operation_facts', {
    p_merchant_code: options.merchantCode,
    p_platform: options.platform ?? null,
    p_product_id: options.productId ?? null,
    p_order_id: options.orderId ?? null,
    p_package_id: options.packageId ?? null,
    p_limit: options.limit ?? 100,
  }) as unknown as Promise<{ data: MarketplaceOperationFact[] | null; error: unknown }>
}

export function marketplaceOperationPath(operation: Pick<MarketplaceOperationFact, 'target_type' | 'target_id'>) {
  if (operation.target_type === 'product' && operation.target_id) return `/product-detail?id=${encodeURIComponent(operation.target_id)}`
  if (operation.target_type === 'products') return '/products'
  if (operation.target_type === 'order' && operation.target_id) return `/orders?order=${encodeURIComponent(operation.target_id)}`
  if (operation.target_type === 'orders') return '/orders'
  if (operation.target_type === 'questions') return '/integrations?panel=trendyol-questions'
  if (operation.target_type === 'returns') return '/statement?tab=returns'
  return '/integrations'
}
