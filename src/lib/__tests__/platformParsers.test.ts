import { describe, it, expect } from 'vitest'
import { n, s, xlsxDate, xlsxDateOnly, detectFileKind, parseNoonSales } from '../platformParsers'

describe('n (تحويل رقمي متسامح)', () => {
  it('يحلل الأرقام داخل نصوص بعملات وفواصل', () => {
    expect(n('1234.56')).toBe(1234.56)
    expect(n('SAR 99')).toBe(99)
    expect(n('-15.5')).toBe(-15.5)
  })
  it('يرجع 0 للقيم الفارغة وغير الرقمية', () => {
    expect(n('')).toBe(0)
    expect(n(null)).toBe(0)
    expect(n(undefined)).toBe(0)
    expect(n('abc')).toBe(0)
  })
})

describe('s (تنظيف نصي)', () => {
  it('يقص الفراغات ويحول أي قيمة لنص', () => {
    expect(s('  hello ')).toBe('hello')
    expect(s(5)).toBe('5')
    expect(s(null)).toBe('')
  })
})

describe('xlsxDate (تواريخ Excel والصيغ العربية)', () => {
  it('يحول الرقم التسلسلي لإكسل إلى ISO', () => {
    // 45292 = 2024-01-01 في تقويم Excel
    expect(xlsxDate(45292)).toMatch(/^2024-01-01T/)
  })
  it('يفسر dd/mm/yyyy بأولوية اليوم أولاً (وليس الصيغة الأمريكية)', () => {
    expect(xlsxDate('05/03/2026')).toMatch(/^2026-03-05T/)
  })
  it('يقبل ISO كما هي', () => {
    expect(xlsxDate('2026-04-26')).toMatch(/^2026-04-2[56]T/)
  })
  it('يرجع null لقيمة غير مفهومة', () => {
    expect(xlsxDate('not a date')).toBeNull()
    expect(xlsxDate('')).toBeNull()
  })
  it('xlsxDateOnly يرجع التاريخ فقط', () => {
    expect(xlsxDateOnly('05/03/2026')).toBe('2026-03-05')
  })
})

describe('detectFileKind (كشف نوع ملف CSV)', () => {
  it('يكشف مبيعات نون', () => {
    const kind = detectFileKind({
      name: 'sales.csv', isCsv: true,
      csvText: 'id_partner,item_nr,gmv_lcy,status\n1,A,10,shipped',
    })
    expect(kind).toBe('noon_sales')
  })
  it('يكشف أصناف نون', () => {
    const kind = detectFileKind({
      name: 'products.csv', isCsv: true,
      csvText: 'psku_code,noon_title,price\nP1,منتج,10',
    })
    expect(kind).toBe('noon_products')
  })
  it('يرجع unknown لملف غير معروف', () => {
    const kind = detectFileKind({ name: 'x.csv', isCsv: true, csvText: 'foo,bar\n1,2' })
    expect(kind).toBe('unknown')
  })
})

describe('parseNoonSales (تحليل مبيعات نون)', () => {
  const csv = [
    'item_nr,partner_sku,sku,brand_code,family,fulfillment_model,status,offer_price,gmv_lcy,currency_code,order_timestamp',
    'ORD-1,PSKU-1,NSKU-1,brandx,family1,FBN,delivered,50,50,SAR,2026-04-01',
    'ORD-2,PSKU-2,NSKU-2,brandx,family1,FBN,shipped,25.5,25.5,SAR,2026-04-02',
  ].join('\n')

  it('يحوّل الصفوف إلى طلبات بمجموع صحيح', () => {
    const r = parseNoonSales(csv, 'M-TEST')
    expect(r.kind).toBe('noon_sales')
    expect(r.error).toBeUndefined()
    expect(r.payloads[0].table).toBe('orders')
    expect(r.payloads[0].rows).toHaveLength(2)
    expect(r.summary.totalSales).toBe(76) // 50 + 25.5 ≈ 76 بعد التقريب
    expect(r.payloads[0].rows[0]).toMatchObject({
      merchant_code: 'M-TEST',
      platform: 'noon',
      order_id: 'ORD-1',
      status: 'delivered',
      total_amount: 50,
    })
  })
  it('يتجاهل الصفوف الفارغة ويرفض الملف الفارغ', () => {
    const r = parseNoonSales('item_nr,gmv_lcy\n', 'M-TEST')
    expect(r.error).toBeTruthy()
  })
})
