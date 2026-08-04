export type TrendyolProductSyncRows = {
  products: Record<string, unknown>[]
  inventory: Record<string, unknown>[]
  approvedVariants: number
  unapprovedVariants: number
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function imageList(item: any) {
  const value = Array.isArray(item?.images) ? item.images : Array.isArray(item?.media) ? item.media : []
  return value.filter((image: any) => typeof image?.url === 'string' && image.url.trim())
}

function rejectionText(item: any) {
  if (!Array.isArray(item?.rejectReasonDetails)) return null
  const messages = item.rejectReasonDetails.flatMap((reason: any) => [reason?.rejectReason, reason?.rejectReasonDetail])
    .filter((value: unknown) => typeof value === 'string' && value.trim())
  return messages.length ? messages.join(' — ').slice(0, 4000) : null
}

/**
 * Flattens Product V2 content/variant responses into Sellpert's per-SKU model.
 * Approved rows intentionally override a duplicate unapproved barcode.
 */
export function normalizeTrendyolV2Products(
  merchantCode: string,
  approvedContent: any[],
  unapprovedContent: any[],
  syncedAt: string,
): TrendyolProductSyncRows {
  const variants: Array<{ item: any; variant: any; approved: boolean }> = []

  for (const item of unapprovedContent) {
    variants.push({ item, variant: item, approved: false })
  }
  for (const item of approvedContent) {
    const itemVariants = Array.isArray(item?.variants) ? item.variants : []
    for (const variant of itemVariants) variants.push({ item, variant, approved: true })
  }

  const products = new Map<string, Record<string, unknown>>()
  const inventory = new Map<string, Record<string, unknown>>()
  let approvedVariants = 0
  let unapprovedVariants = 0

  for (const { item, variant, approved } of variants) {
    const sku = String(variant?.stockCode || variant?.merchantSku || variant?.barcode || variant?.variantId || '').trim()
    if (!sku) continue
    const barcode = String(variant?.barcode || item?.barcode || '').trim() || null
    const images = imageList(item)
    const stock = approved ? numberValue(variant?.stock?.quantity ?? variant?.quantity) : numberValue(item?.quantity)
    const salePrice = approved ? numberValue(variant?.price?.salePrice ?? variant?.salePrice) : numberValue(item?.salePrice)
    const listPrice = approved ? numberValue(variant?.price?.listPrice ?? variant?.listPrice) : numberValue(item?.listPrice)
    const rejection = approved ? null : rejectionText(item)
    const providerStatus = approved ? (variant?.onSale ? 'onSale' : variant?.archived ? 'archived' : 'notOnSale') : String(item?.status || 'pendingApproval')

    products.set(sku, {
      merchant_code: merchantCode,
      name: item?.title || item?.productName || sku,
      sku,
      barcode,
      category: item?.category?.name || item?.categoryName || null,
      description: item?.description || null,
      image_url: images[0]?.url || null,
      images: images.length ? images : null,
      cost_price: 0,
      target_net_price: salePrice,
      sale_price: salePrice,
      msrp: listPrice || null,
      status: approved && !variant?.archived && !variant?.blacklisted ? 'active' : 'inactive',
      brand: item?.brand?.name || item?.brandName || item?.brand || null,
      external_id: String(item?.contentId || item?.id || '') || null,
      model_code: item?.productMainId || item?.modelCode || null,
      vat_rate: numberValue(variant?.vatRate ?? item?.vatRate),
      commission_rate: numberValue(variant?.commission ?? variant?.commissionRate ?? item?.commissionRate),
      supplier_sku: variant?.stockCode || item?.stockCode || null,
      platform_source: 'trendyol_api_v2',
      raw: { ...item, selectedVariant: variant, approvalStatus: providerStatus, rejection },
      last_synced_at: syncedAt,
    })

    inventory.set(sku, {
      merchant_code: merchantCode,
      platform: 'trendyol',
      sku,
      product_name: item?.title || item?.productName || null,
      quantity: Math.max(0, Math.trunc(stock)),
      reserved_quantity: 0,
      low_stock_threshold: 5,
      cost_price: null,
      image_url: images[0]?.url || null,
      is_active: approved && !variant?.archived && !variant?.blacklisted,
      last_updated: syncedAt,
      raw: { contentId: item?.contentId || null, variant, approvalStatus: providerStatus, rejection },
    })

    if (approved) approvedVariants++
    else unapprovedVariants++
  }

  return {
    products: [...products.values()],
    inventory: [...inventory.values()],
    approvedVariants,
    unapprovedVariants,
  }
}

