import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrendyolProduct {
  barcode: string; product_name: string; sku: string
  category: string; brand: string; color: string; size: string
  total_ordered: number; total_sold: number
  cancelled: number; cancel_rate: number
  returned: number;  return_rate: number; net_sold: number
  gross_revenue: number; discount: number; net_revenue: number
  avg_price: number; current_price: number; stock: number
  // أسباب الإلغاء
  cancel_by_customer: number; cancel_by_trendyol: number; cancel_by_seller: number
  // أسباب الإرجاع
  ret_dislike: number; ret_defective: number; ret_wrong_product: number
  ret_changed_mind: number; ret_other: number; ret_too_small: number
  ret_too_large: number; ret_mismatch: number; ret_wrong_order: number
  ret_bad_quality: number; ret_not_delivered: number; ret_shipping_failed: number
  ret_compensation: number; ret_transit: number; ret_no_tracking: number
  ret_unfulfilled: number; ret_late_delivery: number; ret_no_confirm: number
}

interface BrandRow {
  brand: string; sold: number; cancelled: number; cancel_rate: number
  returned: number; return_rate: number; net_sold: number
  gross: number; discount: number; net_revenue: number; avg_price: number
}

interface CategoryRow {
  category: string; sold: number; cancelled: number; cancel_rate: number
  returned: number; return_rate: number; net_sold: number
  gross: number; discount: number; net_revenue: number; avg_price: number
}

