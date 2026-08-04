import type { ActionPriority } from './merchantActions'

export type OpportunityConfidence = 'high' | 'medium' | 'low'
export type OpportunityKind = 'costs' | 'profitability' | 'inventory' | 'marketing' | 'cash'

export type OpportunityProfitabilityRow = {
  cost_price: number | null
  units_sold: number | null
  net_profit: number | null
  returns_amount: number | null
}

export type OpportunityInventoryRow = {
  health_status: string | null
  daily_velocity: number | null
  sold_30d: number | null
  data_age_days: number | null
}

export type OpportunityAdRow = {
  platform: string
  total_spend: number | null
  total_net: number | null
  net_roas: number | null
}

export type OpportunityCashRow = {
  month: string
  net: number
}

export type MerchantOpportunity = {
  sourceKey: string
  kind: OpportunityKind
  priority: ActionPriority
  priorityLabel: string
  title: string
  detail: string
  evidence: string
  confidence: OpportunityConfidence
  value?: number
  valueLabel?: string
  valueUnit?: 'currency' | 'units'
  impact: string
  cta: string
  path: string
  category: string
}

export type MerchantOpportunityInput = {
  profitability: OpportunityProfitabilityRow[]
  inventory: OpportunityInventoryRow[]
  ads: OpportunityAdRow[]
  latestCash?: OpportunityCashRow | null
  platformLabel?: (platform: string) => string
}

const PRIORITY_RANK: Record<ActionPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const latin = (value: number) => value.toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 1 })

