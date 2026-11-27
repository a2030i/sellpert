import { HttpError } from './sync.ts'
export type MarketplaceAccount = { id: string; merchant_code: string; platform: string; status: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FACT_TABLES = new Set(['orders','order_items','order_packages','returns','account_transactions','inventory',
  'platform_file_uploads','sync_queue','sync_logs','product_channel_mappings','product_platform_prices',
  'product_platform_listings','ad_metrics','product_performance_snapshots','amazon_daily_sales','marketplace_action_logs','performance_data','inbound_shipments','inbound_shipment_items','goods_received','platform_deals','trendyol_customer_questions','trendyol_question_reply_attempts'])
/** Authorization of the workspace is a prerequisite; the account must also match it. */
export async function requireMarketplaceAccount(admin: any, merchantCode: string, platform: string, requestedId: unknown, active = true): Promise<MarketplaceAccount> {
  if (typeof requestedId !== 'string' || !UUID.test(requestedId)) throw new HttpError(400, 'اختر حساب بيع محددًا')
  const {data,error} = await admin.from('marketplace_accounts').select('id,merchant_code,platform,status')
    .eq('id',requestedId).eq('merchant_code',merchantCode).eq('platform',platform).eq('is_legacy',false).maybeSingle()
  if (error) throw error
  if (!data || (active && data.status !== 'active')) throw new HttpError(403, 'حساب البيع غير متاح في مساحة العمل المحددة')
  return data
}
/**
 * Server-side defense in depth for provider handlers. Every fact read/update is
 * account-filtered and every insert carries the verified account and workspace.
 * Global reference and canonical-product tables deliberately remain unwrapped.
 */
export function accountScopedClient(admin: any, account: MarketplaceAccount) {
  return new Proxy(admin, {
    get(target, property) {
      if (property === 'rpc') return (name: string, args: any, options?: any) => {
        if (name === 'upsert_marketplace_products') {
          if (args.p_merchant_code !== account.merchant_code) throw new HttpError(403, 'Workspace mismatch')
          return target.rpc(name, {...args, p_account_id: account.id}, options)
        }
        return target.rpc(name, args, options)
      }
      if (property !== 'from') { const value=Reflect.get(target,property); return typeof value==='function' ? value.bind(target) : value }
      return (table: string) => {
        const builder = target.from(table)
        if (!FACT_TABLES.has(table) && !['platform_credentials','salla_connections'].includes(table)) return builder
        return new Proxy(builder, {
          get(query, method) {
            if (['select','update','delete'].includes(String(method))) return (...args: any[]) =>
              query[method](...args).eq('merchant_code',account.merchant_code).eq('marketplace_account_id',account.id)
            if (method==='insert' || method==='upsert') return (values: any, options?: any) => {
              const stamp = (row: any) => {
                if ((row.merchant_code && row.merchant_code!==account.merchant_code) || (row.platform && row.platform!==account.platform)
                  || (row.marketplace_account_id && row.marketplace_account_id!==account.id)) throw new HttpError(403,'Selling account scope mismatch')
                return {...row,merchant_code:account.merchant_code,marketplace_account_id:account.id}
              }
              const conflict=options?.onConflict
              const nextOptions=conflict && conflict !== 'id' && !conflict.split(',').includes('marketplace_account_id')
                ? {...options,onConflict:`${conflict},marketplace_account_id`} : options
              return query[method](Array.isArray(values) ? values.map(stamp) : stamp(values),nextOptions)
            }
            const value=Reflect.get(query,method)
            return typeof value==='function' ? value.bind(query) : value
          },
        })
      }
    },
  })
}

/** Older callers may omit a selector only when there is exactly one active seller. */
export async function resolveMarketplaceAccount(admin: any, merchant: string, platform: string, requested: unknown) {
  if (requested) return requireMarketplaceAccount(admin,merchant,platform,requested)
  const {data,error}=await admin.from('marketplace_accounts').select('id,merchant_code,platform,status')
    .eq('merchant_code',merchant).eq('platform',platform).eq('status','active').eq('is_legacy',false).limit(2)
  if (error) throw error
  if (data?.length!==1) throw new HttpError(409,'اختر حساب البيع المطلوب من صفحة الربط')
  return data[0] as MarketplaceAccount
}
