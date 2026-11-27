/** The account-scoped client injects the verified server account into this RPC. */
export async function upsertMarketplaceProducts(admin: any, merchantCode: string, rows: any[]) {
  const products = new Map<string, string>()
  for (let index = 0; index < rows.length; index += 100) {
    const { data, error } = await admin.rpc('upsert_marketplace_products', { p_merchant_code: merchantCode, p_rows: rows.slice(index, index + 100) })
    if (error) throw error
    for (const row of data || []) if (row.product_id) products.set(row.source_sku, row.product_id)
  }
  return products
}
