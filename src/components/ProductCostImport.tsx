import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { supabase, type Product } from '../lib/supabase'
import './ProductCostImport.css'

type CostRow = { identifier: string; cost_price: string; row: number }
type ImportResult = {
  updated_count: number
  unmatched_identifiers: string[]
  ambiguous_identifiers: string[]
  invalid_rows: number
}

const IDENTIFIER_HEADERS = ['sku', 'seller sku', 'merchant sku', 'barcode', 'product code', 'رمز المنتج', 'رمز التاجر', 'الباركود', 'باركود']
const COST_HEADERS = ['cost', 'cost price', 'unit cost', 'purchase cost', 'cost_price', 'التكلفة', 'سعر التكلفة', 'تكلفة الشراء', 'تكلفة الوحدة']

function normalizeHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function valueFor(row: Record<string, unknown>, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizeHeader))
  const key = Object.keys(row).find(header => wanted.has(normalizeHeader(header)))
  return key ? String(row[key] ?? '').trim() : ''
}

export function parseProductCostRows(rawRows: Record<string, unknown>[]): CostRow[] {
  return rawRows.map((row, index) => ({
    identifier: valueFor(row, IDENTIFIER_HEADERS),
    cost_price: valueFor(row, COST_HEADERS),
    row: index + 2,
  }))
}

function productIdentifiers(product: Product) {
  return [product.sku, product.barcode, product.external_id, product.model_code, product.supplier_sku, product.psku_code, product.noon_sku_child, product.asin]
    .filter(Boolean).map(value => String(value).trim().toLowerCase())
}

