import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Bell, Check, CheckCheck, ChevronLeft, CircleDollarSign,
  ClipboardCheck, PackageCheck, RefreshCw, Store, TriangleAlert,
} from 'lucide-react'
import { supabase, type Merchant } from '../lib/supabase'
import {
  attentionTotals, buildAttentionItems, buildMarketplaceOperations, type AttentionCenterInput,
  type AttentionItem, type AttentionSeverity, type MarketplaceOperation,
} from '../lib/attentionCenter'
import { PageHeader } from '../components/UI'
import { userErrorMessage } from '../lib/userError'
import './Notifications.css'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  is_read: boolean
  action_path: string | null
  created_at: string
}

type CenterData = AttentionCenterInput & { notifications: NotificationRow[] }
type Tab = 'actions' | 'operations' | 'notifications'

function requestedTab(): Tab {
  const value = new URLSearchParams(window.location.search).get('tab')
  return value === 'operations' || value === 'notifications' ? value : 'actions'
}

const EMPTY_DATA: CenterData = {
  orders: [], packages: [], questions: [], listings: [], actionLogs: [], products: [], notifications: [],
}

const SEVERITY_META: Record<AttentionSeverity, { label: string; Icon: typeof AlertCircle }> = {
  urgent: { label: 'عاجل', Icon: TriangleAlert },
  attention: { label: 'يحتاج متابعة', Icon: AlertCircle },
  info: { label: 'استكمال بيانات', Icon: CircleDollarSign },
}

const CATEGORY_LABEL: Record<AttentionItem['category'], string> = {
  orders: 'الطلبات والشحن', customers: 'خدمة العملاء', catalog: 'المنتجات', finance: 'الربحية', integration: 'الربط',
}

function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function timeAgo(iso?: string | null) {
  if (!iso) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `قبل ${minutes.toLocaleString('ar-SA-u-nu-latn')} دقيقة`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `قبل ${hours.toLocaleString('ar-SA-u-nu-latn')} ساعة`
  return `قبل ${Math.floor(hours / 24).toLocaleString('ar-SA-u-nu-latn')} يوم`
}

function resultData<T>(result: PromiseSettledResult<{ data: T[] | null; error: unknown }>, failedSources: string[], source: string): T[] {
  if (result.status === 'rejected' || result.value.error) {
    failedSources.push(source)
    return []
  }
  return result.value.data || []
}

