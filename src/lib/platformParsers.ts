// ─── Platform File Parsers ────────────────────────────────────────────────────
// كل دالة تستلم workbook أو نص CSV، وتعيد كائن { kind, summary, payloads }
// payloads = الجداول المستهدفة + الصفوف الجاهزة للـ upsert

import * as XLSX from 'xlsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const n = (v: any): number => parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0
export const s = (v: any): string => String(v ?? '').trim()

const ci = (headers: string[], ...keys: string[]): number => {
  for (const k of keys) {
    const i = headers.findIndex(h => h.toLowerCase().includes(k.toLowerCase()))
    if (i >= 0) return i
  }
  return -1
}

export const xlsxDate = (v: any): string | null => {
  if (!v && v !== 0) return null
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  const str = String(v).trim()

  // ISO 8601 (yyyy-mm-dd or yyyy-mm-ddThh:mm:ss…) — استخدم Date مباشرة
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const d = new Date(str)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  // dd/mm/yyyy أو dd.mm.yyyy أو dd-mm-yyyy (الصيغة العربية/السعودية) — أولوية على Date لتجنب التفسير الأمريكي MM/DD
  const m = str.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})(?:[\sT](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (m) {
    const day  = m[1].padStart(2, '0')
    const mon  = m[2].padStart(2, '0')
    const year = m[3].length === 2 ? '20' + m[3] : m[3]
    const hh   = (m[4] || '0').padStart(2, '0')
    const mm   = (m[5] || '0').padStart(2, '0')
    const ss   = (m[6] || '0').padStart(2, '0')
    const dt = new Date(`${year}-${mon}-${day}T${hh}:${mm}:${ss}Z`)
    if (!isNaN(dt.getTime())) return dt.toISOString()
  }

  // ملاذ أخير: ثقة في Date (للصيغ الأخرى مثل "Apr 12, 2026")
  const d = new Date(str)
  if (!isNaN(d.getTime())) return d.toISOString()
  return null
}

export const xlsxDateOnly = (v: any): string | null => {
  const iso = xlsxDate(v); return iso ? iso.split('T')[0] : null
}

// ─── Status mappers ───────────────────────────────────────────────────────────
const mapNoonStatus = (st: string): string => {
  const x = (st || '').toLowerCase()
  if (x.includes('shipped'))   return 'shipped'
  if (x.includes('delivered')) return 'delivered'
  if (x.includes('cancel'))    return 'cancelled'
  if (x.includes('return'))    return 'returned'
  if (x.includes('confirm'))   return 'processing'
  if (x.includes('created'))   return 'pending'
  return 'pending'
}

// ─── Result types ─────────────────────────────────────────────────────────────
export type Payload = { table: string; rows: any[]; conflict?: string }
export interface ParseResult {
  kind: string                  // معرف الملف (مثلاً: noon_sales, trendyol_products)
  platform: string              // المنصة
  label: string                 // اسم عربي للملف
  summary: Record<string, any>
  payloads: Payload[]
  error?: string
}

// ─── File Detector ────────────────────────────────────────────────────────────
export interface FileInput {
  name: string
  platform?: 'noon' | 'trendyol' | 'amazon' | null
  isCsv: boolean
  csvText?: string
  workbook?: XLSX.WorkBook
}

export function detectFileKind(input: FileInput): string {
  // CSV files
  if (input.isCsv) {
    const firstLine = (input.csvText || '').split(/\r?\n/)[0].toLowerCase()
    if (firstLine.includes('id_partner') && firstLine.includes('gmv_lcy'))           return 'noon_sales'
    if (firstLine.includes('psku_code') && firstLine.includes('noon_title'))         return 'noon_products'
    if (firstLine.includes('اسم المجموعة الإعلانية') || firstLine.includes('ad_group')) return 'amazon_ads'
    if (firstLine.includes('حالة المعاملة') || firstLine.includes('نوع المعاملة'))    return 'amazon_transactions'
    return 'unknown'
  }

  // XLSX
  const wb = input.workbook!
  const sheets = wb.SheetNames

  // --- Noon ASN (products report) ---
  if (sheets.length === 1) {
    const ws = wb.Sheets[sheets[0]]
    const headers = (XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })[0] as any[]) || []
    const hStr = headers.map(h => s(h).toLowerCase())
    if (hStr.includes('psku_code') && hStr.includes('cubic_feet') && hStr.includes('storage_type_code')) return 'noon_asn'
    if (hStr.includes('seller-sku') && hStr.includes('fulfillment-channel-sku'))                          return 'amazon_inventory'
    if (hStr.includes('settlement-id') || hStr.includes('settlement-start-date'))                         return 'amazon_settlement'
  }

  // --- Noon GRN (multi-sheet) ---
  if (sheets.includes('GRN_Details') || sheets.includes('Summary') && sheets.includes('QC_Fail_Details')) return 'noon_grn'

  // --- Noon Ads ---
  if (sheets.some(n => n.toLowerCase().includes('product') && n.toLowerCase().includes('quer'))) return 'noon_ads'

  // --- Trendyol Sales report (3 sheets) ---
  if (sheets.some(n => n.includes('sales-by-product'))) return 'trendyol_sales'

  // --- Trendyol Account Statement ---
  if (sheets.includes('Detail')) {
    const ws = wb.Sheets['Detail']
    const headers = (XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })[0] as any[]) || []
    const hStr = headers.map(h => s(h).toLowerCase())
    if (hStr.includes('transaction no') && hStr.includes('storefront')) return 'trendyol_statement'
  }

  // --- Trendyol Products ---
  if (sheets.includes('المنتجات')) return 'trendyol_products'

  // --- Trendyol Deals ---
  if (sheets.includes('TeklifÜrünleri')) return 'trendyol_deals'

  // --- Trendyol Ads ---
  if (sheets.includes('Reklam Raporu')) return 'trendyol_ads'

  return 'unknown'
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

