import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { n, s, normalize, xlsxDate, xlsxDateOnly, detectFileKind, parseNoonSales, parseAmazonCampaigns, parseAmazonSalesDashboard, parseNoonAsn, parseAmazonSettlement } from '../platformParsers'

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

describe('detectFileKind — الأنواع الجديدة (حملات أمازون + تغطية ترنديول)', () => {
  it('يكشف تقرير حملات أمازون (مستوى الحملة)', () => {
    const csv = 'الولاية,اسم الحملة,البلد,الحالة,النوع,الاستهداف,إستراتيجية عرض أسعار الحملة,مبلغ ميزانية الحملة,مرات الظهور,النقرات,إجمالي التكلفة,المشتريات,المبيعات,ACOS,ROAS\nP,حملة1,SA,نشط,تلقائي,تلقائي,ديناميكي,50,1000,40,30,5,200,0.15,6.6'
    expect(detectFileKind({ name: 'Campaign_Jun_11_2026.csv', isCsv: true, csvText: csv })).toBe('amazon_campaigns')
  })
  it('لا يخلط حملة أمازون مع تقرير المجموعة الإعلانية', () => {
    const adgroup = 'الولاية,اسم المجموعة الإعلانية,الحالة,مرات الظهور\nP,مجموعة1,نشط,100'
    expect(detectFileKind({ name: 'AdGroup.csv', isCsv: true, csvText: adgroup })).toBe('amazon_ads')
  })
})

describe('normalize + مطابقة عناوين مرنة', () => {
  it('يطبّع التطويل والتشكيل والمسافات والفواصل', () => {
    expect(normalize('  الـتـاريخ  ')).toBe('التاريخ')
    expect(normalize('Settlement-ID')).toBe('settlement id')
    expect(normalize('إجمالي  التكلفة (SAR)')).toBe('إجمالي التكلفة sar')
  })
})

describe('parseAmazonSettlement — تمييز amount عن total-amount/amount-type (مطابقة تامة أولاً)', () => {
  it('يقرأ العمود الصحيح ولا يخلط amount مع total-amount', () => {
    const headers = ['settlement-id','settlement-start-date','total-amount','currency','transaction-type','order-id','order-item-code','amount-type','amount-description','amount','sku','posted-date','posted-date-time']
    const row =     ['S1','16.04.2026','-999','SAR','Order','111-1','OI-1','ItemPrice','Principal','42.5','SKU-1','','16.04.2026']
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, row]), 'Sheet1')
    const r = parseAmazonSettlement(wb, 'M-TEST')
    const acc = r.payloads.find(p => p.table === 'account_transactions')!
    expect(acc.rows[0].net_amount).toBe(42.5)        // من «amount» لا «total-amount»(-999)
    expect(acc.rows[0].settlement_id).toBe('S1')
    expect(acc.rows[0].transaction_no).toContain('OI-1')  // مفتاح السطر من order-item-code
  })
})

describe('إرسالية نون (ASN) مُصدَّرة كـ CSV — لا تنهار بخطأ Sheets', () => {
  const asnCsv = 'psku_code,sku,qty,cubic_feet,storage_type_code,pbarcode_code,product_fulltype_code,brand_code,cluster_code\n' +
                 'a064cc25,Z9ED8DDBFF31-1,10,0.5721,standard,BLIGHT,home_decor,generic,home'
  it('يُكتشف ASN من CSV عبر psku_code + cubic_feet', () => {
    expect(detectFileKind({ name: 'A04395071PN products.csv', isCsv: true, csvText: asnCsv })).toBe('noon_asn')
  })
  it('parseNoonAsn يعمل على workbook مبني من نص CSV', () => {
    const wb = XLSX.read(asnCsv, { type: 'string' })  // نفس ما يفعله الموزّع للـ CSV الآن
    const r = parseNoonAsn(wb, 'M-TEST', 'A04395071PN products.csv')
    expect(r.kind).toBe('noon_asn')
    expect(r.error).toBeUndefined()
    const items = r.payloads.find(p => p.table === 'inbound_shipment_items')
    expect(items?.rows.length).toBe(1)
    expect(items?.rows[0]).toMatchObject({ sku: 'Z9ED8DDBFF31-1', qty: 10 })
  })
})

