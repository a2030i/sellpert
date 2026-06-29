// ─── Platform File Parsers ────────────────────────────────────────────────────
// كل دالة تستلم workbook أو نص CSV، وتعيد كائن { kind, summary, payloads }
// payloads = الجداول المستهدفة + الصفوف الجاهزة للـ upsert

import * as XLSX from 'xlsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const n = (v: any): number => parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0
export const s = (v: any): string => String(v ?? '').trim()

// تطبيع العناوين: يجعل المطابقة صامدة أمام إعادة التسمية الطفيفة واختلاف اللغة/التشكيل.
// يزيل: التطويل (ـ)، التشكيل، علامات الاتجاه (RTL/LTR)، يوحّد المسافات، يحوّل
// الفواصل/الأقواس/الشرطات إلى مسافة، ويصغّر الأحرف اللاتينية.
export function normalize(v: any): string {
  return String(v ?? '')
    .replace(/^﻿/, '')
    .replace(/[‎‏‪-‮]/g, '')   // علامات الاتجاه
    .replace(/[ؐ-ًؚ-ْٰـ]/g, '')  // تشكيل + تطويل
    .replace(/[()\[\]{}_\-./\\،,:|]+/g, ' ')        // فواصل شائعة → مسافة
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// مفتاح إزالة تكرار الإعلانات: إعادة رفع نفس التقرير في نفس اليوم تستبدل بدل أن
// تضاعف الإنفاق. كل أعمدة المفتاح يجب أن تكون '' (لا null) ليطابقها الفهرس الفريد.
const AD_CONFLICT = 'merchant_code,platform,report_date,campaign_name,ad_group_name,sku,search_query'
function adKeyDefaults(row: any) {
  return {
    ...row,
    campaign_name: s(row.campaign_name), ad_group_name: s(row.ad_group_name),
    sku: s(row.sku), search_query: s(row.search_query),
  }
}

// يمنح كل صف مفتاحاً ثابتاً فريداً داخل الملف: بادئة طبيعية + ترتيب التكرار عند
// التطابق. إعادة رفع نفس الملف تنتج نفس المفاتيح (تستبدل عبر upsert)، والسطور
// المتطابقة فعلاً (مثل رسمين متماثلين في التسوية) تبقى متمايزة (#1، #2...).
function stampLineKeys(rows: any[], prefixes: string[], field = 'transaction_no'): any[] {
  const occ = new Map<string, number>()
  rows.forEach((row, i) => {
    const p = prefixes[i]
    const c = occ.get(p) ?? 0
    occ.set(p, c + 1)
    row[field] = c === 0 ? p : `${p}#${c}`
  })
  return rows
}

// مطابقة عنوان مرنة: تطبيع الطرفين، ثم مطابقة تامة مطبَّعة أولاً (الأدق) ثم احتواء.
// تقبل عدة مرادفات؛ تُرجع موضع أول تطابق أو -1.
const ci = (headers: string[], ...keys: string[]): number => {
  const norm = headers.map(normalize)
  for (const k of keys) {
    const nk = normalize(k)
    let i = norm.indexOf(nk)
    if (i >= 0) return i
    i = norm.findIndex(h => h.includes(nk))
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

// Helper: find the header row in a sheet. Headers are usually short snake_case-ish
// strings; data rows usually contain numbers or long Arabic descriptions. Scan the
// first few rows and pick the one that most "looks like" headers.
function findHeaderRow(ws: XLSX.WorkSheet, maxScan = 5): string[] {
  const rows = (XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]).slice(0, maxScan)
  let best: any[] = []
  let bestScore = -Infinity
  for (const r of rows) {
    if (!Array.isArray(r) || r.length === 0) continue
    let score = 0
    let nonEmpty = 0
    for (const cell of r) {
      if (cell === '' || cell == null) continue
      nonEmpty++
      const v = String(cell).trim()
      if (!v) continue
      // Reward short string cells that look like column names
      if (typeof cell === 'string' || cell instanceof String) {
        if (v.length <= 40) score += 2
        else                score -= 2   // long text → probably data
        if (/^[a-z][a-z0-9_-]*$/i.test(v)) score += 3  // snake_case or kebab-case
        if (/\s{2,}/.test(v)) score -= 1               // multiple spaces → probably a sentence
      } else if (typeof cell === 'number') {
        score -= 3  // numbers in header row are very unlikely
      }
    }
    if (nonEmpty === 0) continue
    if (score > bestScore) { best = r; bestScore = score }
  }
  // Fallback: if all rows scored negative, take the first non-empty row anyway
  if (best.length === 0) {
    for (const r of rows) {
      if (Array.isArray(r) && r.some(c => c !== '' && c != null)) { best = r; break }
    }
  }
  return best.map(h => String(h ?? '').replace(/^﻿/, '').trim().toLowerCase())
}

export function detectFileKind(input: FileInput): string {
  // CSV files
  if (input.isCsv) {
    const firstLine = (input.csvText || '').replace(/^﻿/, '').split(/\r?\n/)[0].toLowerCase()
    // لوحة مبيعات أمازون الملخّصة (إجماليات يومية، ليست تقريراً تفصيلياً)
    if (firstLine.includes('اللوحة الرئيسية للمبيعات'))                              return 'amazon_sales_dashboard'
    if (firstLine.includes('id_partner') && firstLine.includes('gmv_lcy'))           return 'noon_sales'
    if (firstLine.includes('psku_code') && firstLine.includes('noon_title'))         return 'noon_products'
    // Noon ASN sometimes exported as CSV
    if (firstLine.includes('psku_code') && firstLine.includes('cubic_feet'))         return 'noon_asn'
    if (firstLine.includes('اسم المجموعة الإعلانية') || firstLine.includes('ad_group')) return 'amazon_ads'
    // تقرير حملات أمازون (مستوى الحملة) — يحتوي اسم الحملة + ميزانية/إستراتيجية بدل اسم المجموعة الإعلانية
    if (firstLine.includes('اسم الحملة') && (firstLine.includes('ميزانية الحملة') || firstLine.includes('إستراتيجية عرض') || firstLine.includes('استراتيجية عرض'))) return 'amazon_campaigns'
    if (firstLine.includes('حالة المعاملة') || firstLine.includes('نوع المعاملة'))    return 'amazon_transactions'
    return 'unknown'
  }

  // XLSX
  const wb = input.workbook!
  const sheets = wb.SheetNames

  // --- Amazon Inventory Template / Listing (يحتوي على Template + Data Definitions) ---
  if (sheets.includes('Template') && sheets.includes('Data Definitions')) {
    return 'amazon_listings'
  }

  // --- Noon ASN (Advance Shipment Notice — products report from Noon) ---
  // Detection: any sheet whose headers contain psku_code + (cubic_feet OR storage_type_code OR pbarcode_code)
  // This handles variations: Arabic file names, slight column changes, multi-sheet ASN exports.
  for (const sn of sheets) {
    const hStr = findHeaderRow(wb.Sheets[sn])
    if (hStr.includes('psku_code') &&
        (hStr.includes('cubic_feet') || hStr.includes('storage_type_code') || hStr.includes('pbarcode_code'))) {
      // Make sure it's NOT a noon_products file (which also has psku_code but with noon_title)
      if (!hStr.includes('noon_title')) return 'noon_asn'
    }
  }

  // --- Noon products report (could be xlsx too, not just csv) ---
  for (const sn of sheets) {
    const hStr = findHeaderRow(wb.Sheets[sn])
    if (hStr.includes('psku_code') && hStr.includes('noon_title')) return 'noon_products'
  }

  // --- Noon sales report (could be xlsx) ---
  for (const sn of sheets) {
    const hStr = findHeaderRow(wb.Sheets[sn])
    if (hStr.includes('id_partner') && hStr.includes('gmv_lcy')) return 'noon_sales'
  }

  // --- Amazon Inventory / Settlement (single sheet) ---
  if (sheets.length === 1) {
    const hStr = findHeaderRow(wb.Sheets[sheets[0]])
    if (hStr.includes('seller-sku') && hStr.includes('fulfillment-channel-sku')) return 'amazon_inventory'
    if (hStr.includes('settlement-id') || hStr.includes('settlement-start-date')) return 'amazon_settlement'
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

  // --- Trendyol Campaign coverage (selected products in a campaign) ---
  if (sheets.includes('CampaignProducts')) return 'trendyol_campaign_products'
  for (const sn of sheets) {
    const hStr = findHeaderRow(wb.Sheets[sn])
    if (hStr.includes('campaign product id') && hStr.includes('barcode') && hStr.includes('product code')) return 'trendyol_campaign_products'
  }

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
  const idx = (...k: string[]) => ci(h, ...k)

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
  const idx = (...k: string[]) => ci(h, ...k)

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
      noon_price_min: n(c[idx('noon_price_min')]) || null,
      noon_price_max: n(c[idx('noon_price_max')]) || null,
      seller_price_min: n(c[idx('seller_price_min')]) || null,
      seller_price_max: n(c[idx('seller_price_max')]) || null,
      warranty: c[idx('warranty')] || null,
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
  const idx = (...k: string[]) => ci(headers, ...k)

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
    const idx = (...k: string[]) => ci(h, ...k)
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
        reject_reason: '',
      })
    }
  }
  if (qc) {
    const qd = XLSX.utils.sheet_to_json<any[]>(qc, { header: 1, defval: '' }) as any[][]
    const h = (qd[0] || []).map(x => s(x).toLowerCase())
    const idx = (...k: string[]) => ci(h, ...k)
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
        reject_reason: s(r[idx('reject reason')]) || '',
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
      { table: 'goods_received', rows, conflict: 'merchant_code,platform,asn_number,sku,qc_status,reject_reason' },
    ],
  }
}