// === NOON: Sales export CSV ===
export function parseNoonSales(csv: string, merchantCode: string): ParseResult {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return errResult('noon_sales','noon','تقرير مبيعات نون','الملف فارغ')
  const sep = ','
  const parse = (l: string) => l.split(sep).map(c => c.trim().replace(/^["']+|["']+$/g, ''))
  const h = parse(lines[0]).map(c => c.toLowerCase())
  const idx = (k: string) => h.indexOf(k)

  const rows: any[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = parse(lines[i])
    if (c.every(x => !x)) continue
    const itemNr = c[idx('item_nr')]
    if (!itemNr) continue
    rows.push({
      merchant_code: merchantCode,
      platform: 'noon',
      order_id: itemNr,
      partner_sku: c[idx('partner_sku')] || null,
      sku: c[idx('partner_sku')] || c[idx('sku')] || null,
      noon_sku: c[idx('sku')] || null,
      brand: c[idx('brand_code')] || null,
      family: c[idx('family')] || null,
      fulfillment_model: c[idx('fulfillment_model')] || null,
      status: mapNoonStatus(c[idx('status')]),
      unit_price: n(c[idx('offer_price')]),
      total_amount: n(c[idx('gmv_lcy')]),
      gross_amount: n(c[idx('gmv_lcy')]),
      currency: c[idx('currency_code')] || 'SAR',
      order_date: xlsxDate(c[idx('order_timestamp')]) || new Date().toISOString(),
      shipment_date: xlsxDate(c[idx('shipment_timestamp')]),
      delivered_date: xlsxDate(c[idx('delivered_timestamp')]),
      quantity: 1,
    })
  }
  const total = rows.reduce((a, r) => a + r.total_amount, 0)
  return {
    kind: 'noon_sales', platform: 'noon', label: 'مبيعات نون',
    summary: { rows: rows.length, totalSales: Math.round(total), currency: rows[0]?.currency || 'SAR' },
    payloads: [{ table: 'orders', rows, conflict: 'merchant_code,platform,order_id' }],
  }
}

// === NOON: Live products CSV ===
export function parseNoonProducts(csv: string, merchantCode: string): ParseResult {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return errResult('noon_products','noon','اصناف نون','الملف فارغ')
  const sep = ','
  const parse = (l: string) => l.split(sep).map(c => c.trim().replace(/^["']+|["']+$/g, ''))
  const h = parse(lines[0]).map(c => c.toLowerCase())
  const idx = (k: string) => h.indexOf(k)

  const products: any[] = []
  const inventory: any[] = []
  const platformPrices: any[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = parse(lines[i])
    if (c.every(x => !x)) continue
    const partnerSku = c[idx('partner_sku')] || null
    const barcode    = c[idx('partner_barcodes')] || null
    const noonChild  = c[idx('sku_child')] || null
    const psku       = c[idx('psku_code')] || null
    const name       = c[idx('noon_title')] || ''
    const isLive     = (c[idx('noon_status')] || '').toLowerCase() === 'live'

    products.push({
      merchant_code: merchantCode,
      name,
      sku: partnerSku,
      barcode,
      psku_code: psku,
      noon_sku_child: noonChild,
      brand: c[idx('noon_brand')] || c[idx('brand_code')] || null,
      category: c[idx('family_code')] || null,
      msrp: n(c[idx('msrp')]) || null,
      sale_price: n(c[idx('sale_price')]) || null,
      sale_start_date: xlsxDateOnly(c[idx('sale_start_date')]),
      sale_end_date:   xlsxDateOnly(c[idx('sale_end_date')]),
      status: isLive ? 'active' : 'inactive',
    })

    inventory.push({
      merchant_code: merchantCode,
      platform: 'noon',
      sku: partnerSku || noonChild,
      partner_sku: partnerSku,
      product_name: name,
      quantity: parseInt(c[idx('stock_fbn_net')] || '0') || 0,
      stock_xdock_gross: parseInt(c[idx('stock_xdock_gross')] || '0') || 0,
      stock_xdock_net: parseInt(c[idx('stock_xdock_net')] || '0') || 0,
      fulfillment_channel: 'FBN',
      is_active: isLive,
    })

    const sellingPrice = n(c[idx('active_price')]) || n(c[idx('price')])
    if (sellingPrice > 0) {
      platformPrices.push({
        merchant_code: merchantCode,
        platform: 'noon',
        // product_id will be linked later via merchant_code+sku
        selling_price: sellingPrice,
      })
    }
  }
  return {
    kind: 'noon_products', platform: 'noon', label: 'كاتالوج نون',
    summary: { products: products.length, inventory: inventory.length },
    payloads: [
      { table: 'products', rows: products, conflict: 'merchant_code,sku' },
      { table: 'inventory', rows: inventory.filter(r => r.sku), conflict: 'merchant_code,sku,platform' },
    ],
  }
}

// === NOON: ASN ===
export function parseNoonAsn(wb: XLSX.WorkBook, merchantCode: string, fileName: string): ParseResult {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  if (data.length < 2) return errResult('noon_asn','noon','إرسالية نون','الملف فارغ')
  const headers = data[0].map(h => s(h).toLowerCase())
  const idx = (k: string) => headers.indexOf(k)

  // ASN number from filename like "A05083804PN products..."
  const asnMatch = fileName.match(/([A-Z0-9]{8,})/i)
  const asnNumber = asnMatch ? asnMatch[1] : `ASN-${Date.now()}`

  const items: any[] = []
  let totalQty = 0
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    const qty = parseInt(s(r[idx('qty')])) || 0
    items.push({
      sku: s(r[idx('sku')]) || null,
      partner_sku: s(r[idx('pbarcode_code')]) || null,
      barcode: s(r[idx('pbarcode_code')]) || null,
      qty,
      cubic_feet: n(r[idx('cubic_feet')]) || null,
      storage_type: s(r[idx('storage_type_code')]) || null,
      brand_code: s(r[idx('brand_code')]) || null,
      category_code: s(r[idx('product_fulltype_code')]) || s(r[idx('cluster_code')]) || null,
    })
    totalQty += qty
  }

  return {
    kind: 'noon_asn', platform: 'noon', label: 'إرسالية لمستودع نون',
    summary: { asn: asnNumber, items: items.length, totalQty },
    payloads: [
      { table: 'inbound_shipments', rows: [{
        merchant_code: merchantCode, platform: 'noon', asn_number: asnNumber,
        expected_qty: totalQty, status: 'sent',
        raw: { items_count: items.length },
      }], conflict: 'merchant_code,platform,asn_number' },
      { table: 'inbound_shipment_items', rows: items.map(it => ({
        ...it,
        merchant_code: merchantCode, platform: 'noon',
        // shipment_id linked after parent insert
        _asn_number: asnNumber,
      })) },
    ],
  }
}

// === NOON: GRN ===
export function parseNoonGrn(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const summary = wb.Sheets['Summary']
  const details = wb.Sheets['GRN_Details']
  const qc      = wb.Sheets['QC_Fail_Details']

  let asnNumber = '', warehouse = '', expected = 0, delivered = 0, variance = 0, deliveryDate = null as string | null
  if (summary) {
    const sd = XLSX.utils.sheet_to_json<any[]>(summary, { header: 1, defval: '' }) as any[][]
    if (sd[1]) {
      asnNumber    = s(sd[1][0]) || ''
      warehouse    = s(sd[1][1]) || ''
      deliveryDate = xlsxDateOnly(sd[1][2])
      expected     = n(sd[1][3])
      delivered    = n(sd[1][4])
      variance     = n(sd[1][5])
    }
  }

  const rows: any[] = []
  if (details) {
    const dd = XLSX.utils.sheet_to_json<any[]>(details, { header: 1, defval: '' }) as any[][]
    const h = (dd[0] || []).map(x => s(x).toLowerCase())
    const idx = (k: string) => h.indexOf(k.toLowerCase())
    for (let i = 1; i < dd.length; i++) {
      const r = dd[i]; if (!r || r.every((c: any) => !c)) continue
      rows.push({
        merchant_code: merchantCode, platform: 'noon',
        asn_number: s(r[idx('asn number')]) || asnNumber,
        warehouse_code: s(r[idx('warehouse')]) || warehouse,
        grn_date: xlsxDateOnly(r[idx('grn date')]) || deliveryDate,
        sku: s(r[idx('sku')]),
        partner_sku: s(r[idx('partner sku')]),
        barcode: s(r[idx('pbarcode canonical')]),
        grn_quantity: parseInt(s(r[idx('grn quantity')])) || 0,
        qc_status: 'passed',
      })
    }
  }
  if (qc) {
    const qd = XLSX.utils.sheet_to_json<any[]>(qc, { header: 1, defval: '' }) as any[][]
    const h = (qd[0] || []).map(x => s(x).toLowerCase())
    const idx = (k: string) => h.indexOf(k.toLowerCase())
    for (let i = 1; i < qd.length; i++) {
      const r = qd[i]; if (!r || r.every((c: any) => !c)) continue
      rows.push({
        merchant_code: merchantCode, platform: 'noon',
        asn_number: s(r[idx('asn number')]) || asnNumber,
        warehouse_code: s(r[idx('warehouse')]) || warehouse,
        grn_date: xlsxDateOnly(r[idx('grn date')]) || deliveryDate,
        sku: s(r[idx('sku')]),
        partner_sku: s(r[idx('partner sku')]),
        barcode: s(r[idx('pbarcode canonical')]) || s(r[idx('barcode')]),
        grn_quantity: parseInt(s(r[idx('grn quantity')])) || 0,
        qc_status: 'failed',
        reject_reason: s(r[idx('reject reason')]),
      })
    }
  }

  // Update inbound_shipments header if exists
  const headerUpsert = asnNumber ? [{
    merchant_code: merchantCode, platform: 'noon', asn_number: asnNumber,
    warehouse_code: warehouse, expected_qty: expected, delivered_qty: delivered,
    variance, delivery_date: deliveryDate, status: 'received',
  }] : []

  return {
    kind: 'noon_grn', platform: 'noon', label: 'استلام نون',
    summary: { asn: asnNumber, expected, delivered, variance, qcFailed: rows.filter(r => r.qc_status === 'failed').length },
    payloads: [
      ...(headerUpsert.length ? [{ table: 'inbound_shipments', rows: headerUpsert, conflict: 'merchant_code,platform,asn_number' }] : []),
      { table: 'goods_received', rows },
    ],
  }
}

// === NOON: Ads ===
export function parseNoonAds(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('quer')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x).toLowerCase())
  const idx = (k: string) => h.indexOf(k.toLowerCase())

  const today = new Date().toISOString().split('T')[0]
  const rows: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    rows.push({
      merchant_code: merchantCode, platform: 'noon', report_date: today,
      campaign_name: s(r[idx('campaign name')]),
      sku: s(r[idx('sku')]),
      search_query: s(r[idx('query')]),
      impressions: parseInt(s(r[idx('views')])) || 0,
      clicks: parseInt(s(r[idx('clicks')])) || 0,
      orders: parseInt(s(r[idx('orders')])) || 0,
      add_to_cart: parseInt(s(r[idx('atc')])) || 0,
      spend: n(r[idx('spends')]),
      revenue: n(r[idx('revenue')]),
      ctr: n(r[idx('ctr')]) || null,
      roas: n(r[idx('roas')]) || null,
      cpc: n(r[idx('cpc')]) || null,
      cps: n(r[idx('cps')]) || null,
      cvr: n(r[idx('cvr')]) || null,
    })
  }
  const totSpend = rows.reduce((a, r) => a + r.spend, 0)
  const totRev   = rows.reduce((a, r) => a + r.revenue, 0)
  return {
    kind: 'noon_ads', platform: 'noon', label: 'إعلانات نون',
    summary: { rows: rows.length, spend: Math.round(totSpend), revenue: Math.round(totRev), roas: totSpend > 0 ? +(totRev/totSpend).toFixed(2) : 0 },
    payloads: [{ table: 'ad_metrics', rows }],
  }
}

// === TRENDYOL: Account Statement ===
export function parseTrendyolStatement(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets['Detail']
  if (!ws) return errResult('trendyol_statement','trendyol','كشف حساب تراندايول','ورقة Detail غير موجودة')
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x).toLowerCase())
  const idx = (k: string) => h.indexOf(k.toLowerCase())

  const rows: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    rows.push({
      merchant_code: merchantCode, platform: 'trendyol',
      transaction_no: s(r[idx('transaction no')]),
      transaction_date: xlsxDate(r[idx('transaction date')]),
      posted_date: xlsxDate(r[idx('payment date')]),
      transaction_type: s(r[idx('transaction type')]),
      order_id: s(r[idx('order number')]) || null,
      description: s(r[idx('product name / description')]),
      product_barcode: s(r[idx('product barcode')]) || null,
      currency: s(r[idx('currency')]) || 'SAR',
      debit: n(r[idx('debit')]),
      credit: n(r[idx('credit')]),
      net_amount: n(r[idx('credit')]) - n(r[idx('debit')]),
      marketplace: s(r[idx('storefront')]),
    })
  }
  return {
    kind: 'trendyol_statement', platform: 'trendyol', label: 'كشف حساب تراندايول',
    summary: { rows: rows.length, debit: rows.reduce((a, r) => a + r.debit, 0), credit: rows.reduce((a, r) => a + r.credit, 0) },
    payloads: [{ table: 'account_transactions', rows, conflict: 'merchant_code,platform,transaction_no' }],
  }
}

