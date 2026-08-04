export type FinancialTransactionCategory = 'sale' | 'return' | 'discount' | 'commission' | 'payment' | 'invoice' | 'adjustment' | 'other'

type TransactionMeta = { label: string; category: FinancialTransactionCategory }

const META: Record<string, TransactionMeta> = {
  sale: { label: 'مبيعات', category: 'sale' },
  'satış': { label: 'مبيعات', category: 'sale' },
  satis: { label: 'مبيعات', category: 'sale' },
  return: { label: 'مرتجعات', category: 'return' },
  'iade': { label: 'مرتجعات', category: 'return' },
  discount: { label: 'خصم على الطلب', category: 'discount' },
  discountcancel: { label: 'إلغاء خصم', category: 'discount' },
  'indirim': { label: 'خصم على الطلب', category: 'discount' },
  coupon: { label: 'كوبون', category: 'discount' },
  couponcancel: { label: 'إلغاء كوبون', category: 'discount' },
  kupon: { label: 'كوبون', category: 'discount' },
  provisionpositive: { label: 'تسوية موجبة', category: 'adjustment' },
  provisionnegative: { label: 'تسوية سالبة', category: 'adjustment' },
  manuelrefund: { label: 'استرداد جزئي', category: 'return' },
  manualrefund: { label: 'استرداد جزئي', category: 'return' },
  manualrefundcancel: { label: 'إلغاء استرداد جزئي', category: 'return' },
  tydiscount: { label: 'خصم ممول من Trendyol', category: 'discount' },
  tydiscountcancel: { label: 'إلغاء خصم ممول من Trendyol', category: 'discount' },
  tycoupon: { label: 'كوبون ممول من Trendyol', category: 'discount' },
  tycouponcancel: { label: 'إلغاء كوبون ممول من Trendyol', category: 'discount' },
  sellerrevenuepositive: { label: 'تصحيح مستحقات موجب', category: 'adjustment' },
  sellerrevenuenegative: { label: 'تصحيح مستحقات سالب', category: 'adjustment' },
  sellerrevenuepositivecancel: { label: 'إلغاء تصحيح مستحقات موجب', category: 'adjustment' },
  sellerrevenuenegativecancel: { label: 'إلغاء تصحيح مستحقات سالب', category: 'adjustment' },
  commissionpositive: { label: 'تصحيح عمولة موجب', category: 'commission' },
  commissionnegative: { label: 'تصحيح عمولة سالب', category: 'commission' },
  commissionpositivecancel: { label: 'إلغاء تصحيح عمولة موجب', category: 'commission' },
  commissionnegativecancel: { label: 'إلغاء تصحيح عمولة سالب', category: 'commission' },
  stoppage: { label: 'ضريبة مستقطعة', category: 'adjustment' },
  cashadvance: { label: 'دفعة مبكرة', category: 'payment' },
  wiretransfer: { label: 'تحويل بنكي', category: 'payment' },
  incomingtransfer: { label: 'تحويل وارد إلى Trendyol', category: 'payment' },
  returninvoice: { label: 'فاتورة مرتجع', category: 'invoice' },
  commissionagreementinvoice: { label: 'فاتورة تسوية عمولة', category: 'invoice' },
  paymentorder: { label: 'دفعة مستحقات', category: 'payment' },
  'ödeme': { label: 'دفعة مستحقات', category: 'payment' },
  odeme: { label: 'دفعة مستحقات', category: 'payment' },
  deductioninvoices: { label: 'فاتورة استقطاعات وخدمات', category: 'invoice' },
  financialitem: { label: 'تصحيح مالي', category: 'adjustment' },
}

function normalized(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[\s_-]+/g, '')
}

export function financialTransactionMeta(value: unknown): TransactionMeta {
  const key = normalized(value)
  if (META[key]) return META[key]
  if (key.includes('commission') || key.includes('komisyon')) return { label: 'عمولة أو تصحيح عمولة', category: 'commission' }
  if (key.includes('invoice') || key.includes('fatura')) return { label: 'فاتورة أو استقطاع', category: 'invoice' }
  if (key.includes('return') || key.includes('refund') || key.includes('iade')) return { label: 'مرتجع أو استرداد', category: 'return' }
  if (key.includes('discount') || key.includes('coupon') || key.includes('indirim') || key.includes('kupon')) return { label: 'خصم أو كوبون', category: 'discount' }
  return { label: String(value || 'حركة مالية'), category: 'other' }
}