// === NOON: Ads ===
export function parseNoonAds(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('quer')) || wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x).toLowerCase())
  const idx = (...k: string[]) => ci(h, ...k)

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
    payloads: [{ table: 'ad_metrics', rows: rows.map(adKeyDefaults), conflict: AD_CONFLICT }],
  }
}

// === TRENDYOL: Account Statement ===
export function parseTrendyolStatement(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets['Detail']
  if (!ws) return errResult('trendyol_statement','trendyol','كشف حساب تراندايول','ورقة Detail غير موجودة')
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x).toLowerCase())
  const idx = (...k: string[]) => ci(h, ...k)

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
      sale_price: n(r[C.price]) || null,
      buybox_price: n(r[ci(h, 'سعر باي بوكس', 'باي بوكس')]) || null,
      commission_rate: n(r[ci(h, 'معدل العمولة', 'العمولة')]) || null,
      vat_rate: n(r[ci(h, 'ضريبة القيمة المضافة', 'ضريبة')]) || null,
      gender: s(r[ci(h, 'نوع الجنس')]) || null,
      supplier_sku: s(r[ci(h, 'رمز مخزون الموردين')]) || null,
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
  // حفظ في جدول platform_deals — barcode/content_id إلى '' (لا null) ليطابقها الفهرس الفريد
  const dealRows = rows.map(r => ({
    merchant_code: merchantCode, platform: 'trendyol',
    product_name: r.product_name, model_code: r.model_code,
    barcode: r.barcode || '',
    category: r.category, brand: r.brand,
    current_stock: r.stock, current_price: r.sale_price || null,
    super_deal_upper_price: r.super_deal_upper || null,
    mega_deal_upper_price: r.mega_deal_upper || null,
    super_deal_commission: r.super_commission || null,
    mega_deal_commission: r.mega_commission || null,
    current_commission: r.current_commission || null,
    end_date: r.end_date ? xlsxDate(r.end_date) : null,
    content_id: r.content_id || r.model_code || r.product_name || '',
    raw: r,
  }))
  return {
    kind: 'trendyol_deals', platform: 'trendyol', label: 'عروض تراندايول',
    summary: { rows: rows.length },
    payloads: [{ table: 'platform_deals', rows: dealRows, conflict: 'merchant_code,platform,barcode,content_id' }],
  }
}

