import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('merchant product self-service', () => {
  const products = readFileSync('src/pages/Products.tsx', 'utf8')
  const detail = readFileSync('src/pages/ProductDetail.tsx', 'utf8')

  it('does not send product changes back to an internal team', () => {
    expect(products).not.toContain("from('merchant_requests')")
    expect(products).not.toContain('إرسال للفريق')
    expect(products).not.toContain('طلب تعديل')
    expect(products).toContain('إدارة المنتج')
  })

  it('scopes product reads and writes to the active merchant', () => {
    expect(products).toContain(".eq('id', editProduct.id).eq('merchant_code', merchant!.merchant_code)")
    expect(detail).toContain("from('products').select(PRODUCT_SAFE_COLUMNS).eq('merchant_code', merchantCode).eq('id', productId)")
    expect(detail).toContain("from('product_profitability').select('*').eq('merchant_code', merchantCode).eq('product_id', productId)")
  })

  it('does not present a profit margin when product cost is missing', () => {
    expect(products).toContain("prod.cost_price > 0 ? `هامش:")
    expect(products).toContain("'الربحية غير مكتملة'")
    expect(products).toContain("'غير مكتملة'")
  })

  it('surfaces product load and derived-price failures', () => {
    expect(products).toContain("setLoadError(userErrorMessage(error, 'تعذّر تحميل المنتجات الآن.'))")
    expect(products).toContain('لكن تعذرت إعادة حساب أسعار المنصة')
  })
})
