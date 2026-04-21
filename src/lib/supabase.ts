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
  platform: 'salla' | 'noon' | 'amazon' | 'zid' | 'shopify' | 'other'
  total_sales: number
  order_count: number
  margin: number
  ad_spend: number
  platform_fees: number
  product_name?: string
}