// === TRENDYOL: Products ===
export function parseTrendyolProducts(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets['المنتجات']
  if (!ws) return errResult('trendyol_products','trendyol','منتجات تراندايول','ورقة المنتجات غير موجودة')
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x))
  const idx = (...keys: string[]) => ci(h, ...keys)

  const C = {
    barcode: idx('الباركود'),
    sku:     idx('رمز الموديل'),
    title:   idx('العنوان'),
    desc:    idx('الوصف'),
    cat:     idx('اسم الفئة'),
    brand:   idx('الماركة'),
    color:   idx('لون المنتج'),
    size:    idx('المقاس'),
    price:   idx('سعر البيع', 'سعر البيع (شامل'),
    msrp:    idx('السعر الأصلي'),
    stock:   idx('المخزون'),
    url:     idx('رابط Trendyol'),
    status:  idx('الحالة'),
    img1:    idx('صورة 1'),
  }

  const products: any[] = []
  const inventory: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    const barcode = s(r[C.barcode])
    const sku     = s(r[C.sku]) || barcode
    if (!sku && !barcode) continue
    const title  = s(r[C.title])
    const stock  = parseInt(s(r[C.stock])) || 0
    const status = s(r[C.status]).toLowerCase()
    const isActive = status.includes('نشط') || status.includes('active') || status === ''

    const images: string[] = []
    for (let img = 1; img <= 8; img++) {
      const ix = ci(h, `صورة ${img}`)
      if (ix >= 0) { const v = s(r[ix]); if (v) images.push(v) }
    }

    products.push({
      merchant_code: merchantCode,
      name: title, sku, barcode: barcode || null,
      category: s(r[C.cat]) || null,
      brand: s(r[C.brand]) || null,
      color: s(r[C.color]) || null,
      size: s(r[C.size]) || null,
      msrp: n(r[C.msrp]) || null,
      description: s(r[C.desc]) || null,
      external_url: s(r[C.url]) || null,
      images,
      image_url: images[0] || null,
      status: isActive ? (stock > 0 ? 'active' : 'out_of_stock') : 'inactive',
    })
    inventory.push({
      merchant_code: merchantCode, platform: 'trendyol',
      sku, product_name: title, quantity: stock, is_active: isActive,
    })
  }
  return {
    kind: 'trendyol_products', platform: 'trendyol', label: 'منتجات تراندايول',
    summary: { products: products.length, totalStock: inventory.reduce((a, r) => a + r.quantity, 0) },
    payloads: [
      { table: 'products', rows: products, conflict: 'merchant_code,sku' },
      { table: 'inventory', rows: inventory, conflict: 'merchant_code,sku,platform' },
    ],
  }
}