function finite(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

/**
 * Builds evidence-backed merchant opportunities. Monetary values are only
 * emitted when the source rows support a direct calculation; otherwise the
 * opportunity remains an operational or data-quality action.
 */
export function buildMerchantOpportunities(input: MerchantOpportunityInput): MerchantOpportunity[] {
  const opportunities: MerchantOpportunity[] = []
  const soldProducts = input.profitability.filter(row => finite(row.units_sold) > 0)
  const costedProducts = input.profitability.filter(row => finite(row.cost_price) > 0)
  const costCoverage = input.profitability.length
    ? costedProducts.length / input.profitability.length * 100
    : 0

  if (input.profitability.length > 0 && costCoverage < 100) {
    const missing = input.profitability.length - costedProducts.length
    const priority: ActionPriority = costCoverage < 80 ? 'urgent' : 'high'
    opportunities.push({
      sourceKey: 'cost_coverage', kind: 'costs', priority,
      priorityLabel: costCoverage < 80 ? 'يمنع اعتماد الربحية' : 'استكمال مهم',
      title: `أكمل تكلفة الشراء لعدد ${latin(missing)} من المنتجات`,
      detail: 'لن يعرض النظام صافي ربح موثوقًا للمنتجات الناقصة، ولن يقترح زيادة الإعلان عليها.',
      evidence: `تغطية التكاليف ${latin(costCoverage)}%`, confidence: 'high',
      impact: 'فتح قرارات الربحية الحقيقية', cta: 'استكمال التكاليف', path: '/products?costs=import',
      category: 'profitability',
    })
  }

  const confirmedLosses = soldProducts.filter(row => finite(row.cost_price) > 0 && finite(row.net_profit) < 0)
  if (confirmedLosses.length > 0) {
    const lossValue = confirmedLosses.reduce((sum, row) => sum + Math.abs(finite(row.net_profit)), 0)
    opportunities.push({
      sourceKey: 'confirmed_costed_product_losses', kind: 'profitability', priority: 'urgent',
      priorityLabel: 'خسارة صافية محسوبة',
      title: `منتجات مباعة بخسارة صافية: ${latin(confirmedLosses.length)}`,
      detail: 'القيمة تشمل تكلفة الشراء والرسوم والإنفاق والمرتجعات المسجلة في ربحية المنتج.',
      evidence: 'تكلفة الشراء متوفرة لهذه المنتجات', confidence: 'high',
      value: lossValue, valueLabel: 'الخسارة المسجلة', valueUnit: 'currency',
      impact: 'إيقاف تسرب ربحي مثبت', cta: 'فحص المنتجات', path: '/products?profit=loss',
      category: 'profitability',
    })
  }

  const inventoryAge = input.inventory.reduce((oldest, row) => row.data_age_days == null
    ? oldest
    : Math.max(oldest, finite(row.data_age_days)), 0)
  const velocityCovered = input.inventory.filter(row => finite(row.daily_velocity) > 0 || finite(row.sold_30d) > 0)
  const demandStockouts = input.inventory.filter(row => row.health_status === 'out_of_stock'
    && (finite(row.sold_30d) > 0 || finite(row.daily_velocity) > 0))

  if (input.inventory.length > 0 && velocityCovered.length === 0) {
    opportunities.push({
      sourceKey: 'inventory_velocity_missing', kind: 'inventory', priority: 'high',
      priorityLabel: 'دليل الطلب ناقص', title: 'لا تعتمد إعادة الشراء قبل احتساب سرعة البيع',
      detail: 'المخزون موجود، لكن لا توجد حركة طلب كافية لتحديد ما يستحق إعادة التوريد.',
      evidence: `${latin(input.inventory.length)} صنفًا بلا سرعة بيع`, confidence: 'high',
      impact: 'منع شراء مخزون راكد', cta: 'مراجعة المخزون', path: '/inventory', category: 'inventory',
    })
  } else if (inventoryAge > 2) {
    opportunities.push({
      sourceKey: 'inventory_data_stale', kind: 'inventory', priority: 'high',
      priorityLabel: 'تحديث مطلوب', title: `حدّث المخزون المتأخر ${latin(inventoryAge)} يومًا`,
      detail: 'أوقفنا عرض فرصة إعادة التوريد كقرار حالي لأن آخر بيانات المخزون أقدم من يومين.',
      evidence: `عمر أقدم سجل ${latin(inventoryAge)} يومًا`, confidence: 'high',
      impact: 'منع قرار شراء مبني على رصيد قديم', cta: 'تحديث البيانات', path: '/integrations', category: 'data_quality',
    })
  } else if (demandStockouts.length > 0) {
    const demandUnits = demandStockouts.reduce((sum, row) => sum + finite(row.sold_30d), 0)
    opportunities.push({
      sourceKey: 'stockout_with_recent_demand', kind: 'inventory', priority: 'high',
      priorityLabel: 'طلب تاريخي معرّض', title: `أصناف نافدة ولها طلب سابق: ${latin(demandStockouts.length)}`,
      detail: 'هذه ليست مبيعات مضمونة؛ إنها وحدات بيعت خلال آخر 30 يومًا ويمكن استخدامها لترتيب مراجعة التوريد.',
      evidence: 'مخزون محدث وحركة بيع متاحة', confidence: 'medium',
      value: demandUnits, valueLabel: 'طلب آخر 30 يومًا', valueUnit: 'units',
      impact: 'استعادة توفر الأصناف الأعلى طلبًا', cta: 'ترتيب إعادة التوريد', path: '/inventory?status=out_of_stock',
      category: 'inventory',
    })
  }

  const inefficientAds = input.ads.filter(row => finite(row.total_spend) > 0
    && row.net_roas != null && finite(row.net_roas) < 1)
  if (inefficientAds.length > 0) {
    const spend = inefficientAds.reduce((sum, row) => sum + finite(row.total_spend), 0)
    const net = inefficientAds.reduce((sum, row) => sum + finite(row.total_net), 0)
    opportunities.push({
      sourceKey: `ad_return_below_one:${inefficientAds.map(row => row.platform).sort().join(',')}`,
      kind: 'marketing', priority: 'high', priorityLabel: 'عائد أقل من 1×',
      title: `قنوات إعلانية تحتاج مراجعة: ${latin(inefficientAds.length)}`,
      detail: 'الإيراد الصافي المتاح أقل من الإنفاق الإعلاني، قبل احتساب تكلفة المنتج؛ لا ترفع الميزانية قبل المراجعة.',
      evidence: `${latin(spend)} ر.س إنفاق مقابل ${latin(net)} ر.س إيراد صافي`, confidence: 'medium',
      value: Math.max(0, spend - net), valueLabel: 'فجوة الإنفاق والإيراد', valueUnit: 'currency',
      impact: 'تقليل إنفاق غير مسترد بالإيراد', cta: 'تحليل الإعلانات', path: '/marketing', category: 'marketing',
    })
  } else {
    const eligible = input.ads.filter(row => finite(row.total_spend) > 0 && finite(row.net_roas) >= 2)
      .sort((a, b) => finite(b.net_roas) - finite(a.net_roas))
    const best = eligible[0]
    if (best) {
      const label = input.platformLabel?.(best.platform) || best.platform
      opportunities.push({
        sourceKey: `controlled_ad_test:${best.platform}`, kind: 'marketing', priority: 'medium',
        priorityLabel: 'اختبار نمو مضبوط', title: `${label} مرشح لاختبار ميزانية محدود`,
        detail: 'اختبر زيادة صغيرة ثم قارن العائد الصافي؛ المؤشر الحالي يسبق تكلفة المنتج ولا يبرر توسعًا مفتوحًا.',
        evidence: `عائد صافي ${finite(best.net_roas).toFixed(2)}× قبل تكلفة المنتج`, confidence: 'medium',
        impact: 'اختبار نمو مع حد خسارة واضح', cta: 'فتح أداء الإعلانات', path: '/marketing', category: 'marketing',
      })
    }
  }

  if (input.latestCash && finite(input.latestCash.net) < 0) {
    opportunities.push({
      sourceKey: `negative_cashflow:${input.latestCash.month}`, kind: 'cash', priority: 'high',
      priorityLabel: 'ضغط نقدي', title: 'التدفق النقدي الأخير سالب',
      detail: 'الخروج النقدي المسجل تجاوز الدخول في آخر شهر متاح؛ راجع التحويلات والاستقطاعات قبل التزامات شراء جديدة.',
      evidence: `الفترة ${input.latestCash.month}`, confidence: 'high',
      value: Math.abs(finite(input.latestCash.net)), valueLabel: 'العجز النقدي', valueUnit: 'currency',
      impact: 'حماية السيولة قبل إعادة الشراء', cta: 'مراجعة الحركة المالية', path: '/statement', category: 'finance',
    })
  }

  return opportunities
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      || finite(b.value) - finite(a.value)
      || a.sourceKey.localeCompare(b.sourceKey))
    .slice(0, 5)
}