// === TRENDYOL: Ads ===
export function parseTrendyolAds(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets['Reklam Raporu']
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x))
  const idx = (...keys: string[]) => ci(h, ...keys)
  // "إجمالي المبيعات" يتكرر مرتين: الأولى = عدد المبيعات، الثانية = قيمة الإيراد.
  // نأخذ آخر تطابق للإيراد ("عائد الإنفاق الإعلاني" يقع بعده مباشرة).
  const lastIdx = (key: string) => { let f = -1; h.forEach((x, i) => { if (x.includes(key)) f = i }); return f }
  const revenueIdx = lastIdx('إجمالي المبيعات')
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
      revenue: revenueIdx >= 0 ? n(r[revenueIdx]) : 0,
      roas: n(r[idx('عائد الإنفاق الإعلاني')]) || null,
    })
  }
  const totSpend = rows.reduce((a, r) => a + r.spend, 0)
  return {
    kind: 'trendyol_ads', platform: 'trendyol', label: 'إعلانات تراندايول',
    summary: { rows: rows.length, spend: Math.round(totSpend), revenue: Math.round(rows.reduce((a, r) => a + r.revenue, 0)) },
    payloads: [{ table: 'ad_metrics', rows: rows.map(adKeyDefaults), conflict: AD_CONFLICT }],
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
      { table: 'product_performance_snapshots', rows: snapshots, conflict: 'merchant_code,platform,snapshot_date,sku' },
      { table: 'products', rows: products, conflict: 'merchant_code,sku' },
      { table: 'inventory', rows: inventory, conflict: 'merchant_code,sku,platform' },
    ],
  }
}