export default function Notifications({ merchant }: { merchant: Merchant | null }) {
  const [data, setData] = useState<CenterData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [failedSources, setFailedSources] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>(requestedTab)
  const merchantCode = merchant?.merchant_code

  const load = useCallback(async (quiet = false) => {
    if (!merchantCode) return
    if (quiet) setRefreshing(true)
    else setLoading(true)
    const results = await Promise.allSettled([
      supabase.from('orders').select('id,order_id,status,cargo_tracking_number,total_amount,platform_fee,unit_price,quantity,sku,order_date')
        .eq('merchant_code', merchantCode).order('order_date', { ascending: true }).limit(500),
      supabase.from('order_packages').select('order_id,shipment_package_id,status,cargo_tracking_number,invoice_status,invoice_rejected_reasons,modified_at')
        .eq('merchant_code', merchantCode).order('modified_at', { ascending: true }).limit(500),
      supabase.from('trendyol_customer_questions').select('status,asked_at')
        .eq('merchant_code', merchantCode).order('asked_at', { ascending: true }).limit(500),
      supabase.from('product_platform_listings').select('product_id,delivery_status,delivery_error,updated_at')
        .eq('merchant_code', merchantCode).order('updated_at', { ascending: false }).limit(500),
      supabase.from('marketplace_action_logs').select('id,platform,risk_level,status,action,request,external_batch_id,error_message,started_at,finished_at')
        .eq('merchant_code', merchantCode).order('started_at', { ascending: false }).limit(100),
      supabase.from('products').select('id,sku,barcode,external_id,cost_price')
        .eq('merchant_code', merchantCode).limit(2000),
      supabase.from('notifications').select('id,type,title,body,is_read,action_path,created_at')
        .eq('merchant_code', merchantCode).order('created_at', { ascending: false }).limit(200),
    ])
    const failures: string[] = []
    setData({
      orders: resultData(results[0] as any, failures, 'الطلبات'),
      packages: resultData(results[1] as any, failures, 'الشحنات'),
      questions: resultData(results[2] as any, failures, 'أسئلة العملاء'),
      listings: resultData(results[3] as any, failures, 'تحديثات المنتجات'),
      actionLogs: resultData(results[4] as any, failures, 'عمليات الربط'),
      products: resultData(results[5] as any, failures, 'تكاليف المنتجات'),
      notifications: resultData(results[6] as any, failures, 'الإشعارات'),
    })
    setFailedSources(failures)
    setLoading(false)
    setRefreshing(false)
  }, [merchantCode])

  useEffect(() => { void load() }, [load])

  function selectTab(next: Tab) {
    setTab(next)
    const params = new URLSearchParams(window.location.search)
    if (next === 'actions') params.delete('tab')
    else params.set('tab', next)
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }

  const attentionItems = useMemo(() => buildAttentionItems(data), [data])
  const operations = useMemo(() => buildMarketplaceOperations(data), [data])
  const totals = useMemo(() => attentionTotals(attentionItems), [attentionItems])
  const unread = data.notifications.filter(row => !row.is_read).length

  async function generateNew() {
    if (!merchantCode) return
    setRefreshing(true)
    setRefreshMessage(null)
    try {
      const { data: created, error } = await supabase.rpc('generate_proactive_alerts', { p_merchant_code: merchantCode })
      if (error) throw error
      await load(true)
      const count = Number(created || 0)
      setRefreshMessage({
        type: 'ok',
        text: count > 0
          ? `اكتمل الفحص وأضيف ${count.toLocaleString('ar-SA-u-nu-latn')} تنبيه جديد إلى السجل.`
          : 'اكتمل فحص الطلبات والشحن والعملاء والربط، ولا توجد تنبيهات جديدة.',
      })
    } catch (error) {
      setRefreshing(false)
      setRefreshMessage({ type: 'err', text: userErrorMessage(error, 'تعذر تحديث المتابعة الآن. لم تتغير بياناتك، ويمكنك إعادة المحاولة.') })
    }
  }

  async function markRead(id: string) {
    if (!merchantCode) return
    await supabase.from('notifications').update({ is_read: true }).eq('merchant_code', merchantCode).eq('id', id)
    setData(current => ({ ...current, notifications: current.notifications.map(row => row.id === id ? { ...row, is_read: true } : row) }))
  }

  async function markAllRead() {
    if (!merchantCode) return
    await supabase.from('notifications').update({ is_read: true }).eq('merchant_code', merchantCode).eq('is_read', false)
    setData(current => ({ ...current, notifications: current.notifications.map(row => ({ ...row, is_read: true })) }))
  }

  return (
    <main className="attention-page">
      <PageHeader
        title="مركز المتابعة"
        description="كل ما يحتاج تدخلك الآن، مرتب حسب الأولوية مع انتقال مباشر إلى مكان الحل."
        icon={ClipboardCheck}
        action={<button className="attention-refresh" onClick={generateNew} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> تحديث المتابعة
        </button>}
      />

      <section className="attention-summary" aria-label="ملخص المتابعة">
        <SummaryCard label="إجمالي البنود" value={totals.total} Icon={ClipboardCheck} tone="neutral" />
        <SummaryCard label="عاجل" value={totals.urgent} Icon={TriangleAlert} tone="urgent" />
        <SummaryCard label="يحتاج متابعة" value={totals.attention} Icon={AlertCircle} tone="attention" />
        <SummaryCard label="استكمال بيانات" value={totals.info} Icon={CircleDollarSign} tone="info" />
      </section>

      {failedSources.length > 0 && (
        <div className="attention-partial" role="status">
          بعض البيانات لم تُحمّل الآن: {failedSources.join('، ')}. بقية النتائج المعروضة ما زالت صالحة ويمكن تحديثها لاحقًا.
        </div>
      )}

      {refreshMessage ? (
        <div className={`attention-refresh-message ${refreshMessage.type}`} role={refreshMessage.type === 'err' ? 'alert' : 'status'} aria-live="polite">
          {refreshMessage.type === 'err' ? <AlertCircle size={16} /> : <Check size={16} />}
          <span>{refreshMessage.text}</span>
        </div>
      ) : null}

      <div className="attention-tabs" role="tablist" aria-label="أقسام مركز المتابعة">
        <button role="tab" aria-selected={tab === 'actions'} className={tab === 'actions' ? 'active' : ''} onClick={() => selectTab('actions')}>
          المطلوب الآن <span>{totals.total.toLocaleString('ar-SA-u-nu-latn')}</span>
        </button>
        <button role="tab" aria-selected={tab === 'operations'} className={tab === 'operations' ? 'active' : ''} onClick={() => selectTab('operations')}>
          عمليات المنصات <span>{operations.length.toLocaleString('ar-SA-u-nu-latn')}</span>
        </button>
        <button role="tab" aria-selected={tab === 'notifications'} className={tab === 'notifications' ? 'active' : ''} onClick={() => selectTab('notifications')}>
          سجل الإشعارات <span>{unread.toLocaleString('ar-SA-u-nu-latn')}</span>
        </button>
      </div>

      {loading ? <CenterLoading /> : tab === 'actions' ? (
        attentionItems.length === 0 ? <AllClear /> : (
          <section className="attention-list" aria-label="الإجراءات المطلوبة">
            {attentionItems.map(item => <ActionCard key={item.id} item={item} />)}
          </section>
        )
      ) : tab === 'operations' ? (
        <OperationsLog operations={operations} />
      ) : (
        <section className="notification-log">
          <div className="notification-log-head">
            <div><h2>سجل الإشعارات</h2><p>التحديثات السابقة والتنبيهات التي أنشأها النظام.</p></div>
            {unread > 0 ? <button onClick={markAllRead}><CheckCheck size={15} /> تعليم الكل كمقروء</button> : null}
          </div>
          {data.notifications.length === 0 ? (
            <div className="attention-empty compact"><Bell size={28} /><strong>لا توجد إشعارات مسجلة</strong></div>
          ) : data.notifications.map(row => (
            <button key={row.id} className={`notification-row ${row.is_read ? '' : 'unread'}`} onClick={() => {
              if (!row.is_read) void markRead(row.id)
              if (row.action_path) navigate(row.action_path)
            }}>
              <span className="notification-state">{row.is_read ? <Check size={15} /> : <span />}</span>
              <span className="notification-copy"><strong>{row.title}</strong>{row.body ? <small>{row.body}</small> : null}</span>
              <time>{timeAgo(row.created_at)}</time>
              {row.action_path ? <ChevronLeft size={17} /> : null}
            </button>
          ))}
        </section>
      )}
    </main>
  )
}