// === TRENDYOL: Deals ===
export function parseTrendyolDeals(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets['TeklifÜrünleri']
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x))
  const idx = (...keys: string[]) => ci(h, ...keys)
  const rows: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    rows.push({
      product_name: s(r[idx('Product name')]),
      model_code: s(r[idx('Model code')]),
      barcode: s(r[idx('Barcode')]),
      category: s(r[idx('Category')]),
      brand: s(r[idx('Brand')]),
      stock: parseInt(s(r[idx('Stock')])) || 0,
      sale_price: n(r[idx('Sale price')]),
      super_deal_upper: n(r[idx('Super Deal Upper Price')]),
      mega_deal_upper: n(r[idx('Mega Deal Upper Price')]),
      super_commission: n(r[idx('Super Deal Commission')]),
      mega_commission: n(r[idx('Mega Deal Commission')]),
      current_commission: n(r[idx('Current commission')]),
      end_date: s(r[idx('Deal End Date')]),
      content_id: s(r[idx('Content Id')]),
    })
  }
  return {
    kind: 'trendyol_deals', platform: 'trendyol', label: 'عروض تراندايول',
    summary: { rows: rows.length },
    // store as raw JSON in account_transactions raw — or skip writing for now
    payloads: [],
    // (الجدول مش معرف بعد — نعرض المعلومات للتاجر فقط)
  }
}

