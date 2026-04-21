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
