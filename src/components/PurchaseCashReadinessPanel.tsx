import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { normalizePurchaseReadiness, type PurchaseReadiness } from '../lib/purchaseReadiness'
import { userErrorMessage } from '../lib/userError'
import './PurchaseCashReadinessPanel.css'

const money = (value: number | null, currency = 'SAR') => value == null
  ? 'غير متوفر'
  : new Intl.NumberFormat('ar-SA-u-nu-latn', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value)

const STATUS_COPY: Record<PurchaseReadiness['status'], { title: string; detail: string; tone: string }> = {
  ready: { title: 'الخطة قابلة للتمويل', detail: 'الرصيد والمستحقات المؤكدة تغطي تكلفة الشراء المقترحة.', tone: 'success' },
  shortfall: { title: 'يوجد عجز قبل تنفيذ الشراء', detail: 'لا تنفّذ الخطة كاملة قبل معالجة فجوة التمويل الموضحة أدناه.', tone: 'danger' },
  bank_balance_missing: { title: 'أضف رصيد الحساب لتقييم القدرة الشرائية', detail: 'ارفع كشفًا بنكيًا حديثًا؛ لن نعامل المبيعات غير المحوّلة كرصيد متاح.', tone: 'warning' },
  bank_balance_stale: { title: 'الرصيد البنكي يحتاج تحديثًا', detail: 'آخر رصيد أقدم من 7 أيام، لذلك أوقفنا قرار الشراء حتى تحديثه.', tone: 'warning' },
  inventory_stale: { title: 'بيانات المخزون تحتاج مزامنة', detail: 'حدّث مصدر البيانات أولًا حتى لا تُبنى المشتريات على كميات قديمة.', tone: 'warning' },
  cost_data_incomplete: { title: 'أكمل تكاليف المنتجات', detail: 'تعذر تقدير تكلفة الخطة لأن بعض المنتجات المطلوبة بلا سعر تكلفة.', tone: 'warning' },
  no_purchase_needed: { title: 'لا توجد مشتريات مطلوبة الآن', detail: 'لم ترصد البيانات الحالية أصنافًا تحتاج إعادة طلب خلال الأفق المحدد.', tone: 'neutral' },
}

function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function PurchaseCashReadinessPanel() {
  const [data, setData] = useState<PurchaseReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    supabase.rpc('my_purchase_cash_readiness', { p_horizon_days: 30 }).then(({ data: payload, error: rpcError }) => {
      if (!alive) return
      if (rpcError) setError(userErrorMessage(rpcError, 'تعذر تجهيز تقييم السيولة والمشتريات.'))
      else {
        try { setData(normalizePurchaseReadiness(payload)) }
        catch { setError('تعذر قراءة نتيجة تقييم السيولة والمشتريات.') }
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  if (loading) return <section className="purchase-readiness-card" aria-busy="true"><div className="purchase-readiness-loading"><RefreshCw size={18} /> جارٍ تقييم السيولة وخطة الشراء...</div></section>
  if (error || !data) return <section className="purchase-readiness-card"><div className="purchase-readiness-error"><AlertTriangle size={18} />{error}</div></section>

  const status = STATUS_COPY[data.status]
  const currency = data.bank.currency || 'SAR'
  const action = data.status === 'inventory_stale'
    ? { label: 'تحديث الربط والملفات', path: '/integrations' }
    : data.status === 'cost_data_incomplete'
      ? { label: 'استكمال تكاليف المنتجات', path: '/products' }
      : ['bank_balance_missing', 'bank_balance_stale'].includes(data.status)
        ? { label: 'رفع كشف بنكي حديث', path: '/statement?tab=settlements' }
        : null
  const coverage = Math.max(0, Math.min(data.readiness.coverage_pct ?? 0, 100))

  return (
    <section className="purchase-readiness-card" aria-labelledby="purchase-readiness-title">
      <header className="purchase-readiness-header">
        <div>
          <span className="purchase-readiness-eyebrow">قرار تشغيلي · 30 يومًا</span>
          <h2 id="purchase-readiness-title">جاهزية تمويل المشتريات</h2>
          <p>هل تستطيع شراء الكميات المقترحة من النقد المؤكد فعلًا؟</p>
        </div>
        <ShieldCheck size={24} aria-hidden="true" />
      </header>

      <div className={`purchase-readiness-status ${status.tone}`}>
        {data.status === 'ready' || data.status === 'no_purchase_needed' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        <div><strong>{status.title}</strong><span>{status.detail}</span></div>
        {action && <button onClick={() => navigate(action.path)}>{action.label}<ArrowLeft size={15} /></button>}
      </div>

      <div className="purchase-readiness-kpis">
        <div><Banknote /><span>آخر رصيد بنكي</span><strong>{money(data.bank.balance, currency)}</strong><small>{data.bank.balance_date ? `بتاريخ ${data.bank.balance_date}` : 'لم يُرفع كشف بنكي'}</small></div>
        <div><WalletCards /><span>مستحقات مؤكدة قادمة</span><strong>{money(data.payouts.confirmed_total, currency)}</strong><small>{data.payouts.count ? `${data.payouts.count} دفعة خلال 30 يومًا` : 'لا توجد دفعات مؤكدة'}</small></div>
        <div><span>تكلفة خطة الشراء</span><strong>{money(data.purchase_plan.estimated_cost, currency)}</strong><small>{data.purchase_plan.item_count} صنف · {data.purchase_plan.unit_count} وحدة</small></div>
        <div><span>{data.status === 'shortfall' ? 'فجوة التمويل' : 'المتبقي بعد الشراء'}</span><strong className={data.status === 'shortfall' ? 'negative' : ''}>{money(data.status === 'shortfall' ? data.readiness.funding_gap : data.readiness.cash_after_purchase, currency)}</strong><small>المبيعات غير المحوّلة مستبعدة</small></div>
      </div>

      {data.readiness.coverage_pct != null && data.purchase_plan.estimated_cost > 0 && (
        <div className="purchase-readiness-coverage">
          <div><span>تغطية خطة الشراء بالنقد المؤكد</span><strong>{data.readiness.coverage_pct.toLocaleString('ar-SA-u-nu-latn')}٪</strong></div>
          <div className="purchase-readiness-track"><span style={{ width: `${coverage}%` }} /></div>
        </div>
      )}

      <div className="purchase-readiness-footnote">
        <ShieldCheck size={16} />
        <span>المبيعات غير المحوّلة ({money(data.unconfirmed_sales.gross_total, currency)}) معلومة فقط، ولم تُحتسب ضمن النقد المتاح للشراء.</span>
      </div>
    </section>
  )
}
