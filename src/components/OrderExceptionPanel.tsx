import { useMemo, useState } from 'react'
import { AlertTriangle, PackageOpen } from 'lucide-react'
import type { TrendyolPackageWorkflow } from '../lib/trendyolOrderWorkflow'

const CANCELLATION_REASONS = [
  [500, 'نفاد المخزون'],
  [501, 'المنتج تالف أو معيب'],
  [502, 'سعر المنتج غير صحيح'],
  [503, 'الصورة أو الباركود أو الكمية غير صحيحة'],
  [504, 'مشكلة في التكامل'],
  [505, 'شراء كمية كبيرة'],
  [506, 'ظرف قهري'],
] as const

type OrderLine = {
  line_id?: string | number | null
  product_name_ar?: string | null
  product_name?: string | null
  barcode?: string | null
  quantity?: number | null
}

type Props = {
  items: OrderLine[]
  workflow: TrendyolPackageWorkflow
  busy: boolean
  onRun: (action: string, payload: Record<string, unknown>, label: string) => Promise<boolean | void>
}

export default function OrderExceptionPanel({ items, workflow, busy, onRun }: Props) {
  const [mode, setMode] = useState<'cancel' | 'split' | null>(null)
  const [lineId, setLineId] = useState(() => String(items[0]?.line_id || ''))
  const [quantity, setQuantity] = useState('1')
  const [reasonId, setReasonId] = useState('500')
  const [error, setError] = useState('')
  const selectedLine = useMemo(() => items.find(item => String(item.line_id) === lineId) || null, [items, lineId])
  const selectedQuantity = Number(quantity)
  const availableQuantity = Math.max(0, Number(selectedLine?.quantity || 0))
  const totalPackageQuantity = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0)
  const canCreateSplit = items.length > 1 || totalPackageQuantity > 1

  function chooseMode(nextMode: 'cancel' | 'split') {
    setMode(current => current === nextMode ? null : nextMode)
    setLineId(String(items[0]?.line_id || ''))
    setQuantity('1')
    setError('')
  }

  async function submit() {
    setError('')
    if (!selectedLine || !Number.isInteger(Number(lineId)) || Number(lineId) < 1) {
      setError('اختر منتجًا صحيحًا من الشحنة.')
      return
    }
    if (!Number.isInteger(selectedQuantity) || selectedQuantity < 1 || selectedQuantity > availableQuantity) {
      setError(`أدخل كمية صحيحة من 1 إلى ${availableQuantity.toLocaleString('ar-SA')}.`)
      return
    }
    if (mode === 'split' && selectedQuantity >= totalPackageQuantity) {
      setError('لا يمكن نقل كامل محتوى الشحنة إلى شحنة جديدة. اختر كمية أقل.')
      return
    }
    const productName = selectedLine.product_name_ar || selectedLine.product_name || selectedLine.barcode || `البند ${lineId}`
    const succeeded = mode === 'cancel'
      ? await onRun('packages.cancel', {
          lines:[{ lineId:Number(lineId), quantity:selectedQuantity }],
          reasonId:Number(reasonId),
          shouldKeepPreviousStatus:true,
        }, `تسجيل تعذر توفير ${selectedQuantity} من «${productName}»`)
      : await onRun('packages.split', {
          splitPackages:[{ packageDetails:[{ orderLineId:Number(lineId), quantities:selectedQuantity }] }],
          shouldKeepPreviousStatus:true,
        }, `تقسيم ${selectedQuantity} من «${productName}» إلى شحنة مستقلة`)
    if (succeeded) setMode(null)
  }

  return (
    <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--border)' }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:9 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:800 }}>معالجة استثناءات الشحنة</div>
          <div style={{ fontSize:10, color:'var(--text3)', lineHeight:1.65, marginTop:3 }}>استخدمها فقط عند تعذر توفير منتج أو الحاجة إلى شحنه منفصلًا. ينشئ Trendyol رقم شحنة جديدًا بعد قبول الإجراء.</div>
        </div>
      </div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button type="button" disabled={busy || !workflow.canCancel || items.length === 0} onClick={() => chooseMode('cancel')} style={{ ...styles.modeButton, color:'var(--danger-text)', opacity:workflow.canCancel && items.length ? 1 : .5, borderColor:mode === 'cancel' ? 'var(--danger-text)' : 'var(--border)' }}><AlertTriangle size={14}/> تعذر توفير منتج</button>
        <button type="button" disabled={busy || !workflow.canSplit || !canCreateSplit} onClick={() => chooseMode('split')} style={{ ...styles.modeButton, opacity:workflow.canSplit && canCreateSplit ? 1 : .5, borderColor:mode === 'split' ? 'var(--accent)' : 'var(--border)' }}><PackageOpen size={14}/> تقسيم الشحنة</button>
      </div>
      {mode ? <div style={styles.form}>
        <label style={styles.field}>المنتج
          <select value={lineId} onChange={event => { setLineId(event.target.value); setQuantity('1'); setError('') }} style={styles.input}>
            {items.map(item => <option key={String(item.line_id)} value={String(item.line_id)}>{item.product_name_ar || item.product_name || item.barcode || `البند ${item.line_id}`} · المتاح {Number(item.quantity || 0)}</option>)}
          </select>
        </label>
        <label style={styles.field}>الكمية
          <input type="number" min="1" max={availableQuantity || 1} step="1" value={quantity} onChange={event => { setQuantity(event.target.value); setError('') }} style={styles.input}/>
        </label>
        {mode === 'cancel' ? <label style={styles.field}>سبب تعذر التوفير
          <select value={reasonId} onChange={event => setReasonId(event.target.value)} style={styles.input}>{CANCELLATION_REASONS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label> : null}
        <div style={{ gridColumn:'1/-1', padding:'9px 10px', borderRadius:8, background:mode === 'cancel' ? 'var(--danger-bg)' : 'var(--info-bg)', color:mode === 'cancel' ? 'var(--danger-text)' : 'var(--info-text)', fontSize:10, lineHeight:1.65 }}>
          {mode === 'cancel' ? 'الإلغاء لا يمكن التراجع عنه من Sellpert. سيُلغي Trendyol الكمية المحددة ويعيد إنشاء بقية الشحنة برقم جديد.' : 'سيُنقل المنتج والكمية المحددة إلى شحنة مستقلة، وقد يستغرق ظهور رقم الشحنة الجديد وقتًا قصيرًا.'}
        </div>
        {error ? <div style={{ gridColumn:'1/-1', color:'var(--danger-text)', fontSize:10, fontWeight:700 }}>{error}</div> : null}
        <div style={{ gridColumn:'1/-1', display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button type="button" disabled={busy} onClick={() => setMode(null)} style={styles.secondary}>إلغاء</button>
          <button type="button" disabled={busy} onClick={() => void submit()} style={{ ...styles.primary, background:mode === 'cancel' ? 'var(--danger-text)' : 'var(--accent-strong)' }}>{busy ? 'جارٍ الإرسال...' : mode === 'cancel' ? 'مراجعة وتأكيد الإلغاء' : 'مراجعة وتأكيد التقسيم'}</button>
        </div>
      </div> : null}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  modeButton:{ border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text2)', borderRadius:8, padding:'8px 11px', display:'inline-flex', alignItems:'center', gap:7, fontFamily:'inherit', fontSize:10, fontWeight:800, cursor:'pointer' },
  form:{ marginTop:10, padding:11, border:'1px solid var(--border)', borderRadius:9, background:'var(--surface)', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:9 },
  field:{ display:'grid', gap:5, color:'var(--text2)', fontSize:10, fontWeight:700 },
  input:{ width:'100%', boxSizing:'border-box', border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text)', borderRadius:8, padding:'8px 9px', fontFamily:'inherit', fontSize:11 },
  secondary:{ border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text2)', borderRadius:8, padding:'8px 11px', fontFamily:'inherit', fontSize:10, fontWeight:700, cursor:'pointer' },
  primary:{ border:0, color:'#fff', borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:10, fontWeight:800, cursor:'pointer' },
}
