import type { SupabaseClient } from '@supabase/supabase-js'
import { AD_METRIC_SAFE_COLUMNS } from './supabase'
import { fetchAllStrict, withTimeout } from './db'
import type { CatalogChannelMapping, CatalogProductIdentity } from './catalogIdentity'

export interface AdRow {
  marketplace_account_id?: string
  id: string
  platform: string
  campaign_name: string | null
  ad_group_name: string | null
  sku: string | null
  search_query: string | null
  impressions: number
  clicks: number
  orders: number
  spend: number
  revenue: number
  ctr: number | null
  roas: number | null
  cpc: number | null
  acos: number | null
  report_date: string
  upload_id: string | null
}


/** One complete account snapshot; never publish partial advertising totals. */
export async function loadMarketingData(db: SupabaseClient, code: string, signal: AbortSignal, timeoutMs=20_000) {
  const controller=new AbortController()
  const abort=()=>controller.abort()
  signal.addEventListener('abort',abort,{once:true})
  if(signal.aborted)abort()
  try {
    controller.signal.throwIfAborted()
    const [data,products,mappings]=await withTimeout(Promise.all([
      fetchAllStrict<AdRow>((f,t)=>db.from('ad_metrics').select(AD_METRIC_SAFE_COLUMNS).eq('merchant_code',code).order('id').range(f,t).abortSignal(controller.signal)),
      fetchAllStrict<CatalogProductIdentity>((f,t)=>db.from('products').select('id,name,name_en,sku,barcode,psku_code,noon_sku_child,asin,external_id,supplier_sku,model_code').eq('merchant_code',code).order('id').range(f,t).abortSignal(controller.signal)),
      fetchAllStrict<CatalogChannelMapping>((f,t)=>db.from('product_channel_mappings').select('marketplace_account_id,product_id,platform,identifier_value,source_sku,source_barcode,source_name,match_status').eq('merchant_code',code).order('id').range(f,t).abortSignal(controller.signal)),
    ]),timeoutMs)
    return {data,products,mappings}
  } finally {controller.abort();signal.removeEventListener('abort',abort)}
}
