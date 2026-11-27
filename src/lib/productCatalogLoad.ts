import type { SupabaseClient } from '@supabase/supabase-js'
import { PRODUCT_SAFE_COLUMNS, type Product, type ProductPlatformPrice } from './supabase'
import { fetchAllStrict, withTimeout } from './db'
import type { FeeCategory } from './commission'
import type { CatalogChannelMapping } from './catalogIdentity'
import type { LineageUpload } from './dataLineage'

export type TrendyolInventoryRow = { marketplace_account_id:string; sku: string; partner_sku: string | null; quantity: number }
export type TrendyolListingRow = { provider_barcode?:string|null; provider_product_id?:string|null; marketplace_account_id:string; product_id: string; delivery_status: string; delivery_error: string | null; external_batch_id: string | null; catalog_status: string | null; catalog_error: string | null }

/** Read a complete snapshot, cancel all siblings on failure, and bound the entire load. */
export async function loadProductCatalog(
  supabase: SupabaseClient,
  merchantCode: string,
  includeTrendyolOperations: boolean,
  signal: AbortSignal,
  timeoutMs = 20_000,
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    controller.signal.throwIfAborted()
    const [productRows, priceRows, rateRows, inventoryRows, listingRows, uploadRows, mappingRows] = await withTimeout(Promise.all([
      fetchAllStrict<Product>((f,t)=>supabase.from('products').select(PRODUCT_SAFE_COLUMNS).eq('merchant_code',merchantCode).order('created_at',{ascending:false}).order('id').range(f,t).abortSignal(controller.signal)),
      fetchAllStrict<ProductPlatformPrice>((f,t)=>supabase.from('product_platform_prices').select('*').eq('merchant_code',merchantCode).order('id').range(f,t).abortSignal(controller.signal)),
      fetchAllStrict<FeeCategory>((f,t)=>supabase.from('platform_fee_categories').select('platform,category_key,commission_rate,commission_fbn_fba,min_fee_sar').order('platform').order('category_key').range(f,t).abortSignal(controller.signal)),
      includeTrendyolOperations ? fetchAllStrict<TrendyolInventoryRow>((f,t)=>supabase.from('inventory').select('marketplace_account_id,sku,partner_sku,quantity').eq('merchant_code',merchantCode).eq('platform','trendyol').eq('is_active',true).order('id').range(f,t).abortSignal(controller.signal)) : Promise.resolve([]),
      includeTrendyolOperations ? fetchAllStrict<TrendyolListingRow>((f,t)=>supabase.from('product_platform_listings').select('provider_barcode,provider_product_id,marketplace_account_id,product_id,delivery_status,delivery_error,external_batch_id,catalog_status,catalog_error').eq('merchant_code',merchantCode).eq('platform','trendyol').order('id').range(f,t).abortSignal(controller.signal)) : Promise.resolve([]),
      fetchAllStrict<LineageUpload>((f,t)=>supabase.from('platform_file_uploads').select('id,platform,file_name,file_type,uploaded_at').eq('merchant_code',merchantCode).order('uploaded_at',{ascending:false}).order('id').range(f,t).abortSignal(controller.signal)),
      includeTrendyolOperations ? fetchAllStrict<CatalogChannelMapping>((f,t)=>supabase.from('product_channel_mappings').select('product_id,platform,marketplace_account_id,identifier_value,source_sku,source_barcode,match_status').eq('merchant_code',merchantCode).eq('match_status','linked').order('id').range(f,t).abortSignal(controller.signal)) : Promise.resolve([]),
    ]), timeoutMs)
    return { productRows, priceRows, rateRows, inventoryRows, listingRows, uploadRows, mappingRows }
  } finally {
    controller.abort()
    signal.removeEventListener('abort', abort)
  }
}