// === AMAZON: Sponsored Products CAMPAIGN report CSV (campaign-level) ===
// عناوين عربية: الولاية(=المحفظة), اسم الحملة, الحالة, النوع, الاستهداف, إستراتيجية عرض أسعار الحملة,
// تاريخ بداية الحملة, تاريخ انتهاء الحملة, مبلغ ميزانية الحملة, مرات الظهور, النقرات, إجمالي التكلفة, المشتريات, المبيعات, ACOS, ROAS
export function parseAmazonCampaigns(csv: string, merchantCode: string): ParseResult {
  const lines = csv.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return errResult('amazon_campaigns','amazon','حملات أمازون','الملف فارغ')
  const parseLine = (l: string) => l.split(',').map(c => c.trim().replace(/^["']+|["']+$/g, ''))
  const h = parseLine(lines[0]).map(x => x.replace(/^﻿/, '').toLowerCase())
  const idx = (...k: string[]) => ci(h, ...k)
  const today = new Date().toISOString().split('T')[0]
  const rows: any[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i])
    if (c.every(x => !x)) continue
    const name = c[idx('اسم الحملة')] || ''
    if (!name) continue
    rows.push({
      merchant_code: merchantCode, platform: 'amazon', report_date: today,
      campaign_name: name,
      ad_status: c[idx('الحالة')] || '',
      impressions: parseInt(c[idx('مرات الظهور')]) || 0,
      clicks: parseInt(c[idx('النقرات')]) || 0,
      orders: parseInt(c[idx('المشتريات')]) || 0,
      spend: n(c[idx('إجمالي التكلفة')]) || n(c[idx('التكلفة')]),
      revenue: n(c[idx('المبيعات (sar)')]) || n(c[idx('المبيعات')]),
      ctr: n(c[idx('معدل النقر')]) || null,
      cpc: n(c[idx('التكلفة لكل نقرة')]) || null,
      acos: n(c[idx('acos')]) || null,
      roas: n(c[idx('عائد الإنفاق')]) || n(c[idx('roas')]) || null,
      budget_daily: n(c[idx('مبلغ ميزانية الحملة')]) || null,
      currency: 'SAR',
    })
  }
  const totSpend = rows.reduce((a, r) => a + r.spend, 0)
  const totRev   = rows.reduce((a, r) => a + r.revenue, 0)
  return {
    kind: 'amazon_campaigns', platform: 'amazon', label: 'حملات أمازون',
    summary: { rows: rows.length, spend: Math.round(totSpend), revenue: Math.round(totRev), roas: totSpend > 0 ? +(totRev/totSpend).toFixed(2) : 0 },
    payloads: [{ table: 'ad_metrics', rows: rows.map(adKeyDefaults), conflict: AD_CONFLICT }],
  }
}

// === TRENDYOL: Campaign coverage (selected products in a campaign) ===
// أعمدة: campaign product id, barcode, product name, product code, category, brand, color, size
// لا يحوي أرقام أداء — قائمة المنتجات المشمولة بحملة/عرض. نحفظها في platform_deals كتغطية.
export function parseTrendyolCampaignProducts(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const sn = wb.SheetNames.includes('CampaignProducts') ? 'CampaignProducts' : wb.SheetNames[0]
  const ws = wb.Sheets[sn]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  if (data.length < 2) return errResult('trendyol_campaign_products','trendyol','تغطية حملة تراندايول','الملف فارغ')
  const h = (data[0] || []).map(x => s(x))
  const idx = (...keys: string[]) => ci(h, ...keys)
  const C = {
    cpid:    idx('campaign product id'),
    barcode: idx('barcode'),
    name:    idx('product name'),
    code:    idx('product code', 'model code'),
    cat:     idx('category'),
    brand:   idx('brand'),
    color:   idx('color'),
    size:    idx('size'),
  }
  // إزالة تكرار الباركود داخل الملف (platform_deals بلا قيد فريد، فالإدراج مباشر)
  const seen = new Set<string>()
  const rows: any[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    const barcode = s(r[C.barcode])
    const name = s(r[C.name])
    if (!barcode && !name) continue
    const key = barcode || name
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      merchant_code: merchantCode, platform: 'trendyol',
      product_name: name,
      model_code: s(r[C.code]) || null,
      barcode: barcode || '',
      category: s(r[C.cat]) || null,
      brand: s(r[C.brand]) || null,
      content_id: s(r[C.cpid]) || s(r[C.code]) || name || '',
      raw: { color: s(r[C.color]), size: s(r[C.size]), source: 'campaign_coverage' },
    })
  }
  return {
    kind: 'trendyol_campaign_products', platform: 'trendyol', label: 'تغطية حملة تراندايول',
    summary: { products: rows.length },
    payloads: [{ table: 'platform_deals', rows, conflict: 'merchant_code,platform,barcode,content_id' }],
  }
}

