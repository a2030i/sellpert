import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export type UserRole = 'merchant' | 'admin' | 'super_admin' | 'employee'

export interface Merchant {
  id: string
  merchant_code: string
  name: string
  email: string
  currency: string
  logo_url?: string
  role: UserRole
  subscription_plan?: string
  whatsapp_phone?: string
  sellpert_commission_rate?: number
  subscription_monthly_amount?: number
  fixed_fee_per_order?: number
  subscription_status?: string
  salla_store_id?: string
  onboarding_done?: boolean
  signup_source?: string
  created_at: string
}

export type PerformancePlatform = 'salla' | 'noon' | 'amazon' | 'trendyol' | 'zid' | 'shopify' | 'other'
export type OrderPlatform      = 'trendyol' | 'noon' | 'amazon'
export type InventoryPlatform  = 'trendyol' | 'noon' | 'amazon' | 'warehouse'
export type ConnectionPlatform = 'trendyol' | 'noon' | 'amazon' | 'respondly' | 'openrouter'

export interface PerformanceData {
  id: string
  merchant_code: string
  created_at: string
  data_date?: string
  platform: PerformancePlatform
  total_sales: number
  order_count: number
  margin: number
  ad_spend: number
  platform_fees: number
  product_name?: string
}

export interface PlatformCredential {
  id: string
  merchant_code: string
  platform: ConnectionPlatform
  seller_id?: string
  api_key?: string
  api_secret?: string
  extra?: Record<string, any>
  is_active: boolean
  last_sync_at?: string
  records_synced?: number
  created_at: string
  updated_at: string
}

export interface SyncLog {
  id: string
  merchant_code: string
  platform: string
  status: 'running' | 'success' | 'error'
  records_synced: number
  error_message?: string
  started_at: string
  finished_at?: string
}

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned'

export interface Order {
  id: string
  merchant_code: string
  platform: OrderPlatform
  order_id: string
  status: OrderStatus
  product_name?: string
  sku?: string
  quantity: number
  unit_price: number
  total_amount: number
  platform_fee?: number
  shipping_cost?: number
  currency: string
  customer_city?: string
  order_date: string
  created_at: string
}

export interface InventoryItem {
  id: string
  merchant_code: string
  sku: string
  product_name: string
  platform: InventoryPlatform
  quantity: number
  reserved_quantity: number
  low_stock_threshold: number
  cost_price?: number
  image_url?: string
  is_active: boolean
  last_updated: string
  created_at: string
}

export interface PlatformConnection {
  id: string
  platform: ConnectionPlatform
  label: string
  api_key?: string
  api_secret?: string
  extra?: Record<string, any>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MerchantPlatformMapping {
  id: string
  merchant_code: string
  connection_id: string
  platform: string
  seller_id: string
  is_active: boolean
  last_sync_at?: string
  last_sync_status?: 'success' | 'error' | 'running'
  last_sync_error?: string
  records_synced?: number
  created_at: string
}

export type Platform = PerformancePlatform

export interface CommissionRate {
  id: string
  platform: OrderPlatform
  category: string
  rate: number
  vat_rate: number
  shipping_fee: number
  other_fees: number
  notes?: string
  updated_at: string
}

export interface Product {
  id: string
  merchant_code: string
  name: string
  sku?: string
  barcode?: string
  category?: string
  description?: string
  image_url?: string
  cost_price: number
  target_net_price: number
  status: 'active' | 'inactive' | 'out_of_stock'
  created_at: string
  updated_at: string
}

export interface ProductPlatformPrice {
  id: string
  product_id: string
  merchant_code: string
  platform: OrderPlatform
  selling_price: number
  commission_rate: number
  is_active: boolean
  override_price?: number
  notes?: string
  updated_at: string
  updated_by?: string
}

export interface PriceChangeLog {
  id: string
  product_id: string
  merchant_code: string
  platform?: string
  old_price?: number
  new_price?: number
  changed_by?: string
  reason?: string
  created_at: string
}

export type MerchantRequestType = 'price_change' | 'add_product' | 'remove_product' | 'update_info' | 'other'
export type MerchantRequestStatus = 'pending' | 'in_progress' | 'done' | 'rejected'

export interface MerchantRequest {
  id: string
  merchant_code: string
  type: MerchantRequestType
  product_id?: string
  details: Record<string, any>
  status: MerchantRequestStatus
  note?: string
  admin_note?: string
  created_at: string
  resolved_at?: string
  resolved_by?: string
}

export interface AiInsight {
  id: string
  merchant_code: string
  insight_type: string
  content: {
    summary?: string
    best_days?: string[]
    best_platforms?: { platform: string; reason: string }[]
    seasonal_insights?: string[]
    forecast_next_week?: { amount: number; confidence: string; reasoning?: string }
    top_products?: { name: string; revenue: number; trend: 'up' | 'down' | 'stable' }[]
    recommendations?: string[]
    low_stock_alert?: string[]
  }
  model_used?: string
  created_at: string
}
