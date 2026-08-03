import { describe, expect, it } from 'vitest'
import {
  deliveryStatusLabel,
  friendlyDeliveryError,
  getProductContentChanges,
  productActionLabel,
  productActionMatches,
  shortDeliveryReference,
} from '../productDelivery'

describe('product delivery lifecycle', () => {
  it('does not report unchanged normalized content', () => {
    expect(getProductContentChanges(
      { title: 'قهوة عربية', description: 'وصف المنتج', images: ['https://img/1.jpg'] },
      { title: ' قهوة  عربية ', description: 'وصف المنتج ', images: ['https://img/1.jpg'] },
    )).toEqual([])
  })

  it('returns merchant-readable before and after changes', () => {
    const changes = getProductContentChanges(
      { title: 'العنوان السابق', description: 'الوصف السابق', images: ['one'] },
      { title: 'العنوان الجديد', description: 'الوصف الجديد', images: ['one', 'two'] },
    )
    expect(changes.map(change => change.field)).toEqual(['title', 'description', 'images'])
    expect(changes[2]).toMatchObject({ before: 'صورة واحدة', after: 'صورتان' })
  })

  it('matches logs by Trendyol content id or barcode only', () => {
    const product = { external_id: 1234, barcode: 'ABC-1', raw: { contentId: 5678 } }
    expect(productActionMatches({ request: { payload: { items: [{ contentId: 5678 }] } } }, product)).toBe(true)
    expect(productActionMatches({ request: { payload: { items: [{ barcode: 'ABC-1' }] } } }, product)).toBe(true)
    expect(productActionMatches({ request: { payload: { items: [{ contentId: 9999, barcode: 'OTHER' }] } } }, product)).toBe(false)
  })

  it('uses clear status and action labels without exposing internal values', () => {
    expect(deliveryStatusLabel('processing')).toBe('قيد مراجعة Trendyol')
    expect(deliveryStatusLabel('failed')).toBe('رفض Trendyol التعديل')
    expect(productActionLabel('products.price_inventory')).toBe('تحديث السعر والمخزون')
  })

  it('creates a short support reference and hides object-shaped errors', () => {
    expect(shortDeliveryReference('4f77b664-4f5a-43c6-9ca4-7710c1a2385e')).toBe('TY-C1A2385E')
    expect(friendlyDeliveryError('[object Object]')).not.toContain('Object')
    expect(friendlyDeliveryError('HTTP 500 postgres function failed')).not.toContain('postgres')
    expect(friendlyDeliveryError('Unauthorized 401')).toContain('بيانات الدخول')
  })
})
