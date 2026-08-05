import { useEffect, useState } from 'react'
import { ArrowLeft, Boxes, Link2, Package, RefreshCw, Tags } from 'lucide-react'
import { fetchAll } from '../lib/db'
import { listPlatformCredentials } from '../lib/platformCredentialManager'
import { supabase, type Merchant, type Order, type PlatformCredential } from '../lib/supabase'
import './DashboardV2.css'

type PhaseOneView = 'orders' | 'products' | 'inventory' | 'integrations'

type Summary = {
  todayOrders: number
  products: number
  lowStock: number
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'جديد',
  processing: 'قيد التنفيذ',
  shipped: 'تم الشحن',
  delivered: 'مكتمل',
  cancelled: 'ملغي',
  returned: 'مرتجع',
}

function withTimeout<T>(request: PromiseLike<T>, timeoutMs = 7000): Promise<T> {
  return Promise.race([
    Promise.resolve(request),
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('dashboard timeout')), timeoutMs)),
  ])
}

function formatDateTime(value?: string | null) {
  if (!value) return 'لم تتم المزامنة بعد'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'غير متاح'
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(date)
}

function formatMoney(value: number, currency = 'SAR') {
  return new Intl.NumberFormat('ar-SA-u-nu-latn', {
    style: 'currency', currency: currency || 'SAR', maximumFractionDigits: 2,
  }).format(Number(value) || 0)
}

