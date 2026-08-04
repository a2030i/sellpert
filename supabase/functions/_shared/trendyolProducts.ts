export type TrendyolProductSyncRows = {
  products: Record<string, unknown>[]
  inventory: Record<string, unknown>[]
  approvedVariants: number
  unapprovedVariants: number
}

type TrendyolCreateAttribute = {
  attributeId?: unknown
  attributeValueIds?: unknown
  attributeValue?: unknown
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`${label} مطلوب`)
  if (text.length > maxLength) throw new Error(`${label} يجب ألا يتجاوز ${maxLength.toLocaleString('en-US')} حرفًا`)
  return text
}

function positiveInteger(value: unknown, label: string) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} غير صالح`)
  return number
}

/**
 * Normalizes the public merchant form into Trendyol Product Create V2's
 * fixed schema. Unknown keys are deliberately discarded at the trust boundary.
 */
export function normalizeTrendyolProductCreateV2(payload: unknown) {
  const items = (payload as { items?: unknown } | null)?.items
  if (!Array.isArray(items) || items.length < 1 || items.length > 1000) {
    throw new Error('أرسل من 1 إلى 1,000 منتج في كل طلب نشر')
  }

  return {
    items: items.map((raw: unknown) => {
      const item = raw as Record<string, any> | null
      const barcode = requiredText(item?.barcode, 'باركود المنتج', 40)
      if (!/^[\p{L}\p{N}._-]+$/u.test(barcode)) {
        throw new Error('الباركود يقبل الحروف والأرقام والرموز . و- و_ فقط، دون مسافات')
      }
      const quantity = Number(item?.quantity)
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20000) {
        throw new Error('المخزون يجب أن يكون عددًا صحيحًا بين 0 و20,000')
      }
      const listPrice = Number(item?.listPrice)
      const salePrice = Number(item?.salePrice)
      if (!Number.isFinite(salePrice) || salePrice < 0 || !Number.isFinite(listPrice) || listPrice < salePrice) {
        throw new Error('السعر قبل الخصم يجب ألا يقل عن سعر البيع')
      }
      const vatRate = Number(item?.vatRate)
      if (!Number.isInteger(vatRate) || ![0, 1, 10, 20].includes(vatRate)) {
        throw new Error('اختر نسبة ضريبة صحيحة: 0% أو 1% أو 10% أو 20%')
      }

      const images = item?.images
      if (!Array.isArray(images) || images.length < 1 || images.length > 8) {
        throw new Error('أضف من صورة واحدة إلى 8 صور للمنتج')
      }
      const normalizedImages = images.map((image: any) => {
        const url = String(image?.url ?? image ?? '').trim()
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'https:') throw new Error('not https')
        } catch {
          throw new Error('صور Trendyol يجب أن تكون روابط HTTPS مباشرة وصالحة')
        }
        return { url }
      })

      const attributes = item?.attributes
      if (!Array.isArray(attributes)) throw new Error('خصائص الفئة مطلوبة')
      const normalizedAttributes = attributes.map((rawAttribute: TrendyolCreateAttribute) => {
        const attributeId = positiveInteger(rawAttribute?.attributeId, 'خاصية الفئة')
        const valueIds = Array.isArray(rawAttribute?.attributeValueIds)
          ? [...new Set(rawAttribute.attributeValueIds.map(value => positiveInteger(value, 'قيمة الخاصية')))]
          : []
        const attributeValue = String(rawAttribute?.attributeValue ?? '').trim()
        if (!valueIds.length && !attributeValue) throw new Error('اختر قيمة لكل خاصية مضافة')
        if (valueIds.length && attributeValue) throw new Error('لا تجمع بين قيمة جاهزة وقيمة مخصصة للخاصية نفسها')
        return valueIds.length ? { attributeId, attributeValueIds:valueIds } : { attributeId, attributeValue }
      })

      const normalized: Record<string, unknown> = {
        barcode,
        title:requiredText(item?.title, 'اسم المنتج', 100),
        productMainId:requiredText(item?.productMainId, 'رمز الموديل', 40),
        brandId:positiveInteger(item?.brandId, 'العلامة التجارية'),
        categoryId:positiveInteger(item?.categoryId, 'الفئة'),
        quantity,
        stockCode:requiredText(item?.stockCode, 'رمز المخزون', 100),
        description:requiredText(item?.description, 'وصف المنتج', 30000),
        listPrice,
        salePrice,
        vatRate,
        images:normalizedImages,
        attributes:normalizedAttributes,
      }

      if (item?.dimensionalWeight !== undefined && item.dimensionalWeight !== '') {
        const value = Number(item.dimensionalWeight)
        if (!Number.isFinite(value) || value < 0) throw new Error('الوزن الحجمي غير صالح')
        normalized.dimensionalWeight = value
      }
      if (item?.origin) {
        const origin = String(item.origin).trim().toUpperCase()
        if (!/^[A-Z]{2}$/.test(origin)) throw new Error('بلد المنشأ يجب أن يكون رمزًا من حرفين')
        normalized.origin = origin
      }
      if (item?.lotNumber) normalized.lotNumber = requiredText(item.lotNumber, 'رقم الدفعة أو التشغيلة', 100)
      if (item?.shipmentAddressId) normalized.shipmentAddressId = positiveInteger(item.shipmentAddressId, 'عنوان الشحن')
      if (item?.returningAddressId) normalized.returningAddressId = positiveInteger(item.returningAddressId, 'عنوان الإرجاع')
      if (item?.deliveryOption) {
        const duration = Number(item.deliveryOption.deliveryDuration)
        const fastDeliveryType = String(item.deliveryOption.fastDeliveryType || '').trim().toUpperCase()
        if (!Number.isInteger(duration) || duration < 0 || duration > 30) throw new Error('مدة التجهيز يجب أن تكون بين 0 و30 يومًا')
        if (fastDeliveryType && !['FAST_DELIVERY', 'SAME_DAY_SHIPPING'].includes(fastDeliveryType)) throw new Error('خيار التوصيل السريع غير صالح')
        if (fastDeliveryType && duration !== 1) throw new Error('يتطلب التوصيل السريع مدة تجهيز يوم واحد')
        normalized.deliveryOption = { deliveryDuration:duration, ...(fastDeliveryType ? { fastDeliveryType } : {}) }
      }
      return normalized
    }),
  }
}

export function normalizeTrendyolDeliveryUpdate(payload: unknown) {
  const items = (payload as { items?: unknown } | null)?.items
  if (!Array.isArray(items) || items.length < 1 || items.length > 1000) {
    throw new Error('أرسل من 1 إلى 1,000 منتج في كل تحديث للتوصيل')
  }
  return {
    items: items.map((value: unknown) => {
      const item = value as { barcode?: unknown; deliveryOptions?: { deliveryDuration?: unknown; fastDeliveryType?: unknown } } | null
      const barcode = String(item?.barcode || '').trim()
      const deliveryDuration = Number(item?.deliveryOptions?.deliveryDuration)
      const requestedType = item?.deliveryOptions?.fastDeliveryType
      const fastDeliveryType = requestedType === null || requestedType === undefined || requestedType === ''
        ? null
        : String(requestedType).trim().toUpperCase()
      if (!barcode) throw new Error('باركود المنتج مطلوب لتحديث التوصيل')
      if (!Number.isInteger(deliveryDuration) || deliveryDuration < 0 || deliveryDuration > 30) {
        throw new Error('مدة تجهيز المنتج يجب أن تكون عددًا صحيحًا بين 0 و30 يومًا')
      }
      if (fastDeliveryType !== null && !['FAST_DELIVERY', 'SAME_DAY_SHIPPING'].includes(fastDeliveryType)) {
        throw new Error('خيار التوصيل السريع غير صالح')
      }
      if (fastDeliveryType !== null && deliveryDuration !== 1) {
        throw new Error('يتطلب التوصيل السريع مدة تجهيز يوم واحد')
      }
      return { barcode, deliveryOptions: { deliveryDuration, fastDeliveryType } }
    }),
  }
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