describe('amazon_sales_dashboard (لوحة الملخّص اليومية)', () => {
  const csv = [
    'اللوحة الرئيسية للمبيعات',
    'آخر تحديث,June 11 2026 2:22:15 PM AST',
    '',
    'لمحة عن المبيعات',
    'إجمالي عدد منتجات الطلب,الوحدات المطلوبة,مبيعات المنتج المطلوب',
    '25,25,"‏799.00 ر.س.‏"',
    'مقارنة المبيعات - عرض الرسم البياني',
    'التوقيت,نطاق التواريخ المحدد (مبيعات المنتج المطلوبة),نطاق التواريخ المحدد (الوحدات المطلوبة),نطاق التاريخ نفسه منذ عام واحد (مبيعات),نطاق سنة',
    '2026-06-01T00:00:00,"‏102.00 ر.س.‏",4.0,"‏0.00 ر.س.‏",0.0',
    '2026-06-03T00:00:00,"‏0.00 ر.س.‏",0.0,"‏0.00 ر.س.‏",0.0',
    '2026-06-06T00:00:00,"‏182.00 ر.س.‏",5.0,"‏0.00 ر.س.‏",0.0',
    'مقارنة المبيعات - عرض الجدول',
    ',إجمالي عدد منتجات الطلب,الوحدات المطلوبة',
  ].join('\n')

  it('يُكتشف كنوع amazon_sales_dashboard من السطر الأول', () => {
    expect(detectFileKind({ name: 'SalesDashboard.csv', isCsv: true, csvText: csv })).toBe('amazon_sales_dashboard')
  })
  it('يستخرج السلسلة اليومية ويتجاهل أيام الصفر والأقسام الأخرى', () => {
    const r = parseAmazonSalesDashboard(csv, 'M-TEST')
    expect(r.kind).toBe('amazon_sales_dashboard')
    expect(r.payloads[0].table).toBe('amazon_daily_sales')
    expect(r.payloads[0].conflict).toBe('merchant_code,data_date')
    const rows = r.payloads[0].rows
    expect(rows.length).toBe(2)  // يوم 2026-06-03 (صفر) مُتجاهَل
    expect(rows[0]).toMatchObject({ merchant_code: 'M-TEST', data_date: '2026-06-01', total_sales: 102, units: 4 })
    expect(rows[1]).toMatchObject({ data_date: '2026-06-06', total_sales: 182, units: 5 })
  })
})

describe('parseAmazonCampaigns', () => {
  const csv = [
    'الولاية,اسم الحملة,الحالة,إستراتيجية عرض أسعار الحملة,مبلغ ميزانية الحملة,مرات الظهور,النقرات,إجمالي التكلفة,المشتريات,المبيعات,ACOS,ROAS',
    'محفظة,حملة الصيف,نشط,ديناميكي,50,220146,1448,206.73,77,2330,0.0887,11.27',
  ].join('\n')
  it('يحوّل صفوف الحملة إلى ad_metrics بقيم صحيحة', () => {
    const r = parseAmazonCampaigns(csv, 'M-TEST')
    expect(r.kind).toBe('amazon_campaigns')
    expect(r.error).toBeUndefined()
    expect(r.payloads[0].table).toBe('ad_metrics')
    expect(r.payloads[0].conflict).toContain('campaign_name')
    const row = r.payloads[0].rows[0]
    expect(row).toMatchObject({ merchant_code: 'M-TEST', platform: 'amazon', campaign_name: 'حملة الصيف' })
    expect(row.spend).toBeCloseTo(206.73)
    expect(row.revenue).toBe(2330)
    expect(row.clicks).toBe(1448)
    // مفتاح إزالة التكرار: الأعمدة غير المستخدمة تكون '' لا null
    expect(row.ad_group_name).toBe('')
    expect(row.sku).toBe('')
    expect(row.search_query).toBe('')
  })
})