// === AMAZON: Settlement ===
export function parseAmazonSettlement(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x).toLowerCase())
  const idx = (...k: string[]) => ci(h, ...k)
  const rows: any[] = []
  const prefixes: string[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    const settlementId  = s(r[idx('settlement-id')])
    const orderItemCode = s(r[idx('order-item-code')])
    rows.push({
      merchant_code: merchantCode, platform: 'amazon',
      settlement_id: settlementId,
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
      promotion_id: s(r[idx('promotion-id')]) || null,
      quantity_purchased: parseInt(s(r[idx('quantity-purchased')])) || null,
      shipment_id: s(r[idx('shipment-id')]) || null,
      settlement_period_start: xlsxDateOnly(r[idx('settlement-start-date')]),
      settlement_period_end:   xlsxDateOnly(r[idx('settlement-end-date')]),
      deposit_date:            xlsxDateOnly(r[idx('deposit-date')]),
    })
    // مفتاح السطر: order-item-code فريد لكل سطر طلب؛ سطور الرسوم العامة (بلا كود)
    // تُميَّز بترتيب تكرارها داخل الملف لتبقى السطور المتطابقة منفصلة.
    prefixes.push(orderItemCode
      ? `s|${settlementId}|${orderItemCode}`
      : `s|${settlementId}|f|${s(r[idx('amount-type')])}|${s(r[idx('amount-description')])}|${s(r[idx('sku')])}|${n(r[idx('amount')])}`)
  }
  stampLineKeys(rows, prefixes)
  const totals = rows.reduce((a, r) => a + r.net_amount, 0)
  return {
    kind: 'amazon_settlement', platform: 'amazon', label: 'تسوية أمازون',
    summary: { rows: rows.length, total: Math.round(totals * 100) / 100 },
    payloads: [{ table: 'account_transactions', rows, conflict: 'merchant_code,platform,transaction_no' }],
  }
}

