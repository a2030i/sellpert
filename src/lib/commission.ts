export type FeeCategory = {
  platform: string
  category_key: string
  commission_rate: number
  commission_fbn_fba?: number | null
  min_fee_sar?: number | null
}

const CATEGORY_RULES: Array<[string, RegExp]> = [
  ['grocery', /(food|beverage|grocery|spice|coffee|tea|herb|seed|salt|pepper|بقال|غذ|طعام|توابل|بهارات|قهوة|شاي|أعشاب|اعشاب|بذور|ملح|فلفل|نباتات)/i],
  ['health', /(health|nutrition|supplement|medical|صحة|تغذية|مكمل|طبي)/i],
  ['beauty', /(beauty|personal.?care|عناية|تجميل)/i],
  ['home', /(home|decor|منزل|ديكور)/i],
  ['kitchen', /(kitchen|مطبخ)/i],
  ['mobile_tablets', /(mobile|tablet|جوال|هاتف|لوحي)/i],
  ['electronics', /(electronic|إلكترون)/i],
  ['laptops', /(laptop|computer|حاسب|كمبيوتر|لاب.?توب)/i],
  ['apparel_kids', /(kids?.?apparel|ملابس أطفال)/i],
  ['apparel_women', /(women.?apparel|ملابس نسائية)/i],
  ['apparel_men', /(men.?apparel|ملابس رجالية)/i],
  ['shoes', /(shoe|footwear|أحذية)/i],
  ['bags', /(bag|luggage|حقائب)/i],
  ['sports', /(sport|رياض)/i],
  ['toys', /(toy|baby|ألعاب)/i],
  ['books', /(book|كتب)/i],
  ['office', /(office|مكتب)/i],
  ['automotive', /(automotive|سيارات)/i],
  ['jewelry', /(jewel|مجوهر)/i],
  ['watches', /(watch|ساعات)/i],
  ['furniture', /(furniture|أثاث)/i],
]

export function normalizeFeeCategory(category?: string | null): string | null {
  const value = String(category || '').trim().toLocaleLowerCase('en-US').replace(/[\s-]+/g, '_')
  if (!value) return null
  for (const [key, matcher] of CATEGORY_RULES) if (matcher.test(value)) return key
  return value
}

export function categoryCommission(categories: FeeCategory[], platform: string, productCategory?: string | null, fulfillmentModel?: string | null) {
  const normalizedKey = normalizeFeeCategory(productCategory)
  if (!normalizedKey) return null
  const categoryKey = platform === 'amazon' && normalizedKey === 'electronics'
    ? 'electronics_consumer'
    : platform === 'amazon' && normalizedKey === 'laptops'
      ? 'computers'
      : normalizedKey
  const category = categories.find(row => row.platform === platform && row.category_key === categoryKey)
  if (!category) return null
  const usesFulfilledModel = /^(fba|fbn)$/i.test(String(fulfillmentModel || ''))
  const rate = usesFulfilledModel && category.commission_fbn_fba != null
    ? Number(category.commission_fbn_fba)
    : Number(category.commission_rate)
  return { rate, categoryKey, source: 'category' as const, minFee: Number(category.min_fee_sar || 0) }
}

export function commissionAmount(amount: number, rate: number, vatRate = 15, minimumFee = 0) {
  const baseCommission = Math.max(Number(amount || 0) * Number(rate || 0) / 100, Number(minimumFee || 0))
  return baseCommission * (1 + Number(vatRate || 0) / 100)
}