interface TrendyolReport {
  products: TrendyolProduct[]
  brands: BrandRow[]
  categories: CategoryRow[]
  totalGross: number; totalNet: number; totalDiscount: number
  totalSold: number; totalCancelled: number; totalReturned: number
  cancelReasons: { label: string; count: number }[]
  returnReasons: { label: string; count: number }[]
  topProducts: TrendyolProduct[]
  zeroStock: TrendyolProduct[]
  highCancel: TrendyolProduct[]
  qualityIssues: TrendyolProduct[]
  cancelledByTrendyol: TrendyolProduct[]
  mismatchIssues: TrendyolProduct[]
  error?: string
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function ci(headers: string[], ...keys: string[]): number {
  for (const k of keys) {
    const i = headers.findIndex(h => h.includes(k))
    if (i >= 0) return i
  }
  return -1
}

function n(v: any): number { return parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')) || 0 }
function s(v: any): string { return String(v ?? '').trim() }

function parseTrendyolXlsx(buffer: ArrayBuffer): TrendyolReport {
  try {
    const wb = XLSX.read(buffer, { type: 'array' })

    // ── Sheet 1: منتجات ──
    const wsP = wb.Sheets[wb.SheetNames.find(n => n.includes('product')) || wb.SheetNames[0]]
    const rowsP = XLSX.utils.sheet_to_json<any[]>(wsP, { header: 1, defval: '' }) as any[][]
    if (rowsP.length < 2) return emptyReport('الملف فارغ')

    const hP = rowsP[0].map(h => s(h))

    const C = {
      barcode:    ci(hP, 'الباركود', 'barcode'),
      product:    ci(hP, 'اسم المنتج', 'product name'),
      sku:        ci(hP, 'رمز الموديل', 'model'),
      category:   ci(hP, 'الفئة', 'category'),
      brand:      ci(hP, 'الماركة', 'brand'),
      color:      ci(hP, 'اللون', 'color'),
      size:       ci(hP, 'المقاس', 'size'),
      tot_ord:    ci(hP, 'إجمالي كمية الطلبيات'),
      tot_sold:   ci(hP, 'إجمالي المنتجات المباعة'),
      cancelled:  ci(hP, 'المنتجات الملغاة'),
      cxl_rate:   ci(hP, 'نسبة الإلغاءات'),
      returned:   ci(hP, 'المنتجات المرتجعة'),
      ret_rate:   ci(hP, 'نسبة المرتجعات'),
      net_sold:   ci(hP, 'صافي المنتجات المباعة'),
      gross:      ci(hP, 'إجمالي المبيعات'),
      discount:   ci(hP, 'قيمة الخصم'),
      net_rev:    ci(hP, 'صافي الإيرادات'),
      avg_price:  ci(hP, 'متوسط سعر البيع'),
      cur_price:  ci(hP, 'سعر البيع الحالي'),
      stock:      ci(hP, 'المخزون الحالي'),
      // أسباب الإلغاء
      cx_cust:    ci(hP, 'ألغاها العميل'),
      cx_trendyol:ci(hP, 'ألغتها Trendyol', 'طلبيات ألغتها'),
      cx_seller:  ci(hP, 'ألغيتها بنفسي'),
      // أسباب الإرجاع
      r_dislike:  ci(hP, 'لم يعجبني'),
      r_defect:   ci(hP, 'منتج ذو شوائب'),
      r_wrong:    ci(hP, 'منتج غير صحيح'),
      r_mind:     ci(hP, 'غيرت رأيي'),
      r_other:    ci(hP, 'غير ذلك'),
      r_small:    ci(hP, 'صغير للغاية'),
      r_large:    ci(hP, 'كبير للغاية'),
      r_mismatch: ci(hP, 'لا يتطابق مع الصورة'),
      r_wrongord: ci(hP, 'طلبت منتجاً غير صحيح'),
      r_quality:  ci(hP, 'لم تعجبني جودة'),
      r_nodeliv:  ci(hP, 'لم يتم تسليمه'),
      r_ship:     ci(hP, 'تعذّر شحن الطرد'),
      r_comp:     ci(hP, 'التعويضات'),
      r_transit:  ci(hP, 'الإرجاع أثناء النقل'),
      r_track:    ci(hP, 'تعذّر إنشاء رمز التعقّب'),
      r_unfull:   ci(hP, 'غير مستوفاة'),
      r_late:     ci(hP, 'تأخر التسليم'),
      r_noconf:   ci(hP, 'عدم الحصول على تأكيد'),
    }

    if (C.product < 0 || C.net_rev < 0)
      return emptyReport('تعذّر التعرف على الأعمدة — تأكد أنه تقرير تراندايول الرسمي')

    const g = (r: any[], col: number) => col >= 0 ? r[col] : 0

    const products: TrendyolProduct[] = rowsP.slice(1)
      .filter(r => r && !r.every((c: any) => !c))
      .map(r => ({
        barcode: s(g(r, C.barcode)), product_name: s(g(r, C.product)),
        sku: s(g(r, C.sku)), category: s(g(r, C.category)),
        brand: s(g(r, C.brand)), color: s(g(r, C.color)), size: s(g(r, C.size)),
        total_ordered: n(g(r, C.tot_ord)),  total_sold: n(g(r, C.tot_sold)),
        cancelled: n(g(r, C.cancelled)),     cancel_rate: n(g(r, C.cxl_rate)),
        returned: n(g(r, C.returned)),       return_rate: n(g(r, C.ret_rate)),
        net_sold: n(g(r, C.net_sold)),
        gross_revenue: n(g(r, C.gross)),     discount: n(g(r, C.discount)),
        net_revenue: n(g(r, C.net_rev)),     avg_price: n(g(r, C.avg_price)),
        current_price: n(g(r, C.cur_price)), stock: n(g(r, C.stock)),
        cancel_by_customer: n(g(r, C.cx_cust)),
        cancel_by_trendyol: n(g(r, C.cx_trendyol)),
        cancel_by_seller:   n(g(r, C.cx_seller)),
        ret_dislike: n(g(r, C.r_dislike)),  ret_defective: n(g(r, C.r_defect)),
        ret_wrong_product: n(g(r, C.r_wrong)), ret_changed_mind: n(g(r, C.r_mind)),
        ret_other: n(g(r, C.r_other)),      ret_too_small: n(g(r, C.r_small)),
        ret_too_large: n(g(r, C.r_large)),  ret_mismatch: n(g(r, C.r_mismatch)),
        ret_wrong_order: n(g(r, C.r_wrongord)), ret_bad_quality: n(g(r, C.r_quality)),
        ret_not_delivered: n(g(r, C.r_nodeliv)), ret_shipping_failed: n(g(r, C.r_ship)),
        ret_compensation: n(g(r, C.r_comp)), ret_transit: n(g(r, C.r_transit)),
        ret_no_tracking: n(g(r, C.r_track)), ret_unfulfilled: n(g(r, C.r_unfull)),
        ret_late_delivery: n(g(r, C.r_late)), ret_no_confirm: n(g(r, C.r_noconf)),
      }))

    // ── Sheet 2: ماركات ──
    const wsB = wb.Sheets[wb.SheetNames.find(n => n.includes('brand')) || '']
    const brands: BrandRow[] = wsB
      ? (XLSX.utils.sheet_to_json<any[]>(wsB, { header: 1, defval: '' }) as any[][])
          .slice(1).filter(r => r[0])
          .map(r => ({
            brand: s(r[0]), sold: n(r[1]), cancelled: n(r[2]), cancel_rate: n(r[3]),
            returned: n(r[4]), return_rate: n(r[5]), net_sold: n(r[6]),
            gross: n(r[7]), discount: n(r[8]), net_revenue: n(r[9]), avg_price: n(r[10]),
          }))
      : []

    // ── Sheet 3: فئات ──
    const wsC = wb.Sheets[wb.SheetNames.find(n => n.includes('category')) || '']
    const categories: CategoryRow[] = wsC
      ? (XLSX.utils.sheet_to_json<any[]>(wsC, { header: 1, defval: '' }) as any[][])
          .slice(1).filter(r => r[0])
          .map(r => ({
            category: s(r[0]), sold: n(r[1]), cancelled: n(r[2]), cancel_rate: n(r[3]),
            returned: n(r[4]), return_rate: n(r[5]), net_sold: n(r[6]),
            gross: n(r[7]), discount: n(r[8]), net_revenue: n(r[9]), avg_price: n(r[10]),
          }))
      : []

    // ── إجماليات ──
    const totalGross    = products.reduce((s, p) => s + p.gross_revenue, 0)
    const totalNet      = products.reduce((s, p) => s + p.net_revenue,   0)
    const totalDiscount = products.reduce((s, p) => s + p.discount,      0)
    const totalSold     = products.reduce((s, p) => s + p.net_sold,      0)
    const totalCancelled = products.reduce((s, p) => s + p.cancelled,    0)
    const totalReturned  = products.reduce((s, p) => s + p.returned,     0)

    // ── أسباب الإلغاء ──
    const cancelReasons = [
      { label: 'ألغاها العميل',         count: products.reduce((s, p) => s + p.cancel_by_customer,  0) },
      { label: 'ألغتها تراندايول',       count: products.reduce((s, p) => s + p.cancel_by_trendyol, 0) },
      { label: 'ألغيتها أنت',           count: products.reduce((s, p) => s + p.cancel_by_seller,    0) },
    ].filter(r => r.count > 0)

    // ── أسباب الإرجاع ──
    const returnReasons = [
      { label: 'لم يعجبني',                    count: products.reduce((s, p) => s + p.ret_dislike,       0) },
      { label: 'منتج معيب',                    count: products.reduce((s, p) => s + p.ret_defective,     0) },
      { label: 'منتج غير صحيح',               count: products.reduce((s, p) => s + p.ret_wrong_product, 0) },
      { label: 'غيّر رأيه',                   count: products.reduce((s, p) => s + p.ret_changed_mind,  0) },
      { label: 'لا يطابق الصورة/الوصف',       count: products.reduce((s, p) => s + p.ret_mismatch,      0) },
      { label: 'جودة سيئة',                   count: products.reduce((s, p) => s + p.ret_bad_quality,   0) },
      { label: 'لم يُسلَّم',                  count: products.reduce((s, p) => s + p.ret_not_delivered, 0) },
      { label: 'فشل الشحن',                   count: products.reduce((s, p) => s + p.ret_shipping_failed,0) },
      { label: 'صغير للغاية',                 count: products.reduce((s, p) => s + p.ret_too_small,     0) },
      { label: 'كبير للغاية',                 count: products.reduce((s, p) => s + p.ret_too_large,     0) },
      { label: 'طلّب منتج خاطئ',             count: products.reduce((s, p) => s + p.ret_wrong_order,   0) },
      { label: 'تأخر التسليم',                count: products.reduce((s, p) => s + p.ret_late_delivery, 0) },
      { label: 'غير مستوفى',                  count: products.reduce((s, p) => s + p.ret_unfulfilled,   0) },
      { label: 'إرجاع أثناء النقل',           count: products.reduce((s, p) => s + p.ret_transit,       0) },
      { label: 'بدون رمز تتبع',              count: products.reduce((s, p) => s + p.ret_no_tracking,   0) },
      { label: 'لا تأكيد من العميل',          count: products.reduce((s, p) => s + p.ret_no_confirm,   0) },
      { label: 'تعويضات',                     count: products.reduce((s, p) => s + p.ret_compensation,  0) },
      { label: 'غير ذلك',                     count: products.reduce((s, p) => s + p.ret_other,         0) },
    ].filter(r => r.count > 0).sort((a, b) => b.count - a.count)

    // ── قوائم التنبيهات ──
    const topProducts        = [...products].filter(p => p.net_revenue > 0).sort((a, b) => b.net_revenue - a.net_revenue).slice(0, 5)
    const zeroStock          = products.filter(p => p.stock === 0 && p.net_sold > 0)
    const highCancel         = products.filter(p => p.cancel_rate >= 30 && p.total_sold > 0)
    const qualityIssues      = products.filter(p => (p.ret_bad_quality + p.ret_defective) > 0)
    const cancelledByTrendyol = products.filter(p => p.cancel_by_trendyol > 0)
    const mismatchIssues     = products.filter(p => p.ret_mismatch > 0)

    return {
      products, brands, categories,
      totalGross, totalNet, totalDiscount, totalSold, totalCancelled, totalReturned,
      cancelReasons, returnReasons,
      topProducts, zeroStock, highCancel, qualityIssues, cancelledByTrendyol, mismatchIssues,
    }
  } catch (e: any) {
    return emptyReport('خطأ في قراءة الملف: ' + e.message)
  }
}

function emptyReport(error: string): TrendyolReport {
  return {
    products: [], brands: [], categories: [],
    totalGross: 0, totalNet: 0, totalDiscount: 0,
    totalSold: 0, totalCancelled: 0, totalReturned: 0,
    cancelReasons: [], returnReasons: [],
    topProducts: [], zeroStock: [], highCancel: [],
    qualityIssues: [], cancelledByTrendyol: [], mismatchIssues: [],
    error,
  }
}

// ─── CSV Parser (نون / أمازون) ────────────────────────────────────────────────

interface ParsedOrder {
  order_id: string; status: string; total_amount: number
  product_name: string; order_date: string; quantity: number
}
interface ParsedReport {
  rows: ParsedOrder[]; totalSales: number; orderCount: number
  dateRange: { from: string; to: string }; error?: string
}

function parseOrderDate(raw: string): string {
  if (!raw) return new Date().toISOString()
  const d = new Date(raw)
  if (!isNaN(d.getTime())) return d.toISOString()
  const m = raw.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3]
    return new Date(`${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`).toISOString()
  }
  return new Date().toISOString()
}

