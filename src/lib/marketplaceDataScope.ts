export const ACCOUNT_FACT_TABLES = new Set([
  'orders', 'order_items', 'order_packages', 'returns', 'account_transactions', 'inventory',
  'platform_file_uploads', 'sync_queue', 'sync_logs', 'product_channel_mappings', 'product_platform_prices',
  'product_platform_listings', 'ad_metrics', 'performance_data', 'product_performance_snapshots',
  'amazon_daily_sales', 'marketplace_action_logs', 'inbound_shipments', 'inbound_shipment_items',
  'goods_received', 'platform_deals', 'trendyol_customer_questions', 'trendyol_question_reply_attempts',
])
const ACCOUNT_VIEWS = new Set(['monthly_cashflow','inventory_health','inventory_ageing','inventory_pipeline','inventory_reorder_recommendations','platform_fee_profile','platform_return_profile','ad_net_summary'])
const FACT_RPCS = new Set(['list_order_operating_facts', 'list_return_facts'])
/** Immutable per-render query client; server tenant authorization remains authoritative. */
export function sellingAccountDataClient<T extends object>(client: T, merchant: string, accountIds: readonly string[], includeUnassignedProducts = false): T {
  const ids = [...accountIds]
  const filter = (query: any) => query.eq('merchant_code', merchant).in('marketplace_account_id', ids)
  return new Proxy(client, {
    get(target: any, property) {
      if (property === 'rpc') return (name: string, args: any, options?: any) => {
        if (name === 'statement_costs') return target.rpc('statement_costs_by_account',{...args,p_account_ids:ids},options)
        if (name === 'revenue_forecast') return target.rpc('revenue_forecast_by_account', {...args,p_account_ids:ids},options)
        if (FACT_RPCS.has(name)) return filter(target.rpc(`${name}_by_account`, args, options))
        if (name === 'unified_product_catalog') return (async () => {
          const scopedArgs = { ...args, p_account_ids: ids }
          const result = await target.rpc('unified_product_catalog_by_account', { ...scopedArgs, p_include_unassigned: includeUnassignedProducts }, options)
          // Frontend/backend release independently. Only a missing new signature
          // permits the old contract; authorization and query failures never do.
          return result.error?.code === 'PGRST202'
            ? target.rpc('unified_product_catalog_by_account', scopedArgs, options) : result
        })()
        return target.rpc(name, args, options)
      }
      if (property !== 'from') { const v = target[property]; return typeof v === 'function' ? v.bind(target) : v }
      return (table: string) => {
        if (table === 'product_profitability') return {select: (columns = '*', options?: any) => target.rpc('product_profitability_for_accounts', {p_merchant_code: merchant, p_account_ids: ids}, options).select(columns)}
        const query = target.from(ACCOUNT_VIEWS.has(table) ? `${table}_by_account` : table)
        if (!ACCOUNT_FACT_TABLES.has(table) && !ACCOUNT_VIEWS.has(table)) return query
        return new Proxy(query, { get(builder, method) {
          if (method === 'select') return (columns = '*', options?: any) => {
            const fields = columns === '*' || columns.split(',').includes('marketplace_account_id') ? columns : `${columns},marketplace_account_id`
            return filter(builder.select(fields, options))
          }
          if (method === 'update' || method === 'delete') return (...args: any[]) => filter(builder[method](...args))
          if (method === 'insert' || method === 'upsert') return (values: any, options?: any) => {
            const stamp = (row: any) => {
              const id = row.marketplace_account_id || (ids.length === 1 ? ids[0] : null)
              if (!id || !ids.includes(id) || (row.merchant_code && row.merchant_code !== merchant)) throw new Error('اختر حساب بيع واحدًا قبل حفظ البيانات')
              return { ...row, merchant_code: merchant, marketplace_account_id: id }
            }
            const conflict = options?.onConflict
            return builder[method](Array.isArray(values) ? values.map(stamp) : stamp(values),
              conflict && conflict !== 'id' && !conflict.split(',').includes('marketplace_account_id')
                ? { ...options, onConflict: `${conflict},marketplace_account_id` } : options)
          }
          const v = builder[method]; return typeof v === 'function' ? v.bind(builder) : v
        } })
      }
    },
  })
}
