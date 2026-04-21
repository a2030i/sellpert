import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export type UserRole = 'merchant' | 'admin' | 'super_admin'

export interface Merchant {
  id: string
  merchant_code: string
  name: string
  email: string
  currency: string
  logo_url?: string
  role: UserRole
  subscription_plan: 'free' | 'pro' | 'elite'
  whatsapp_phone?: string
  created_at: string
}

export interface PerformanceData {
  id: string
  merchant_code: string
  created_at: string
  data_date?: string
  platform: 'trendyol' | 'noon' | 'amazon' | 'salla' | 'zid' | 'shopify' | 'other'
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
  platform: 'trendyol' | 'noon' | 'amazon'
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
  platform: 'trendyol' | 'noon' | 'amazon' | 'salla' | 'zid' | 'shopify' | 'other'
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
  platform: 'trendyol' | 'noon' | 'amazon' | 'salla' | 'zid' | 'shopify' | 'warehouse'
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
  platform: 'trendyol' | 'noon' | 'amazon' | 'respondly'
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