// === AMAZON: Sales Dashboard (ملخّص إجماليات يومية) ===
// ليست تقريراً تفصيلياً — لوحة جاهزة فيها سلسلة يومية (التاريخ، المبيعات، الوحدات).
// تُحفظ في amazon_daily_sales وتُستخدم كمصدر احتياطي يملأ الأيام التي لا تقرير معاملات لها.
export function parseAmazonSalesDashboard(csv: string, merchantCode: string): ParseResult {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/)
  const parseLine = (l: string): string[] => {
    const out: string[] = []; let cur = '', q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if (ch === ',' && !q) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur); return out.map(x => x.trim())
  }
  // ابحث عن رأس السلسلة اليومية (يبدأ بعمود "التوقيت")
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const first = parseLine(lines[i])[0] || ''
    if (first.replace(/^﻿/, '').trim() === 'التوقيت') { start = i + 1; break }
  }
  if (start < 0) return errResult('amazon_sales_dashboard', 'amazon', 'لوحة مبيعات أمازون', 'تعذّر إيجاد سلسلة المبيعات اليومية في الملف')

  const rows: any[] = []
  for (let i = start; i < lines.length; i++) {
    const c = parseLine(lines[i])
    const dateRaw = c[0] || ''
    // نتوقف عند نهاية القسم (سطر لا يبدأ بتاريخ ISO)
    if (!/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) break
    const dataDate = dateRaw.slice(0, 10)  // تاريخ فقط — بلا تحويل منطقة زمنية يزيح اليوم
    const totalSales = n(c[1])   // مبيعات المنتج المطلوبة (النطاق المحدد)
    const units = parseInt(s(c[2])) || 0
    if (!dataDate) continue
    if (totalSales <= 0 && units <= 0) continue  // تجاهل الأيام بلا مبيعات
    rows.push({ merchant_code: merchantCode, data_date: dataDate, total_sales: totalSales, units })
  }
  const total = rows.reduce((a, r) => a + r.total_sales, 0)
  return {
    kind: 'amazon_sales_dashboard', platform: 'amazon', label: 'لوحة مبيعات أمازون (ملخّص يومي)',
    summary: { days: rows.length, totalSales: Math.round(total) },
    payloads: rows.length === 0
      ? []
      : [{ table: 'amazon_daily_sales', rows, conflict: 'merchant_code,data_date' }],
    error: rows.length === 0 ? 'لا توجد أيام بمبيعات في الملف' : undefined,
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
  const idx = (...k: string[]) => ci(h, ...k)
  const rows: any[] = []
  const prefixes: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i])
    if (c.every(x => !x)) continue
    const row = {
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
    }
    rows.push(row)
    // لا يوجد معرّف سطر في ملف المعاملات، فالمفتاح من الحقول المميِّزة + ترتيب التكرار
    prefixes.push(`t|${row.transaction_date || ''}|${row.transaction_type}|${row.order_id || ''}|${row.amount_description}|${row.net_amount}|${row.debit}|${row.credit}`)
  }
  stampLineKeys(rows, prefixes)
  return {
    kind: 'amazon_transactions', platform: 'amazon', label: 'معاملات أمازون',
    summary: { rows: rows.length, total: rows.reduce((a, r) => a + r.net_amount, 0) },
    payloads: [{ table: 'account_transactions', rows, conflict: 'merchant_code,platform,transaction_no' }],
  }
}