export default function ProductCostImport({ products, onClose, onComplete }: {
  products: Product[]
  onClose: () => void
  onComplete: () => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<CostRow[]>([])
  const [parseError, setParseError] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const knownIdentifiers = useMemo(() => new Set(products.flatMap(productIdentifiers)), [products])
  const preview = useMemo(() => {
    const valid = rows.filter(row => row.identifier && Number(String(row.cost_price).replace(',', '.')) > 0)
    const matched = valid.filter(row => knownIdentifiers.has(row.identifier.toLowerCase()))
    const unmatched = valid.filter(row => !knownIdentifiers.has(row.identifier.toLowerCase()))
    return { valid, matched, unmatched, invalid: rows.length - valid.length }
  }, [knownIdentifiers, rows])

  async function readFile(file: File) {
    setParseError('')
    setResult(null)
    setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (!rawRows.length) throw new Error('الملف لا يحتوي على صفوف بيانات.')
      const parsed = parseProductCostRows(rawRows)
      const hasRecognizedColumns = parsed.some(row => row.identifier || row.cost_price)
      if (!hasRecognizedColumns) throw new Error('لم أتعرف على أعمدة الملف. استخدم عمود SKU أو الباركود وعمود تكلفة الشراء.')
      setRows(parsed)
    } catch (error) {
      setRows([])
      setParseError(error instanceof Error ? error.message : 'تعذر قراءة الملف.')
    }
  }

  function downloadTemplate() {
    const content = '\uFEFFSKU,تكلفة الشراء\nSKU-001,25.50\n'
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'sellpert-product-costs-template.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function save() {
    if (!preview.valid.length) return
    setSaving(true)
    setParseError('')
    const payload = preview.valid.map(row => ({ identifier: row.identifier, cost_price: String(row.cost_price).replace(',', '.') }))
    const { data, error } = await (supabase.rpc as any)('bulk_update_product_costs', { p_updates: payload })
    if (error) {
      const permissionError = String(error.message || '').includes('PRODUCT_PERMISSION_REQUIRED')
      setParseError(permissionError ? 'ليس لديك صلاحية تعديل تكاليف المنتجات.' : 'تعذر حفظ التكاليف. تحقق من الملف وحاول مرة أخرى.')
      setSaving(false)
      return
    }
    const outcome = (Array.isArray(data) ? data[0] : data) as ImportResult
    setResult(outcome)
    setSaving(false)
    if (Number(outcome?.updated_count || 0) > 0) onComplete()
  }

  return <div className="cost-import-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="cost-import" role="dialog" aria-modal="true" aria-labelledby="cost-import-title">
      <header className="cost-import__header">
        <div><span className="cost-import__eyebrow"><FileSpreadsheet size={15} /> استكمال بيانات الربحية</span><h2 id="cost-import-title">استيراد تكاليف المنتجات</h2><p>ارفع ملف Excel أو CSV يحتوي على رمز المنتج وتكلفة الشراء. لن تتغير الأسعار أو المخزون.</p></div>
        <button className="cost-import__close" onClick={onClose} aria-label="إغلاق"><X size={19} /></button>
      </header>

      <div className="cost-import__guide">
        <div><strong>الأعمدة المطلوبة</strong><span>SKU أو الباركود</span><span>تكلفة الشراء</span></div>
        <button onClick={downloadTemplate}><Download size={16} /> تنزيل نموذج</button>
      </div>

      <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" hidden onChange={event => { const file = event.target.files?.[0]; if (file) readFile(file) }} />
      <button className="cost-import__drop" onClick={() => fileInput.current?.click()}>
        <Upload size={22} /><strong>{fileName || 'اختر ملف التكاليف'}</strong><span>Excel أو CSV، بحد أقصى 5,000 صف</span>
      </button>

      {parseError ? <div className="cost-import__message cost-import__message--error"><AlertTriangle size={17} />{parseError}</div> : null}

      {rows.length ? <div className="cost-import__review">
        <div className="cost-import__stats">
          <Stat label="صفوف صالحة" value={preview.valid.length} tone="neutral" />
          <Stat label="مطابقة للكتالوج" value={preview.matched.length} tone="good" />
          <Stat label="غير مطابقة" value={preview.unmatched.length} tone={preview.unmatched.length ? 'warning' : 'good'} />
          <Stat label="صفوف غير صالحة" value={preview.invalid} tone={preview.invalid ? 'danger' : 'good'} />
        </div>
        {preview.unmatched.length ? <p className="cost-import__hint">سيتم تجاهل الرموز غير الموجودة في هذا المتجر. مثال: {preview.unmatched.slice(0, 3).map(row => row.identifier).join('، ')}</p> : null}
        <div className="cost-import__table-wrap"><table><thead><tr><th>الصف</th><th>SKU / الباركود</th><th>تكلفة الشراء</th><th>الحالة</th></tr></thead><tbody>{rows.slice(0, 8).map(row => {
          const validCost = Number(String(row.cost_price).replace(',', '.')) > 0
          const matched = knownIdentifiers.has(row.identifier.toLowerCase())
          return <tr key={row.row}><td>{row.row}</td><td dir="ltr">{row.identifier || '—'}</td><td>{validCost ? Number(String(row.cost_price).replace(',', '.')).toFixed(2) + ' ر.س' : '—'}</td><td className={validCost && matched ? 'is-good' : 'is-warning'}>{!validCost || !row.identifier ? 'بيانات ناقصة' : matched ? 'جاهز' : 'غير موجود'}</td></tr>
        })}</tbody></table></div>
      </div> : null}

      {result ? <div className="cost-import__message cost-import__message--success"><CheckCircle2 size={18} /><div><strong>تم تحديث {result.updated_count} منتج</strong><span>{result.unmatched_identifiers?.length ? `لم تتم مطابقة ${result.unmatched_identifiers.length} رمز.` : 'اكتملت جميع الرموز المطابقة.'}</span></div></div> : null}

      <footer className="cost-import__actions">
        <button className="cost-import__cancel" onClick={onClose}>{result ? 'إغلاق' : 'إلغاء'}</button>
        {!result ? <button className="cost-import__save" onClick={save} disabled={saving || !preview.valid.length}>{saving ? 'جارٍ تحديث التكاليف…' : `تحديث ${preview.matched.length} منتج`}</button> : null}
      </footer>
    </section>
  </div>
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'good' | 'warning' | 'danger' }) {
  return <div className={`cost-import__stat cost-import__stat--${tone}`}><strong>{value.toLocaleString('ar-SA-u-nu-latn')}</strong><span>{label}</span></div>
}