function OperationsLog({ operations }: { operations: MarketplaceOperation[] }) {
  return <section className="operation-log" aria-label="عمليات المنصات">
    <div className="operation-log-head">
      <div><h2>عمليات Trendyol</h2><p>الإرسال والتحديثات التي نفذتها من Sellpert، بحالة مفهومة ورابط مباشر لمكان المتابعة.</p></div>
    </div>
    {operations.length === 0 ? <div className="attention-empty compact"><PackageCheck size={28} /><strong>لم تُنفذ عمليات على المنصات بعد</strong></div> : (
      <div className="operation-rows">
        {operations.map(operation => <article key={operation.id} className={`operation-row ${operation.tone}`}>
          <span className="operation-tone" aria-hidden="true" />
          <div className="operation-copy">
            <div><strong>{operation.label}</strong><span>{operation.statusLabel}</span>{operation.reference ? <b dir="ltr">{operation.reference}</b> : null}</div>
            {operation.error ? <p>{operation.error}</p> : null}
          </div>
          <time>{timeAgo(operation.occurredAt)}</time>
          <button onClick={() => navigate(operation.path)}>{operation.actionLabel}<ChevronLeft size={16} /></button>
        </article>)}
      </div>
    )}
  </section>
}

function SummaryCard({ label, value, Icon, tone }: { label: string; value: number; Icon: typeof AlertCircle; tone: string }) {
  return <article className={`attention-kpi ${tone}`}><span><Icon size={18} /></span><div><strong>{value.toLocaleString('ar-SA-u-nu-latn')}</strong><small>{label}</small></div></article>
}

function ActionCard({ item }: { item: AttentionItem }) {
  const { Icon, label } = SEVERITY_META[item.severity]
  return (
    <article className={`attention-action ${item.severity}`}>
      <div className="attention-action-icon"><Icon size={19} /></div>
      <div className="attention-action-copy">
        <div className="attention-action-meta"><span>{label}</span><span>{CATEGORY_LABEL[item.category]}</span>{item.occurredAt ? <time>{timeAgo(item.occurredAt)}</time> : null}</div>
        <h2>{item.title}<b>{item.count.toLocaleString('ar-SA-u-nu-latn')}</b></h2>
        <p>{item.description}</p>
      </div>
      <button onClick={() => navigate(item.path)}>{item.actionLabel}<ChevronLeft size={16} /></button>
    </article>
  )
}

function CenterLoading() {
  return <div className="attention-loading"><RefreshCw size={22} className="spin" /><span>جاري فحص بيانات المتجر…</span></div>
}

function AllClear() {
  return <div className="attention-empty"><div><PackageCheck size={30} /></div><h2>لا توجد أعمال عاجلة الآن</h2><p>الطلبات والربط والمنتجات لا تعرض استثناءات تحتاج تدخلك في الوقت الحالي.</p><span><Store size={14} /> آخر فحص تم من بيانات متجرك فقط</span></div>
}