function mapStatus(raw: string): string {
  const r = raw?.toLowerCase().trim() || ''
  if (['delivered','تم التسليم','مكتمل','completed'].some(x => r.includes(x))) return 'delivered'
  if (['cancel','ملغي','cancelled','canceled'].some(x => r.includes(x)))        return 'cancelled'
  if (['return','مسترجع','returned'].some(x => r.includes(x)))                  return 'returned'
  if (['ship','شحن','shipped'].some(x => r.includes(x)))                        return 'shipped'
  return 'pending'
}

function parseCSV(text: string): ParsedReport {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return { rows: [], totalSales: 0, orderCount: 0, dateRange: { from: '', to: '' }, error: 'الملف فارغ' }
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const parse = (l: string) => l.split(sep).map(c => c.trim().replace(/^["']+|["']+$/g, ''))
  const headers = parse(lines[0]).map(h => h.toLowerCase())
  const find = (...ps: string[]) => { for (const p of ps) { const i = headers.findIndex(h => h.includes(p)); if (i >= 0) return i } return -1 }
  const cId = find('order number','order id','رقم الطلب','order_id')
  const cDate = find('order date','created date','date','تاريخ')
  const cStatus = find('status','order status','الحالة')
  const cTotal = find('total amount','gross amount','total price','المبلغ','الإجمالي','total','amount')
  const cProd = find('product name','item name','product','اسم المنتج','product_name')
  const cQty = find('quantity','qty','الكمية')
  const rows: ParsedOrder[] = []; let totalSales = 0
  for (let i = 1; i < lines.length; i++) {
    const cols = parse(lines[i])
    if (cols.length < 2 || cols.every(c => !c)) continue
    const total = cTotal >= 0 ? parseFloat(cols[cTotal]?.replace(/[^0-9.,]/g,'').replace(',','.')) || 0 : 0
    rows.push({
      order_id:     cId     >= 0 ? cols[cId] || `ROW-${i}` : `ROW-${i}`,
      status:       cStatus >= 0 ? mapStatus(cols[cStatus]) : 'delivered',
      total_amount: total,
      product_name: cProd   >= 0 ? cols[cProd] || '' : '',
      order_date:   cDate   >= 0 ? parseOrderDate(cols[cDate]) : new Date().toISOString(),
      quantity:     cQty    >= 0 ? parseInt(cols[cQty]) || 1 : 1,
    })
    totalSales += total
  }
  const dates = rows.map(r => r.order_date).sort()
  return { rows, totalSales, orderCount: rows.length, dateRange: { from: dates[0]?.split('T')[0] || '', to: dates[dates.length-1]?.split('T')[0] || '' } }
}

// ─── Salla Card ───────────────────────────────────────────────────────────────

function SallaCard({ merchant }: { merchant: Merchant | null }) {
  const [conn, setConn] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const isConnected = !!merchant?.salla_store_id

  useEffect(() => {
    if (!merchant?.merchant_code) { setLoading(false); return }
    supabase.from('salla_connections').select('*').eq('merchant_code', merchant.merchant_code).maybeSingle()
      .then(({ data }) => { setConn(data); setLoading(false) })
  }, [merchant?.merchant_code])

  async function requestSync() {
    if (!merchant) return; setSyncing(true)
    await supabase.from('sync_queue').insert({ merchant_code: merchant.merchant_code, platform: 'salla', job_type: 'sync_all', priority: 1, status: 'pending', scheduled_at: new Date().toISOString() })
    setMsg('✅ تم جدولة المزامنة — ستظهر البيانات خلال دقيقة'); setSyncing(false)
    setTimeout(() => setMsg(''), 4000)
  }

  if (loading) return null

  return (
    <div style={{ background: isConnected ? 'linear-gradient(135deg,rgba(0,184,148,0.06),rgba(94,204,138,0.04))' : 'var(--surface)', border: `1px solid ${isConnected ? 'rgba(0,184,148,0.25)' : 'var(--border)'}`, borderRadius: 16, padding: '20px 24px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: isConnected ? 'linear-gradient(90deg,#5ecc8a,#00b894)' : 'var(--border2)', borderRadius: '16px 16px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(0,184,148,0.1)', border: '1px solid rgba(0,184,148,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>🟢</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>سلة</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, background: isConnected ? 'rgba(0,184,148,0.1)' : 'rgba(232,64,64,0.08)', color: isConnected ? '#00b894' : '#e84040', border: `1px solid ${isConnected ? 'rgba(0,184,148,0.25)' : 'rgba(232,64,64,0.15)'}` }}>
                {isConnected ? '✓ متصل' : 'غير مربوط'}
              </span>
            </div>
            {isConnected && conn
              ? <div style={{ fontSize: 12, color: 'var(--text2)' }}><span style={{ fontWeight: 600 }}>{conn.store_name}</span>{conn.store_domain && <span style={{ color: 'var(--text3)', marginRight: 6 }}>· {conn.store_domain}</span>}</div>
              : <div style={{ fontSize: 12, color: 'var(--text3)' }}>ثبّت تطبيق Sellpert من متجر تطبيقات سلة</div>
            }
          </div>
        </div>
        {isConnected
          ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {msg && <span style={{ fontSize: 12, color: '#00b894', fontWeight: 600 }}>{msg}</span>}
              <button onClick={requestSync} disabled={syncing} style={{ background: 'rgba(0,184,148,0.1)', border: '1px solid rgba(0,184,148,0.25)', color: '#00b894', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>
                {syncing ? '⟳ جارٍ...' : '⟳ مزامنة الآن'}
              </button>
            </div>
          : <a href="https://salla.sa/apps" target="_blank" rel="noopener noreferrer" style={{ background: 'linear-gradient(135deg,#00b894,#00d4a8)', border: 'none', color: '#fff', padding: '11px 22px', borderRadius: 12, fontSize: 13, fontWeight: 800, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              🟢 تثبيت التطبيق في سلة
            </a>
        }
      </div>
    </div>
  )
}

// ─── Trendyol Upload Card ─────────────────────────────────────────────────────

const COLOR = '#f27a1a'

function TrendyolUploadCard({ merchant }: { merchant: Merchant | null }) {
  const [report, setReport]         = useState<TrendyolReport | null>(null)
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null)
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0])
  const [activeTab, setActiveTab]   = useState<'summary'|'products'|'brands'|'categories'|'reasons'>('summary')

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setMsg(null); setActiveTab('summary')
    const reader = new FileReader()
    reader.onload = ev => setReport(parseTrendyolXlsx(ev.target?.result as ArrayBuffer))
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  async function save() {
    if (!merchant || !report || report.products.length === 0) return
    setSaving(true); setMsg(null)
    try {
      // حذف البيانات القديمة لنفس التاجر / المنصة / التاريخ أولاً
      const { error: delErr } = await supabase.from('performance_data')
        .delete()
        .eq('merchant_code', merchant.merchant_code)
        .eq('platform', 'trendyol')
        .eq('data_date', reportDate)
      if (delErr) throw delErr

      const rows = report.products.map(p => ({
        merchant_code: merchant.merchant_code,
        platform: 'trendyol', data_date: reportDate,
        product_name: p.product_name,
        total_sales: p.net_revenue, order_count: p.net_sold,
        margin: p.gross_revenue > 0 ? Math.round((p.net_revenue / p.gross_revenue) * 1000) / 10 : 0,
        ad_spend: 0, platform_fees: p.discount,
      }))

      const { error: insErr } = await supabase.from('performance_data').insert(rows)
      if (insErr) throw insErr

      setMsg({ text: `✅ تم حفظ ${report.products.length} منتج`, ok: true })
      setReport(null)
    } catch (e: any) { setMsg({ text: `❌ ${e.message}`, ok: false }) }
    setSaving(false)
  }

  const btn: React.CSSProperties = { border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', fontFamily: 'inherit' }
  const tab = (key: typeof activeTab, label: string) => (
    <button onClick={() => setActiveTab(key)} style={{ ...btn, background: activeTab === key ? COLOR : 'var(--surface2)', color: activeTab === key ? '#fff' : 'var(--text2)', border: activeTab === key ? 'none' : '1px solid var(--border)' }}>{label}</button>
  )

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${COLOR}30`, borderRadius: 16, padding: '18px 22px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: COLOR, borderRadius: '16px 16px 0 0' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🟠</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>تراندايول</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>تقرير المبيعات بالمنتج (Sales by Product)</div>
          </div>
        </div>
        {!report && (
          <label style={{ ...btn, background: COLOR, color: '#fff', display: 'inline-block', cursor: 'pointer', boxShadow: `0 3px 12px ${COLOR}40` }}>
            📂 ارفع تقرير Excel
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} />
          </label>
        )}
      </div>

      {/* Steps */}
      {!report && (
        <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: COLOR + '08', border: `1px solid ${COLOR}20` }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: COLOR, marginBottom: 8 }}>كيف تصدّر التقرير:</div>
          {['افتح seller.trendyol.com', 'التقارير ← تقارير المبيعات ← مبيعات حسب المنتج', 'حدد الفترة الزمنية', 'اضغط تحميل Excel'].map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <span style={{ minWidth: 18, height: 18, borderRadius: '50%', background: COLOR + '20', color: COLOR, fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {report?.error && (
        <div style={{ fontSize: 12, color: '#e84040', padding: '10px 14px', borderRadius: 9, background: 'rgba(232,64,64,0.08)', border: '1px solid rgba(232,64,64,0.2)', marginBottom: 10 }}>
          ❌ {report.error}
          <button onClick={() => setReport(null)} style={{ marginRight: 10, background: 'transparent', border: 'none', color: '#e84040', cursor: 'pointer', fontWeight: 700 }}>إعادة المحاولة</button>
        </div>
      )}

      {/* Report Tabs */}
      {report && !report.error && report.products.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tab('summary',    '📊 ملخص')}
            {tab('products',   `📦 المنتجات (${report.products.length})`)}
            {tab('brands',     `🏷️ الماركات (${report.brands.length})`)}
            {tab('categories', `📁 الفئات (${report.categories.length})`)}
            {tab('reasons',    '🔍 أسباب الإلغاء والإرجاع')}
          </div>

          {/* ── Tab: ملخص ── */}
          {activeTab === 'summary' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {[
                  { label: 'إجمالي المبيعات',    value: report.totalGross.toLocaleString()    + ' ر.س', c: COLOR },
                  { label: 'صافي الإيرادات',     value: report.totalNet.toLocaleString()      + ' ر.س', c: '#00e5b0' },
                  { label: 'إجمالي الخصومات',    value: report.totalDiscount.toLocaleString() + ' ر.س', c: '#ff9900' },
                  { label: 'وحدات مباعة (صافي)', value: report.totalSold.toString(),                     c: '#7c6bff' },
                  { label: 'ملغاة',              value: report.totalCancelled.toString(),                c: '#e84040' },
                  { label: 'مرتجعة',             value: report.totalReturned.toString(),                 c: '#ff6b6b' },
                ].map(k => (
                  <div key={k.label} style={{ background: 'var(--surface2)', borderRadius: 12, padding: '12px 14px', border: `1px solid ${k.c}20` }}>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, fontWeight: 600 }}>{k.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: k.c }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* أفضل المنتجات */}
              <SectionTable title="🏆 أفضل 5 منتجات" headers={['المنتج','الفئة','مبيع','إجمالي','صافي','مخزون']}>
                {report.topProducts.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <Td bold>{p.product_name}</Td>
                    <Td muted small>{p.category}</Td>
                    <Td>{p.net_sold}</Td>
                    <Td>{p.gross_revenue.toLocaleString()}</Td>
                    <Td color="#00e5b0" bold>{p.net_revenue.toLocaleString()}</Td>
                    <Td><StockBadge v={p.stock} /></Td>
                  </tr>
                ))}
              </SectionTable>

              {/* تنبيهات */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <AlertBox title={`⚠️ إلغاءات عالية (${report.highCancel.length})`} color="#e84040" items={report.highCancel.map(p => ({ name: p.product_name, value: p.cancel_rate + '%' }))} />
                <AlertBox title={`📦 نفد المخزون وكان يُباع (${report.zeroStock.length})`} color="#ff9900" items={report.zeroStock.map(p => ({ name: p.product_name, value: p.net_sold + ' مبيع' }))} />
                <AlertBox title={`❗ ألغتها تراندايول (${report.cancelledByTrendyol.length})`} color="#a598ff" items={report.cancelledByTrendyol.map(p => ({ name: p.product_name, value: p.cancel_by_trendyol + '' }))} />
                <AlertBox title={`🖼️ لا يطابق الصورة/الوصف (${report.mismatchIssues.length})`} color="#4cc9f0" items={report.mismatchIssues.map(p => ({ name: p.product_name, value: p.ret_mismatch + '' }))} />
                <AlertBox title={`🔧 شكاوى جودة (${report.qualityIssues.length})`} color="#ff6b6b" items={report.qualityIssues.map(p => ({ name: p.product_name, value: (p.ret_bad_quality + p.ret_defective) + '' }))} />
              </div>
            </div>
          )}

          {/* ── Tab: المنتجات ── */}
          {activeTab === 'products' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)' }}>
                    {['المنتج','الماركة','الفئة','مطلوب','مبيع','ملغي','%إلغاء','مرتجع','%إرجاع','صافي مبيع','إجمالي','خصم','صافي إيراد','سعر متوسط','سعر حالي','مخزون'].map(h => (
                      <th key={h} style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text3)', fontWeight: 700, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{p.product_name}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{p.brand}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text3)', whiteSpace: 'nowrap', fontSize: 10 }}>{p.category}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text2)' }}>{p.total_ordered}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text2)' }}>{p.total_sold}</td>
                      <td style={{ padding: '7px 10px', color: p.cancelled > 0 ? '#e84040' : 'var(--text3)' }}>{p.cancelled}</td>
                      <td style={{ padding: '7px 10px', fontWeight: p.cancel_rate >= 30 ? 800 : 400, color: p.cancel_rate >= 30 ? '#e84040' : 'var(--text3)' }}>{p.cancel_rate > 0 ? p.cancel_rate + '%' : '—'}</td>
                      <td style={{ padding: '7px 10px', color: p.returned > 0 ? '#ff6b6b' : 'var(--text3)' }}>{p.returned}</td>
                      <td style={{ padding: '7px 10px', color: p.return_rate >= 30 ? '#ff6b6b' : 'var(--text3)' }}>{p.return_rate > 0 ? p.return_rate + '%' : '—'}</td>
                      <td style={{ padding: '7px 10px', fontWeight: 700 }}>{p.net_sold}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text2)' }}>{p.gross_revenue.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', color: '#ff9900' }}>{p.discount > 0 ? p.discount.toLocaleString() : '—'}</td>
                      <td style={{ padding: '7px 10px', fontWeight: 800, color: '#00e5b0' }}>{p.net_revenue.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text2)' }}>{p.avg_price.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text2)' }}>{p.current_price > 0 ? p.current_price.toLocaleString() : '—'}</td>
                      <td style={{ padding: '7px 10px' }}><StockBadge v={p.stock} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tab: الماركات ── */}
          {activeTab === 'brands' && (
            <SectionTable title="أداء الماركات" headers={['الماركة','مبيع','ملغي','%إلغاء','مرتجع','صافي','إجمالي','خصم','صافي إيراد','متوسط سعر']}>
              {report.brands.map((b, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <Td bold>{b.brand}</Td>
                  <Td>{b.sold}</Td>
                  <Td color={b.cancelled > 0 ? '#e84040' : undefined}>{b.cancelled}</Td>
                  <Td color={b.cancel_rate >= 30 ? '#e84040' : undefined} bold={b.cancel_rate >= 30}>{b.cancel_rate > 0 ? b.cancel_rate + '%' : '—'}</Td>
                  <Td color={b.returned > 0 ? '#ff6b6b' : undefined}>{b.returned}</Td>
                  <Td>{b.net_sold}</Td>
                  <Td>{b.gross.toLocaleString()}</Td>
                  <Td color={b.discount > 0 ? '#ff9900' : undefined}>{b.discount > 0 ? b.discount.toLocaleString() : '—'}</Td>
                  <Td color="#00e5b0" bold>{b.net_revenue.toLocaleString()}</Td>
                  <Td>{b.avg_price.toLocaleString()}</Td>
                </tr>
              ))}
            </SectionTable>
          )}

          {/* ── Tab: الفئات ── */}
          {activeTab === 'categories' && (
            <SectionTable title="أداء الفئات" headers={['الفئة','مبيع','ملغي','%إلغاء','مرتجع','صافي','إجمالي','خصم','صافي إيراد','متوسط سعر']}>
              {[...report.categories].sort((a, b) => b.net_revenue - a.net_revenue).map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <Td bold>{c.category}</Td>
                  <Td>{c.sold}</Td>
                  <Td color={c.cancelled > 0 ? '#e84040' : undefined}>{c.cancelled}</Td>
                  <Td color={c.cancel_rate >= 30 ? '#e84040' : undefined} bold={c.cancel_rate >= 30}>{c.cancel_rate > 0 ? c.cancel_rate + '%' : '—'}</Td>
                  <Td color={c.returned > 0 ? '#ff6b6b' : undefined}>{c.returned}</Td>
                  <Td>{c.net_sold}</Td>
                  <Td>{c.gross.toLocaleString()}</Td>
                  <Td color={c.discount > 0 ? '#ff9900' : undefined}>{c.discount > 0 ? c.discount.toLocaleString() : '—'}</Td>
                  <Td color="#00e5b0" bold>{c.net_revenue.toLocaleString()}</Td>
                  <Td>{c.avg_price.toLocaleString()}</Td>
                </tr>
              ))}
            </SectionTable>
          )}

          {/* ── Tab: أسباب الإلغاء والإرجاع ── */}
          {activeTab === 'reasons' && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#e84040', marginBottom: 8 }}>أسباب الإلغاء</div>
                {report.cancelReasons.length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--text3)' }}>لا توجد إلغاءات</div>
                  : report.cancelReasons.map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      <span style={{ color: 'var(--text)' }}>{r.label}</span>
                      <span style={{ fontWeight: 800, color: '#e84040' }}>{r.count}</span>
                    </div>
                  ))
                }
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#ff6b6b', marginBottom: 8 }}>أسباب الإرجاع</div>
                {report.returnReasons.length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--text3)' }}>لا توجد مرتجعات</div>
                  : report.returnReasons.map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      <span style={{ color: 'var(--text)' }}>{r.label}</span>
                      <span style={{ fontWeight: 800, color: '#ff6b6b' }}>{r.count}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* Save bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>تاريخ التقرير:</label>
              <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: 8, fontSize: 12, outline: 'none', fontFamily: 'inherit' }} />
            </div>
            <button onClick={() => { setReport(null); setMsg(null) }} style={{ border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', background: 'var(--surface2)', color: 'var(--text2)', fontFamily: 'inherit' }}>✕ إلغاء</button>
            <button onClick={save} disabled={saving} style={{ border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', background: COLOR, color: '#fff', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
              {saving ? '⟳ جارٍ الحفظ...' : `💾 حفظ ${report.products.length} منتج`}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, padding: '10px 14px', borderRadius: 9, background: msg.ok ? 'rgba(0,184,148,0.08)' : 'rgba(232,64,64,0.08)', border: `1px solid ${msg.ok ? 'rgba(0,184,148,0.2)' : 'rgba(232,64,64,0.2)'}`, color: msg.ok ? '#00b894' : '#e84040' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}

// ─── Helper Components ────────────────────────────────────────────────────────

function SectionTable({ title, headers, children }: { title: string; headers: string[]; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', background: 'var(--surface2)', fontSize: 12, fontWeight: 800, color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {headers.map(h => <th key={h} style={{ padding: '7px 12px', textAlign: 'right', color: 'var(--text3)', fontWeight: 700, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  )
}

function Td({ children, bold, muted, small, color }: { children: React.ReactNode; bold?: boolean; muted?: boolean; small?: boolean; color?: string }) {
  return (
    <td style={{ padding: '8px 12px', color: color || (muted ? 'var(--text3)' : 'var(--text)'), fontWeight: bold ? 700 : 400, fontSize: small ? 10 : 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {children}
    </td>
  )
}

function StockBadge({ v }: { v: number }) {
  const c = v === 0 ? '#e84040' : v <= 5 ? '#ff9900' : '#00e5b0'
  return <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: c + '18', color: c }}>{v === 0 ? 'نفد' : v}</span>
}

function AlertBox({ title, color, items }: { title: string; color: string; items: { name: string; value: string }[] }) {
  if (items.length === 0) return null
  return (
    <div style={{ flex: 1, minWidth: 200, borderRadius: 12, border: `1px solid ${color}25`, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: color + '10', fontSize: 11, fontWeight: 800, color, borderBottom: `1px solid ${color}20` }}>{title}</div>
      {items.map((item, i) => (
        <div key={i} style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
          <span style={{ fontWeight: 800, color, flexShrink: 0 }}>{item.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── نون / أمازون Upload ──────────────────────────────────────────────────────

const OTHER_PLATFORMS = [
  { value: 'noon',   label: 'نون 🟡',    color: '#e6b800', steps: ['افتح Noon Seller Lab', 'Orders → All Orders', 'اضغط Export واختر الفترة', 'ارفع الملف هنا'] },
  { value: 'amazon', label: 'أمازون 📦', color: '#e68a00', steps: ['افتح Amazon Seller Central', 'Reports → Business Reports', 'اختر التقرير وحدد الفترة', 'ارفع الملف هنا'] },
]

function OtherPlatformCard({ merchant }: { merchant: Merchant | null }) {
  const [platform, setPlatform] = useState('noon')
  const [parsed, setParsed]     = useState<ParsedReport | null>(null)
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState<{ text: string; ok: boolean } | null>(null)
  const selected = OTHER_PLATFORMS.find(p => p.value === platform)!
  const btn: React.CSSProperties = { border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', fontFamily: 'inherit' }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return; setMsg(null)
    const reader = new FileReader()
    reader.onload = ev => setParsed(parseCSV(ev.target?.result as string))
    reader.readAsText(file, 'utf-8'); e.target.value = ''
  }

  async function save() {
    if (!merchant || !parsed || parsed.rows.length === 0) return
    setSaving(true); setMsg(null)
    try {
      const { error } = await supabase.from('orders').upsert(
        parsed.rows.map(r => ({
          merchant_code: merchant.merchant_code, platform,
          order_id: r.order_id, status: r.status,
          product_name: r.product_name || null, quantity: r.quantity,
          unit_price: r.quantity > 0 ? Math.round(r.total_amount / r.quantity) : r.total_amount,
          total_amount: r.total_amount, platform_fee: 0, shipping_cost: 0,
          currency: merchant.currency || 'SAR', order_date: r.order_date,
        })),
        { onConflict: 'merchant_code,platform,order_id', ignoreDuplicates: false }
      )
      if (error) throw error
      setMsg({ text: `✅ تم حفظ ${parsed.orderCount} طلب — جارٍ الانتقال للطلبات...`, ok: true })
      setParsed(null)
      setTimeout(() => {
        window.history.pushState(null, '', '/orders')
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, 1400)
    } catch (e: any) { setMsg({ text: `❌ ${e.message}`, ok: false }) }
    setSaving(false)
  }

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${selected.color}30`, borderRadius: 16, padding: '18px 22px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 3, background: selected.color, borderRadius: '16px 16px 0 0', opacity: 0.7 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>📤 رفع تقرير مبيعات</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>صدّر التقرير من المنصة وارفعه هنا</div>
        </div>
        <select value={platform} onChange={e => { setPlatform(e.target.value); setParsed(null); setMsg(null) }}
          style={{ background: 'var(--surface2)', border: `1px solid ${selected.color}40`, borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, color: 'var(--text)', cursor: 'pointer', outline: 'none' }}>
          {OTHER_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      {!parsed && (
        <>
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: selected.color + '08', border: `1px solid ${selected.color}20` }}>
            {selected.steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <span style={{ minWidth: 18, height: 18, borderRadius: '50%', background: selected.color + '20', color: selected.color, fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{s}</span>
              </div>
            ))}
          </div>
          <label style={{ ...btn, background: selected.color, color: '#fff', display: 'inline-block', cursor: 'pointer' }}>
            📂 ارفع ملف CSV أو Excel
            <input type="file" accept=".csv,.xlsx,.xls,.txt,.tsv" style={{ display: 'none' }} onChange={handleFile} />
          </label>
        </>
      )}
      {parsed && !parsed.error && parsed.orderCount > 0 && (
        <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(0,184,148,0.05)', border: '1px solid rgba(0,184,148,0.2)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#00b894', marginBottom: 8 }}>✅ {parsed.orderCount} طلب — {parsed.totalSales.toLocaleString()} {merchant?.currency || 'SAR'}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setParsed(null); setMsg(null) }} style={{ ...btn, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)' }}>✕ إلغاء</button>
            <button onClick={save} disabled={saving} style={{ ...btn, background: selected.color, color: '#fff', opacity: saving ? 0.7 : 1 }}>
              {saving ? '⟳ جارٍ...' : `💾 حفظ ${parsed.orderCount} طلب`}
            </button>
          </div>
        </div>
      )}
      {parsed?.error && <div style={{ fontSize: 12, color: '#e84040', padding: '10px 14px', borderRadius: 9, background: 'rgba(232,64,64,0.08)' }}>{parsed.error}</div>}
      {msg && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, padding: '10px 14px', borderRadius: 9, background: msg.ok ? 'rgba(0,184,148,0.08)' : 'rgba(232,64,64,0.08)', color: msg.ok ? '#00b894' : '#e84040' }}>{msg.text}</div>}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Integrations({ merchant }: { merchant: Merchant | null }) {
  return (
    <div style={{ padding: '28px 32px', minHeight: '100vh', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>ربط المنصات</h2>
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>سلة بربط مباشر — تراندايول ونون وأمازون برفع التقارير</p>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px' }}>ربط مباشر</div>
        <SallaCard merchant={merchant} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>رفع تقارير</div>
        <TrendyolUploadCard merchant={merchant} />
        <OtherPlatformCard  merchant={merchant} />
      </div>
    </div>
  )
}