// === TRENDYOL: Ads ===
export function parseTrendyolAds(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets['Reklam Raporu']
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x))
  const idx = (...keys: string[]) => ci(h, ...keys)
  const today = new Date().toISOString().split('T')[0]
  const rows: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    rows.push({
      merchant_code: merchantCode, platform: 'trendyol', report_date: today,
      campaign_name: s(r[idx('اسم الإعلان')]),
      ad_status: s(r[idx('حالة الإعلان')]),
      start_date: xlsxDateOnly(r[idx('تاريخ البداية')]),
      end_date: xlsxDateOnly(r[idx('تاريخ النهاية')]),
      budget_total: n(r[idx('إجمالي الميزانية')]) || null,
      budget_daily: n(r[idx('الميزانية اليومية')]) || null,
      budget_remaining: n(r[idx('الميزانية المتبقية')]) || null,
      spend: n(r[idx('التكلفة')]),
      cpc: n(r[idx('تكلفة النقرة المحققة')]) || null,
      clicks: parseInt(s(r[idx('عدد النقرات')])) || 0,
      impressions: parseInt(s(r[idx('من المشاهدات')])) || 0,
      revenue: n(r[idx('إجمالي المبيعات')]),
      roas: n(r[idx('عائد الإنفاق الإعلاني')]) || null,
    })
  }
  const totSpend = rows.reduce((a, r) => a + r.spend, 0)
  return {
    kind: 'trendyol_ads', platform: 'trendyol', label: 'إعلانات تراندايول',
    summary: { rows: rows.length, spend: Math.round(totSpend) },
    payloads: [{ table: 'ad_metrics', rows }],
  }
}