export default function DashboardV2({
  merchant,
  onNavigate,
}: {
  merchant: Merchant | null
  onNavigate: (view: PhaseOneView) => void
}) {
  const [summary, setSummary] = useState<Summary>({ todayOrders: 0, products: 0, lowStock: 0 })
  const [orders, setOrders] = useState<Order[]>([])
  const [credential, setCredential] = useState<PlatformCredential | null>(null)
  const [loading, setLoading] = useState(true)
  const [partial, setPartial] = useState(false)

  useEffect(() => {
    const merchantCode = merchant?.merchant_code
    if (!merchantCode) return
    let cancelled = false
    setLoading(true)
    setPartial(false)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    Promise.allSettled([
      withTimeout(fetchAll<{ order_id: string }>((from, to) => supabase.from('orders').select('order_id')
        .eq('merchant_code', merchantCode).gte('order_date', today.toISOString()).range(from, to), 'طلبات اليوم')),
      withTimeout(supabase.from('products').select('id', { count: 'exact', head: true })
        .eq('merchant_code', merchantCode)),
      withTimeout(supabase.from('inventory_health').select('sku', { count: 'exact', head: true })
        .eq('merchant_code', merchantCode).in('health_status', ['low_stock', 'out_of_stock', 'reorder_soon'])),
      withTimeout(supabase.from('orders')
        .select('id,merchant_code,platform,order_id,status,product_name,sku,quantity,unit_price,total_amount,currency,order_date,created_at')
        .eq('merchant_code', merchantCode).order('order_date', { ascending: false }).limit(12)),
      withTimeout(listPlatformCredentials(merchantCode)),
    ]).then(results => {
      if (cancelled) return
      const [todayResult, productResult, stockResult, orderResult, credentialResult] = results
      setSummary({
        todayOrders: todayResult.status === 'fulfilled' ? new Set(todayResult.value.map(row => row.order_id)).size : 0,
        products: productResult.status === 'fulfilled' ? productResult.value.count || 0 : 0,
        lowStock: stockResult.status === 'fulfilled' ? stockResult.value.count || 0 : 0,
      })
      setOrders(orderResult.status === 'fulfilled'
        ? Array.from(new Map(((orderResult.value.data || []) as Order[]).map(order => [order.order_id, order])).values()).slice(0, 3)
        : [])
      setCredential(credentialResult.status === 'fulfilled'
        ? credentialResult.value.find(item => item.platform === 'trendyol') || null
        : null)
      setPartial(results.some(result => result.status === 'rejected'))
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [merchant?.merchant_code])

  const connected = Boolean(credential?.is_active)

  return (
    <div className="phase-one-dashboard" dir="rtl">
      <header className="phase-one-heading">
        <div>
          <h1>الرئيسية</h1>
          <p>مرحبًا {merchant?.name || 'بك'}، هذا ملخص تشغيل متجرك.</p>
        </div>
      </header>

      <section className="connection-panel" aria-label="حالة ربط Trendyol">
        <div className="connection-copy">
          <div className="connection-title-row">
            <span className="connection-mark" aria-hidden="true">T</span>
            <div>
              <h2>Trendyol</h2>
              <span className={connected ? 'connection-status connected' : 'connection-status'}>
                {connected ? 'متصل' : 'غير متصل'}
              </span>
            </div>
          </div>
          <p>{connected
            ? `آخر تحديث: ${formatDateTime(credential?.last_sync_at)}`
            : 'اربط حسابك لعرض الطلبات والمنتجات والمخزون.'}</p>
        </div>
        <button className="primary-action" type="button" onClick={() => onNavigate('integrations')}>
          {connected ? <RefreshCw size={17} /> : <Link2 size={17} />}
          {connected ? 'إدارة المزامنة' : 'ربط Trendyol'}
        </button>
      </section>

      {partial && !loading ? (
        <div className="quiet-notice">تعذر تحديث بعض الأرقام الآن. يمكنك متابعة العمل والمحاولة لاحقًا.</div>
      ) : null}

      <section className="summary-strip" aria-label="ملخص المتجر">
        <button type="button" onClick={() => onNavigate('orders')}>
          <Package size={19} />
          <span>طلبات اليوم</span>
          <strong>{loading ? '—' : summary.todayOrders.toLocaleString('ar-SA-u-nu-latn')}</strong>
        </button>
        <button type="button" onClick={() => onNavigate('products')}>
          <Tags size={19} />
          <span>المنتجات</span>
          <strong>{loading ? '—' : summary.products.toLocaleString('ar-SA-u-nu-latn')}</strong>
        </button>
        <button type="button" onClick={() => onNavigate('inventory')}>
          <Boxes size={19} />
          <span>تحتاج مخزونًا</span>
          <strong>{loading ? '—' : summary.lowStock.toLocaleString('ar-SA-u-nu-latn')}</strong>
        </button>
      </section>

      <section className="recent-orders">
        <header>
          <div>
            <h2>أحدث الطلبات</h2>
            <p>آخر الطلبات الواردة إلى متجرك</p>
          </div>
          <button type="button" onClick={() => onNavigate('orders')}>عرض الكل <ArrowLeft size={15} /></button>
        </header>

        {loading ? (
          <div className="orders-loading"><RefreshCw size={18} /> جارٍ تحديث الطلبات…</div>
        ) : orders.length === 0 ? (
          <div className="orders-empty">
            <Package size={24} />
            <strong>لا توجد طلبات بعد</strong>
            <span>{connected ? 'ستظهر الطلبات هنا عند وصولها.' : 'ابدأ بربط Trendyol أو رفع ملف طلبات.'}</span>
            <button type="button" onClick={() => onNavigate('integrations')}>الذهاب إلى الربط</button>
          </div>
        ) : (
          <div className="orders-list">
            {orders.map(order => (
              <button key={order.id} type="button" className="order-row" onClick={() => onNavigate('orders')}>
                <div className="order-identity">
                  <strong>#{order.order_id}</strong>
                  <span>{order.product_name || 'طلب متجر'}</span>
                </div>
                <span className="order-platform">{order.platform === 'trendyol' ? 'Trendyol' : order.platform}</span>
                <strong className="order-amount">{formatMoney(order.total_amount, order.currency)}</strong>
                <span className={`order-status status-${order.status}`}>{STATUS_LABELS[order.status] || order.status}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
