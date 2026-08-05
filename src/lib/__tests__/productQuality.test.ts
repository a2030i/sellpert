import { describe, expect, it } from 'vitest'
import { productDataQuality } from '../productQuality'

describe('productDataQuality', () => {
  it('marks a commercially and editorially complete product as complete', () => {
    expect(productDataQuality({
      name: 'قهوة', sku: 'SKU-1', category: 'مشروبات', description: 'قهوة محمصة',
      image_url: 'https://example.test/image.jpg', cost_price: 20, target_net_price: 40,
    })).toMatchObject({ score: 100, complete: true, missing: [], label: 'مكتمل' })
  })

  it('lists merchant-friendly missing data and separates content gaps', () => {
    const quality = productDataQuality({ name: 'قهوة', sku: 'SKU-1', cost_price: 0, target_net_price: 40 })
    expect(quality.missing).toEqual(['التصنيف', 'الوصف', 'الصورة', 'التكلفة'])
    expect(quality).toMatchObject({ score: 43, complete: false, missingContent: true, label: 'ينقص 4' })
  })
})
