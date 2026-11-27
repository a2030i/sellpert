import { supabase } from './supabase'
import { fetchAllStrict } from './db'

export type SellingAccount = {
  id: string
  merchant_code: string
  platform: string
  label: string
  external_seller_id: string | null
  status: 'pending' | 'active' | 'disconnected'
  is_legacy: boolean
}
export async function listSellingAccounts(merchant: string, platform?: string): Promise<SellingAccount[]> {
  return fetchAllStrict<SellingAccount>((from, to) => {
    let query = supabase.from('marketplace_accounts')
      .select('id,merchant_code,platform,label,external_seller_id,status,is_legacy')
      .eq('merchant_code', merchant).order('created_at').order('id').range(from, to)
    if (platform) query = query.eq('platform', platform)
    return query
  })
}
export async function manageSellingAccount(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('manage-marketplace-accounts', { body })
  if (error || data?.error) throw new Error(data?.error || 'تعذر تحديث حساب البيع. أعد المحاولة.')
  return data
}