// === TRENDYOL: Sales (existing logic kept compatible — emits performance_data + product_performance_snapshots) ===
export function parseTrendyolSales(wb: XLSX.WorkBook, merchantCode: string, snapshotDate: string): ParseResult {
  const wsP = wb.Sheets[wb.SheetNames.find(name => name.includes('product')) || wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<any[]>(wsP, { header: 1, defval: '' }) as any[][]
  if (data.length < 2) return errResult('trendyol_sales','trendyol','مبيعات تراندايول','الملف فارغ')
  const h = (data[0] || []).map(x => s(x))
  const idx = (...keys: string[]) => ci(h, ...keys)

  const C = {
    barcode: idx('الباركود'), product: idx('اسم المنتج'), sku: idx('رمز الموديل'),
    category: idx('الفئة'), brand: idx('الماركة'), color: idx('اللون'), size: idx('المقاس'),
    sold: idx('المنتجات المباعة', 'إجمالي المنتجات المباعة'),
    cancelled: idx('المنتجات الملغاة'),
    cxRate: idx('نسبة الإلغاءات'),
    returned: idx('المنتجات المرتجعة'),
    retRate: idx('نسبة المرتجعات'),
    netSold: idx('صافي المنتجات المباعة'),
    gross: idx('إجمالي المبيعات'),
    discount: idx('قيمة الخصم'),
    netRev: idx('صافي الإيرادات'),
    avgP: idx('متوسط سعر البيع'),
    curP: idx('سعر البيع الحالي'),
    stock: idx('المخزون الحالي'),
    cxCust: idx('ألغاها العميل'), cxTrendyol: idx('ألغتها Trendyol', 'طلبيات ألغت'),
    cxSeller: idx('ألغيتها بنفسي'),
    rDislike: idx('لم يعجبني'), rDefect: idx('شوائب'), rWrong: idx('غير صحيح'),
    rMind: idx('غيرت رأيي'), rSmall: idx('صغير للغاية'), rLarge: idx('كبير للغاية'),
    rMismatch: idx('لا يتطابق'), rQuality: idx('جودة المنتج'),
    rNoDeliv: idx('لم يتم تسليمه'), rShip: idx('تعذّر شحن'),
    rTransit: idx('أثناء النقل'), rTrack: idx('رمز التعقّب'),
    rUnfull: idx('غير مستوفاة'), rLate: idx('تأخر التسليم'), rNoConf: idx('عدم الحصول على تأكيد'),
    rComp: idx('التعويضات'), rOther: idx('غير ذلك'),
  }

  const snapshots: any[] = []
  const products: any[] = []
  const inventory: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    const sku = s(r[C.sku]) || s(r[C.barcode])
    if (!sku) continue
    const name = s(r[C.product])
    const stock = n(r[C.stock])
    snapshots.push({
      merchant_code: merchantCode, platform: 'trendyol',
      snapshot_date: snapshotDate,
      sku, barcode: s(r[C.barcode]),
      product_name: name, brand: s(r[C.brand]), category: s(r[C.category]),
      color: s(r[C.color]), size: s(r[C.size]),
      sold: n(r[C.sold]),
      cancelled: n(r[C.cancelled]), cancel_rate: n(r[C.cxRate]),
      returned: n(r[C.returned]), return_rate: n(r[C.retRate]),
      net_sold: n(r[C.netSold]),
      gross_sales: n(r[C.gross]), discount: n(r[C.discount]),
      net_revenue: n(r[C.netRev]),
      avg_price: n(r[C.avgP]), current_price: n(r[C.curP]),
      current_stock: stock,
      cancel_reasons: {
        customer: n(r[C.cxCust]), trendyol: n(r[C.cxTrendyol]), seller: n(r[C.cxSeller]),
      },
      return_reasons: {
        dislike: n(r[C.rDislike]), defective: n(r[C.rDefect]), wrong_product: n(r[C.rWrong]),
        changed_mind: n(r[C.rMind]), too_small: n(r[C.rSmall]), too_large: n(r[C.rLarge]),
        mismatch: n(r[C.rMismatch]), bad_quality: n(r[C.rQuality]),
        not_delivered: n(r[C.rNoDeliv]), shipping_failed: n(r[C.rShip]),
        transit: n(r[C.rTransit]), no_tracking: n(r[C.rTrack]),
        unfulfilled: n(r[C.rUnfull]), late_delivery: n(r[C.rLate]),
        no_confirm: n(r[C.rNoConf]), compensation: n(r[C.rComp]), other: n(r[C.rOther]),
      },
    })
    products.push({
      merchant_code: merchantCode, name, sku, barcode: s(r[C.barcode]) || null,
      category: s(r[C.category]) || null, brand: s(r[C.brand]) || null,
      color: s(r[C.color]) || null, size: s(r[C.size]) || null,
      status: stock > 0 ? 'active' : 'out_of_stock',
    })
    inventory.push({
      merchant_code: merchantCode, platform: 'trendyol',
      sku, product_name: name, quantity: Math.round(stock), is_active: true,
    })
  }
  return {
    kind: 'trendyol_sales', platform: 'trendyol', label: 'مبيعات تراندايول',
    summary: { products: snapshots.length, gross: snapshots.reduce((a, r) => a + r.gross_sales, 0) },
    payloads: [
      { table: 'product_performance_snapshots', rows: snapshots },
      { table: 'products', rows: products, conflict: 'merchant_code,sku' },
      { table: 'inventory', rows: inventory, conflict: 'merchant_code,sku,platform' },
    ],
  }
}