// === AMAZON: Inventory ===
// Amazon's "All Listings" / FBA inventory reports can have multiple rows per
// seller-sku — same SKU listed under different condition-type (New, Used-Good)
// or different fulfillment-channel (DEFAULT/MFN vs AMAZON_*/FBA). The DB
// conflict key is (merchant_code, sku, platform) which collapses these, so we
// aggregate up front: SUM the quantities and keep the highest-quantity row's
// metadata (ASIN, condition). This way total stock is preserved and the
// upsert doesn't hit "ON CONFLICT cannot affect row a second time".
export function parseAmazonInventory(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]
  const h = (data[0] || []).map(x => s(x).toLowerCase())
  const idx = (...k: string[]) => ci(h, ...k)
  const bySku = new Map<string, any>()
  for (let i = 1; i < data.length; i++) {
    const r = data[i]; if (!r || r.every((c: any) => !c)) continue
    const sku = s(r[idx('seller-sku')])
    if (!sku) continue
    const qty = parseInt(s(r[idx('quantity available')])) || 0
    const existing = bySku.get(sku)
    if (existing) {
      existing.quantity += qty
      // Prefer non-empty ASIN/condition if the existing one was blank
      if (!existing.asin) existing.asin = s(r[idx('asin')])
      if (!existing.condition_type) existing.condition_type = s(r[idx('condition-type')])
    } else {
      bySku.set(sku, {
        merchant_code: merchantCode, platform: 'amazon',
        sku, asin: s(r[idx('asin')]),
        product_name: sku,
        condition_type: s(r[idx('condition-type')]),
        fulfillment_channel: 'FBA',
        quantity: qty,
        is_active: true,
      })
    }
  }
  const rows = Array.from(bySku.values())
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
  const idx = (...k: string[]) => ci(h, ...k)
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
      default_bid: n(c[idx('عرض الأسعار الافتراضي')]) || null,
      suggested_bid_low: n(c[idx('عرض الأسعار المقترح (منخفض)')]) || null,
      suggested_bid_med: n(c[idx('عرض الأسعار المقترح (متوسط)')]) || null,
      suggested_bid_high: n(c[idx('عرض الأسعار المقترح (مرتفع)')]) || null,
      keywords_count: parseInt(c[idx('الكلمات الرئيسية')]) || null,
      products_count: parseInt(c[idx('المنتجات')]) || null,
    })
  }
  return {
    kind: 'amazon_ads', platform: 'amazon', label: 'إعلانات أمازون',
    summary: { rows: rows.length, spend: rows.reduce((a, r) => a + r.spend, 0) },
    payloads: [{ table: 'ad_metrics', rows: rows.map(adKeyDefaults), conflict: AD_CONFLICT }],
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
      // ابنِ workbook من نص الـ CSV أيضاً، حتى تعمل المحلّلات المبنية على Excel
      // (مثل إرسالية نون ASN) عندما تُصدَّر تقاريرها بصيغة CSV بدل xlsx.
      try { workbook = XLSX.read(csvText, { type: 'string' }) } catch { /* تبقى المحلّلات النصية تعمل على csvText */ }
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
      case 'amazon_sales_dashboard': return parseAmazonSalesDashboard(csvText!, merchantCode)
      case 'amazon_inventory':     return parseAmazonInventory(workbook!, merchantCode)
      case 'amazon_ads':           return parseAmazonAds(csvText!, merchantCode)
      case 'amazon_campaigns':     return parseAmazonCampaigns(csvText!, merchantCode)
      case 'amazon_listings':      return parseAmazonListings(workbook!, merchantCode)
      case 'trendyol_campaign_products': return parseTrendyolCampaignProducts(workbook!, merchantCode)
      default: {
        // Build a helpful diagnostic so the admin/employee can identify the file
        let diag = ''
        if (workbook) {
          const sheets = workbook.SheetNames
          diag = ' · أوراق الملف: ' + sheets.slice(0, 5).join(', ')
          if (sheets.length > 0) {
            const hStr = findHeaderRow(workbook.Sheets[sheets[0]])
            const headers = hStr.filter(Boolean).slice(0, 8).join(', ')
            if (headers) diag += ' · أول الأعمدة: ' + headers
          }
        } else if (csvText) {
          const firstLine = csvText.split(/\r?\n/)[0].slice(0, 200)
          diag = ' · أول سطر: ' + firstLine
        }
        return errResult('unknown', 'other', file.name,
          'نوع الملف غير معروف — تأكد أنه تقرير رسمي من المنصة' + diag)
      }
    }
  } catch (e: any) {
    return errResult(kind, 'other', file.name, 'خطأ في التحليل: ' + e.message)
  }
}

