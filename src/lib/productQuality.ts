export type ProductQualityInput = {
  name?: string | null
  sku?: string | null
  barcode?: string | null
  category?: string | null
  description?: string | null
  image_url?: string | null
  images?: Array<{ url?: string } | string> | null
  cost_price?: number | null
  target_net_price?: number | null
  sale_price?: number | null
}

export type ProductQuality = {
  score: number
  complete: boolean
  missing: string[]
  missingContent: boolean
  label: string
  tone: 'success' | 'warning' | 'danger'
}

function hasText(value?: string | null) {
  return Boolean(String(value || '').trim())
}

export function productDataQuality(product: ProductQualityInput): ProductQuality {
  const hasImage = hasText(product.image_url) || Boolean(product.images?.some(image =>
    hasText(typeof image === 'string' ? image : image?.url),
  ))
  const checks = [
    { ok: hasText(product.name), label: 'اسم المنتج', content: false },
    { ok: hasText(product.sku) || hasText(product.barcode), label: 'رمز SKU أو الباركود', content: false },
    { ok: hasText(product.category), label: 'التصنيف', content: true },
    { ok: hasText(product.description), label: 'الوصف', content: true },
    { ok: hasImage, label: 'الصورة', content: true },
    { ok: Number(product.cost_price || 0) > 0, label: 'التكلفة', content: false },
    { ok: Number(product.target_net_price || product.sale_price || 0) > 0, label: 'سعر البيع المستهدف', content: false },
  ]
  const missingChecks = checks.filter(check => !check.ok)
  const score = Math.round((checks.length - missingChecks.length) / checks.length * 100)
  const complete = missingChecks.length === 0
  return {
    score,
    complete,
    missing: missingChecks.map(check => check.label),
    missingContent: missingChecks.some(check => check.content),
    label: complete ? 'مكتمل' : `ينقص ${missingChecks.length}`,
    tone: complete ? 'success' : score >= 70 ? 'warning' : 'danger',
  }
}