// === AMAZON: Settlement ===
export function parseAmazonSettlement(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x).toLowerCase())
  const idx = (k: string) => h.indexOf(k.toLowerCase())
  const rows: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    rows.push({
      merchant_code: merchantCode, platform: 'amazon',
      settlement_id: s(r[idx('settlement-id')]),
      transaction_date: xlsxDate(r[idx('settlement-start-date')]),
      posted_date: xlsxDate(r[idx('posted-date-time')] >= 0 ? r[idx('posted-date-time')] : r[idx('posted-date')]),
      transaction_type: s(r[idx('transaction-type')]) || s(r[idx('amount-type')]),
      order_id: s(r[idx('order-id')]) || null,
      description: s(r[idx('amount-description')]),
      product_sku: s(r[idx('sku')]) || null,
      amount_type: s(r[idx('amount-type')]),
      amount_description: s(r[idx('amount-description')]),
      net_amount: n(r[idx('amount')]),
      currency: s(r[idx('currency')]) || 'SAR',
      marketplace: s(r[idx('marketplace-name')]),
    })
  }
  const totals = rows.reduce((a, r) => a + r.net_amount, 0)
  return {
    kind: 'amazon_settlement', platform: 'amazon', label: 'تسوية أمازون',
    summary: { rows: rows.length, total: Math.round(totals * 100) / 100 },
    payloads: [{ table: 'account_transactions', rows }],
  }
}

// === AMAZON: Transactions CSV ===
export function parseAmazonTransactions(csv: string, merchantCode: string): ParseResult {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return errResult('amazon_transactions','amazon','معاملات أمازون','الملف فارغ')
  const parseLine = (l: string): string[] => {
    const out: string[] = []; let cur = '', q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if (ch === ',' && !q) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur); return out.map(x => x.trim())
  }
  const h = parseLine(lines[0]).map(x => x.replace(/^﻿/, '').toLowerCase())
  const idx = (k: string) => h.findIndex(x => x.includes(k.toLowerCase()))
  const rows: any[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i])
    if (c.every(x => !x)) continue
    rows.push({
      merchant_code: merchantCode, platform: 'amazon',
      transaction_date: xlsxDate(c[idx('التاريخ')]),
      transaction_type: c[idx('نوع المعاملة')] || '',
      amount_description: c[idx('حالة المعاملة')] || '',
      order_id: c[idx('رقم الطلب')] || null,
      description: c[idx('تفاصيل المنتج')] || '',
      debit: n(c[idx('رسوم أمازون')]) > 0 ? 0 : Math.abs(n(c[idx('رسوم أمازون')])),
      credit: n(c[idx('إجمالي رسوم المنتج')]),
      net_amount: n(c[idx('الإجمالي')]),
      currency: 'SAR',
    })
  }
  return {
    kind: 'amazon_transactions', platform: 'amazon', label: 'معاملات أمازون',
    summary: { rows: rows.length, total: rows.reduce((a, r) => a + r.net_amount, 0) },
    payloads: [{ table: 'account_transactions', rows }],
  }
}