function errResult(kind: string, platform: string, label: string, error: string): ParseResult {
  return { kind, platform, label, summary: {}, payloads: [], error }
}

// === AMAZON: Listings Template (with filled products) ===
export function parseAmazonListings(wb: XLSX.WorkBook, merchantCode: string): ParseResult {
  const ws = wb.Sheets['Template']
  if (!ws) return errResult('amazon_listings', 'amazon', 'Template', 'ورقة Template غير موجودة')
  const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' }) as any[][]

  // الصف 3 (index) فيه أسماء الحقول
  const fieldRow = data[3] || []
  const idx = (...keys: string[]): number => {
    for (const k of keys) {
      const i = fieldRow.findIndex(f => s(f).toLowerCase() === k.toLowerCase())
      if (i >= 0) return i
    }
    return -1
  }

  const C = {
    sku: idx('SKU'),
    productType: idx('Product Type'),
    action: idx('Listing Action'),
    parentage: idx('Parentage Level'),
    name: idx('Item Name'),
    brand: idx('Brand Name'),
    idType: idx('Product Id Type'),
    barcode: idx('Product Id'),
    browseNode: idx('Recommended Browse Nodes'),
    manufacturer: idx('Manufacturer'),
    mainImage: idx('Main Image URL'),
    description: idx('Product Description'),
    bullet1: idx('Bullet Point'),
    keyword1: idx('Generic Keyword'),
    size: idx('Size'),
  }

  const products: any[] = []
  const inventory: any[] = []

  // المنتجات تبدأ بعد صف الفيلدز + صف الحقول الإضافية
  for (let i = 4; i < data.length; i++) {
    const r = data[i]; if (!r) continue
    const sku = s(r[C.sku])
    const name = s(r[C.name])
    if (!sku || !name) continue
    // تخطّي صفوف الـ schema/help (تحتوي 200+ خلية)
    const filledCount = r.filter(c => c !== '' && c !== null && c !== undefined).length
    if (filledCount > 100) continue

    products.push({
      merchant_code: merchantCode,
      name,
      sku,
      barcode: s(r[C.barcode]) || null,
      brand: s(r[C.brand]) || null,
      category: s(r[C.browseNode]) || null,
      description: s(r[C.description]) || null,
      image_url: s(r[C.mainImage]) || null,
      images: r[C.mainImage] ? [s(r[C.mainImage])] : [],
      size: s(r[C.size]) || null,
      asin: null,  // لا يوجد ASIN في القالب
      external_id: s(r[C.idType]) || null,
      status: 'active',
    })

    inventory.push({
      merchant_code: merchantCode,
      platform: 'amazon',
      sku,
      product_name: name,
      asin: null,
      fulfillment_channel: 'MFN',
      quantity: 0,
      is_active: true,
    })
  }

  return {
    kind: 'amazon_listings',
    platform: 'amazon',
    label: 'قائمة منتجات أمازون',
    summary: { products: products.length, has_data: products.length > 0 },
    payloads: products.length === 0 ? [] : [
      { table: 'products', rows: products, conflict: 'merchant_code,sku' },
      { table: 'inventory', rows: inventory, conflict: 'merchant_code,sku,platform' },
    ],
    error: products.length === 0 ? 'القالب فاضي — لا توجد منتجات. استخدم "مولّد قوائم Amazon" بدل الاستيراد.' : undefined,
  }
}