// === AMAZON: Inventory ===
export function parseAmazonInventory(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x).toLowerCase())
  const idx = (k: string) => h.indexOf(k.toLowerCase())
  const rows: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    const sku = s(r[idx('seller-sku')])
    if (!sku) continue
    rows.push({
      merchant_code: merchantCode, platform: 'amazon',
      sku, asin: s(r[idx('asin')]),
      product_name: sku,
      condition_type: s(r[idx('condition-type')]),
      fulfillment_channel: 'FBA',
      quantity: parseInt(s(r[idx('quantity available')])) || 0,
      is_active: true,
    })
  }
  return {
    kind: 'amazon_inventory', platform: 'amazon', label: 'مخزون أمازون',
    summary: { rows: rows.length, totalStock: rows.reduce((a, r) => a + r.quantity, 0) },
    payloads: [{ table: 'inventory', rows, conflict: 'merchant_code,sku,platform' }],
  }
}

// === AMAZON: Sponsored Products Ads CSV ===
export function parseAmazonAds(csv: string, merchantCode: string): ParseResult {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return errResult('amazon_ads','amazon','إعلانات أمازون','الملف فارغ')
  const parseLine = (l: string) => l.split(',').map(c => c.trim().replace(/^["']+|["']+$/g, ''))
  const h = parseLine(lines[0]).map(x => x.replace(/^﻿/, '').toLowerCase())
  const idx = (k: string) => h.findIndex(x => x.includes(k.toLowerCase()))
  const today = new Date().toISOString().split('T')[0]
  const rows: any[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i])
    if (c.every(x => !x)) continue
    rows.push({
      merchant_code: merchantCode, platform: 'amazon', report_date: today,
      ad_group_name: c[idx('اسم المجموعة الإعلانية')] || '',
      ad_status: c[idx('الحالة')] || '',
      impressions: parseInt(c[idx('مرات الظهور')]) || 0,
      clicks: parseInt(c[idx('النقرات')]) || 0,
      orders: parseInt(c[idx('المشتريات')]) || 0,
      spend: n(c[idx('إجمالي التكلفة')]),
      revenue: n(c[idx('المبيعات (sar)')]) || n(c[idx('المبيعات')]),
      ctr: n(c[idx('معدل النقر')]) || null,
      cpc: n(c[idx('التكلفة لكل نقرة')]) || null,
      acos: n(c[idx('acos')]) || null,
      roas: n(c[idx('roas')]) || n(c[idx('عائد الإنفاق')]) || null,
    })
  }
  return {
    kind: 'amazon_ads', platform: 'amazon', label: 'إعلانات أمازون',
    summary: { rows: rows.length, spend: rows.reduce((a, r) => a + r.spend, 0) },
    payloads: [{ table: 'ad_metrics', rows }],
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────
export async function parsePlatformFile(file: File, merchantCode: string, snapshotDate?: string): Promise<ParseResult> {
  const isCsv = /\.csv$/i.test(file.name) || /\.txt$/i.test(file.name)
  let csvText: string | undefined
  let workbook: XLSX.WorkBook | undefined
  try {
    if (isCsv) {
      csvText = await file.text()
    } else {
      const buf = await file.arrayBuffer()
      workbook = XLSX.read(buf, { type: 'array' })
    }
  } catch (e: any) {
    return errResult('unknown', 'other', file.name, 'فشل قراءة الملف: ' + e.message)
  }

  const kind = detectFileKind({ name: file.name, isCsv, csvText, workbook })
  const sd = snapshotDate || new Date().toISOString().split('T')[0]

  try {
    switch (kind) {
      case 'noon_sales':           return parseNoonSales(csvText!, merchantCode)
      case 'noon_products':        return parseNoonProducts(csvText!, merchantCode)
      case 'noon_asn':             return parseNoonAsn(workbook!, merchantCode, file.name)
      case 'noon_grn':             return parseNoonGrn(workbook!, merchantCode)
      case 'noon_ads':             return parseNoonAds(workbook!, merchantCode)
      case 'trendyol_sales':       return parseTrendyolSales(workbook!, merchantCode, sd)
      case 'trendyol_statement':   return parseTrendyolStatement(workbook!, merchantCode)
      case 'trendyol_products':    return parseTrendyolProducts(workbook!, merchantCode)
      case 'trendyol_deals':       return parseTrendyolDeals(workbook!, merchantCode)
      case 'trendyol_ads':         return parseTrendyolAds(workbook!, merchantCode)
      case 'amazon_settlement':    return parseAmazonSettlement(workbook!, merchantCode)
      case 'amazon_transactions':  return parseAmazonTransactions(csvText!, merchantCode)
      case 'amazon_inventory':     return parseAmazonInventory(workbook!, merchantCode)
      case 'amazon_ads':           return parseAmazonAds(csvText!, merchantCode)
      default:                     return errResult('unknown', 'other', file.name, 'نوع الملف غير معروف — تأكد أنه تقرير رسمي من المنصة')
    }
  } catch (e: any) {
    return errResult(kind, 'other', file.name, 'خطأ في التحليل: ' + e.message)
  }
}

function errResult(kind: string, platform: string, label: string, error: string): ParseResult {
  return { kind, platform, label, summary: {}, payloads: [], error }
}
