import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/db'
import { useMobile } from '../lib/hooks'
import { PageTabs } from '../components/UI'
import type { Merchant, Order, OrderStatus } from '../lib/supabase'
import { PLATFORM_MAP, PLATFORM_COLORS } from '../lib/constants'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { orderFinancialIssue, orderNeedsAction } from '../lib/orderQuality'
import { userErrorMessage } from '../lib/userError'
import { trendyolPackageWorkflow } from '../lib/trendyolOrderWorkflow'
import OrderExceptionPanel from '../components/OrderExceptionPanel'
import { calculateOrderProfit } from '../lib/orderProfit'
import { buildOrderOperationQueue, type OperationalPackage } from '../lib/orderOperations'

const ORDER_PAGE_SIZE = 50
const SA_CARRIERS = [
  ['AJEX','Ajex'],['ARAMEX','Aramex'],['AYMAKAN','Aymakan'],['DHL','DHL'],['FLOWEXPRESS','Flow Express'],
  ['IMILE','iMile'],['JTEXPRESS','J&T'],['NAQEL','Naqel'],['SHIPA','Shipa'],['SMSA','SMSA'],['SPL','SPL'],
  ['STARLINKS','Starlinks'],['ZID LOGISTICS','ZID Logistics'],['JOYEXPRESS','Joy Express'],
]
const INVOICE_MAX_BYTES = 10 * 1024 * 1024
const INVOICE_TYPES: Record<string,string> = { pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png' }

function invoiceMime(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  return INVOICE_TYPES[extension] || file.type.toLowerCase()
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}
const STATUS_MAP: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  pending:    { label: 'معلق',      color: 'var(--warning-text)', bg: 'var(--warning-bg)' },
  processing: { label: 'قيد التنفيذ', color: 'var(--info-text)', bg: 'var(--info-bg)' },
  shipped:    { label: 'تم الشحن',  color: '#0f958c', bg: 'rgba(15,149,140,0.15)' },
  delivered:  { label: 'تم التسليم', color: 'var(--success-text)', bg: 'var(--success-bg)' },
  cancelled:  { label: 'ملغي',      color: 'var(--danger-text)', bg: 'var(--danger-bg)' },
  returned:   { label: 'مُرتجع',   color: 'var(--warning-text)', bg: 'var(--warning-bg)' },
}

const PACKAGE_STATUS_LABELS: Record<string, string> = {
  created: 'تم استلام الطلب', awaiting: 'بانتظار الإجراء', picking: 'قيد التجهيز', invoiced: 'تم إصدار الفاتورة',
  shipped: 'تم الشحن', atcollectionpoint: 'في نقطة التجميع', delivered: 'تم التسليم', cancelled: 'ملغاة',
  returned: 'مرتجعة', unsupplied: 'تعذر التوريد', unpacked: 'بانتظار التجهيز',
  notinvoiced: 'لم تصدر الفاتورة', invoiceapproved: 'الفاتورة معتمدة', invoicerejected: 'الفاتورة مرفوضة',
}

function packageStatusLabel(status?: string | null) {
  if (!status) return 'غير محددة'
  return PACKAGE_STATUS_LABELS[status.toLowerCase().replace(/[^a-z]/g, '')] || status
}

function fmt(v: number) { return v.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س' }
function fmtExact(v: number) { return Number(v || 0).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س' }
function trendyolCommission(order: Order) {
  if (order.platform !== 'trendyol' || !order.commission_rate) return Number(order.platform_fee || 0)
  return Number(order.total_amount || 0) * Number(order.commission_rate) / 100 * 1.15
}

function orderSource(o: Order) {
  if (o.upload_id) return { label: 'ملف Excel', exportLabel: 'ملف Excel', title: 'تم استيراد الطلب من ملف مرفوع', bg: 'var(--info-bg)', color: 'var(--info-text)' }
  if (o.platform === 'trendyol') return { label: 'API Trendyol', exportLabel: 'API Trendyol', title: 'تم سحب الطلب مباشرة من ربط Trendyol', bg: 'var(--success-bg)', color: 'var(--success-text)' }
  return { label: 'مصدر غير محدد', exportLabel: 'مصدر غير محدد', title: 'لا توجد بيانات كافية لتحديد مصدر هذا الطلب', bg: 'var(--warning-bg)', color: 'var(--warning-text)' }
}

export default function Orders({ merchant }: { merchant: Merchant | null }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [trendyolSnaps, setTrendyolSnaps] = useState<any[]>([])
  const [operationalPackages, setOperationalPackages] = useState<OperationalPackage[]>([])
  const [pendingReturnCount, setPendingReturnCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadVersion, setLoadVersion] = useState(0)
  // Filter persistence — حفظ الفلاتر في localStorage
  const FK = 'sellpert-orders-filters:v2'
  const saved = (() => { try { return JSON.parse(localStorage.getItem(FK) || '{}') } catch { return {} } })()
  const [platform, setPlatform] = useState(saved.platform || 'all')
  const [status, setStatus]     = useState(saved.status   || 'all')
  const [search, setSearch]     = useState(saved.search   || '')
  const [preset, setPreset]     = useState(saved.preset   || 'all')
  const [tab, setTab] = useState<'list' | 'compare' | 'chart'>(saved.tab || 'list')
  const [orderPage, setOrderPage] = useState(0)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedItems, setSelectedItems] = useState<any[]>([])
  const [selectedPackages, setSelectedPackages] = useState<any[]>([])
  const [activePackageId, setActivePackageId] = useState('')
  const [selectedActions, setSelectedActions] = useState<any[]>([])
  const [selectedProductCosts, setSelectedProductCosts] = useState<Map<string, number>>(() => new Map())
  const [detailLoading, setDetailLoading] = useState(false)
  const [orderActionLoading, setOrderActionLoading] = useState(false)
  const [orderActionMessage, setOrderActionMessage] = useState<{ type:'ok'|'err'; text:string } | null>(null)
  const [packageForm, setPackageForm] = useState({ invoiceNumber:'', trackingNumber:'', providerCode:'STARLINKS' })
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [bulkPickingRows, setBulkPickingRows] = useState<Array<{ orderId:string; packageId:string; lines:Array<{ lineId:number; quantity:number }> }>>([])
  const [bulkPickingOpen, setBulkPickingOpen] = useState(false)
  const [bulkPickingLoading, setBulkPickingLoading] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<{ type:'ok'|'err'; text:string } | null>(null)
  const isMobile = useMobile()
  const merchantCode = merchant?.merchant_code

  useEffect(() => {
    localStorage.setItem(FK, JSON.stringify({ platform, status, search, preset, tab }))
  }, [platform, status, search, preset, tab])

  useEffect(() => {
    if (!merchantCode) return
    setLoading(true)
    setLoadError('')
    Promise.all([
      // fetchAll: كانت limit(2000) تقصّ الإجماليات بصمت بينما فلتر «الكل» يوحي بالشمول
      fetchAll<any>((f, t) =>
        supabase.from('orders').select('id,merchant_code,platform,order_id,status,product_name,sku,quantity,unit_price,total_amount,gross_amount,platform_fee,shipping_cost,currency,customer_city,order_date,upload_id,shipment_package_id,cargo_tracking_number,cargo_provider,commission_rate,vat_rate,discount_amount,created_at').eq('merchant_code', merchantCode).order('order_date', { ascending: false }).range(f, t), 'الطلبات'),
      // snapshot_date مطلوب لتطبيق فلتر الفترة على لقطات تراندايول أيضاً
      fetchAll<any>((f, t) =>
        supabase.from('product_performance_snapshots').select('platform,sold,net_sold,cancelled,returned,gross_sales,snapshot_date')
          .eq('merchant_code', merchantCode).eq('platform', 'trendyol').order('id').range(f, t), 'لقطات الأداء'),
      fetchAll<any>((f, t) =>
        supabase.from('order_packages').select('id,order_id,shipment_package_id,status,provider_status,cargo_tracking_number,invoice_number,invoice_status,modified_at,raw')
          .eq('merchant_code', merchantCode).eq('platform', 'trendyol').order('modified_at', { ascending:false }).range(f, t), 'شحنات الطلبات'),
      supabase.from('returns').select('id', { count:'exact', head:true }).eq('merchant_code',merchantCode).eq('platform','trendyol').eq('status','pending'),
    ]).then(([o, t, packageRows, returnResult]) => {
      if (returnResult.error) throw returnResult.error
      setOrders(o)
      setTrendyolSnaps(t)
      setOperationalPackages(packageRows)
      setPendingReturnCount(returnResult.count || 0)
      const orderRef = new URLSearchParams(window.location.search).get('order')
      const linkedOrder = orderRef ? o.find(order => order.id === orderRef || order.order_id === orderRef) : null
      if (linkedOrder) void openOrder(linkedOrder)
      setLoading(false)
    }).catch(error => {
      console.error('load orders', error)
      setLoadError(userErrorMessage(error, 'تعذّر تحميل الطلبات الآن.'))
      setLoading(false)
    })
  }, [merchantCode, loadVersion])

  const filtered = useMemo(() => {
    let d = orders
    if (platform !== 'all') d = d.filter(o => o.platform === platform)
    if (status !== 'all') d = d.filter(o => o.status === status)
    if (search.trim()) {
      const q = search.toLowerCase()
      d = d.filter(o =>
        o.order_id.toLowerCase().includes(q) ||
        o.product_name?.toLowerCase().includes(q) ||
        o.customer_city?.toLowerCase().includes(q) ||
        o.cargo_tracking_number?.toLowerCase().includes(q)
      )
    }
    const now = Date.now()
    if (preset === 'today') d = d.filter(o => new Date(o.order_date).toDateString() === new Date().toDateString())
    else if (preset === 'last7')  d = d.filter(o => new Date(o.order_date).getTime() >= now - 7 * 86400000)
    else if (preset === 'last30') d = d.filter(o => new Date(o.order_date).getTime() >= now - 30 * 86400000)
    else if (preset === 'thisMonth') {
      const s = new Date(); s.setDate(1); s.setHours(0,0,0,0)
      d = d.filter(o => new Date(o.order_date) >= s)
    } else if (preset === 'needsAction') d = d.filter(orderNeedsAction)
    else if (preset === 'financialReview') d = d.filter(o => Boolean(orderFinancialIssue(o)))
    return d
  }, [orders, platform, status, search, preset])

  useEffect(() => { setOrderPage(0) }, [platform, status, search, preset])

  const totalPages = Math.ceil(filtered.length / ORDER_PAGE_SIZE)
  const pageRows   = filtered.slice(orderPage * ORDER_PAGE_SIZE, (orderPage + 1) * ORDER_PAGE_SIZE)

  // KPIs
  const totalRevenue  = filtered.reduce((s, o) => s + o.total_amount, 0)
  const totalOrders   = filtered.length
  const deliveredCount = filtered.filter(o => o.status === 'delivered').length
  const cancelRate    = totalOrders > 0 ? (filtered.filter(o => o.status === 'cancelled').length / totalOrders) * 100 : 0
  const aov           = totalOrders > 0 ? totalRevenue / totalOrders : 0
  const needsActionCount = orders.filter(orderNeedsAction).length
  const financialReviewCount = orders.filter(o => Boolean(orderFinancialIssue(o))).length
  const operationQueue = useMemo(() => buildOrderOperationQueue(orders, operationalPackages), [orders, operationalPackages])

  // Chart: orders per day
  const dailyData = useMemo(() => {
    const map: Record<string, { revenue: number; count: number }> = {}
    for (const o of filtered) {
      const d = o.order_date.split('T')[0]
      if (!map[d]) map[d] = { revenue: 0, count: 0 }
      map[d].revenue += o.total_amount
      map[d].count++
    }
    return Object.entries(map).sort(([a],[b]) => a.localeCompare(b)).slice(-30).map(([date, v]) => ({
      date: new Date(date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric' }),
      revenue: Math.round(v.revenue), count: v.count,
    }))
  }, [filtered])

  // Compare: per platform — يدمج الطلبات + لقطات تراندايول (لأنها aggregate وليست orders)
  const platformCompare = useMemo(() => {
    const map: Record<string, { revenue: number; count: number; delivered: number; cancelled: number; returned: number }> = {}
    for (const o of filtered) {
      if (!map[o.platform]) map[o.platform] = { revenue: 0, count: 0, delivered: 0, cancelled: 0, returned: 0 }
      map[o.platform].revenue += o.total_amount
      map[o.platform].count++
      if (o.status === 'delivered') map[o.platform].delivered++
      if (o.status === 'cancelled') map[o.platform].cancelled++
      if (o.status === 'returned')  map[o.platform].returned++
    }
    // لقطات تراندايول تخضع لنفس فلتر الفترة المختار (كانت تدخل بأرقامها التاريخية كلها)
    const now2 = Date.now()
    const snapInRange = (s: any) => {
      if (!s.snapshot_date) return true
      const t2 = new Date(s.snapshot_date).getTime()
      if (preset === 'today')     return new Date(s.snapshot_date).toDateString() === new Date().toDateString()
      if (preset === 'last7')     return t2 >= now2 - 7 * 86400000
      if (preset === 'last30')    return t2 >= now2 - 30 * 86400000
      if (preset === 'thisMonth') { const st = new Date(); st.setDate(1); st.setHours(0,0,0,0); return t2 >= st.getTime() }
      return true
    }
    for (const s of trendyolSnaps.filter(snapInRange)) {
      if (!map['trendyol']) map['trendyol'] = { revenue: 0, count: 0, delivered: 0, cancelled: 0, returned: 0 }
      map['trendyol'].revenue   += Number(s.gross_sales) || 0
      map['trendyol'].count     += s.sold || 0
      map['trendyol'].delivered += s.net_sold || 0
      map['trendyol'].cancelled += s.cancelled || 0
      map['trendyol'].returned  += s.returned || 0
    }
    return Object.entries(map).map(([p, v]) => ({
      platform: p, name: PLATFORM_MAP[p] || p,
      revenue: Math.round(v.revenue), count: v.count,
      deliveryRate: v.count > 0 ? ((v.delivered / v.count) * 100).toFixed(1) : '0.0',
      cancelRate:   v.count > 0 ? ((v.cancelled / v.count) * 100).toFixed(1) : '0.0',
      returnRate:   v.count > 0 ? ((v.returned / v.count) * 100).toFixed(1) : '0.0',
      aov: v.count > 0 ? Math.round(v.revenue / v.count) : 0,
    })).sort((a,b) => b.revenue - a.revenue)
  }, [filtered, trendyolSnaps, preset])

  const platforms = [...new Set(orders.map(o => o.platform))]

  function exportCSV() {
    import('../lib/excel').then(({ exportToExcel }) => {
      exportToExcel(filtered.map(o => ({
        'رقم الطلب': o.order_id,
        'المنصة': PLATFORM_MAP[o.platform] || o.platform,
        'المصدر': orderSource(o).exportLabel,
        'المنتج': o.product_name || '',
        'الحالة': STATUS_MAP[o.status]?.label || o.status,
        'الكمية': o.quantity,
        'المبلغ': o.total_amount,
        'رسوم المنصة': o.platform_fee || 0,
        'المدينة': o.customer_city || '',
        'التاريخ': new Date(o.order_date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'),
      })), `orders-${preset}-${new Date().toISOString().split('T')[0]}`, 'الطلبات')
    })
  }

  async function prepareBulkPicking() {
    if (!merchant || bulkPickingLoading) return
    const candidates = operationQueue.picking.slice(0, 20)
    if (!candidates.length) {
      setBulkMessage({ type:'err', text:'لا توجد شحنات جاهزة لبدء التجهيز الآن.' }); return
    }
    setBulkPickingLoading(true); setBulkMessage(null)
    try {
      const orderIds = [...new Set(candidates.map(row => row.order.order_id))]
      const { data:items,error } = await supabase.from('order_items').select('order_id,shipment_package_id,line_id,quantity')
        .eq('merchant_code',merchant.merchant_code).eq('platform','trendyol').in('order_id',orderIds)
      if (error) throw error
      const packageCountByOrder = new Map<string,number>()
      for (const row of operationQueue.rows) packageCountByOrder.set(row.order.order_id,(packageCountByOrder.get(row.order.order_id) || 0) + 1)
      const prepared = candidates.map(row => {
        const packageId = String(row.package.shipment_package_id)
        const lines = (items || []).filter(item => item.order_id === row.order.order_id &&
          (String(item.shipment_package_id || '') === packageId || (!item.shipment_package_id && packageCountByOrder.get(row.order.order_id) === 1)))
          .map(item => ({ lineId:Number(item.line_id), quantity:Number(item.quantity) }))
          .filter(line => Number.isFinite(line.lineId) && Number.isInteger(line.quantity) && line.quantity > 0)
        return { orderId:row.order.order_id, packageId, lines }
      }).filter(row => row.lines.length)
      if (!prepared.length) throw new Error('تفاصيل بنود الشحنات غير مكتملة. حدّث الطلبات من Trendyol ثم حاول مجددًا.')
      setBulkPickingRows(prepared)
      setBulkPickingOpen(true)
      if (prepared.length < candidates.length) setBulkMessage({ type:'err', text:`تم استبعاد ${(candidates.length - prepared.length).toLocaleString('ar-SA-u-nu-latn')} شحنة لأن تفاصيل بنودها غير مكتملة.` })
    } catch (error) {
      setBulkMessage({ type:'err', text:userErrorMessage(error,'تعذر تجهيز قائمة الشحنات.') })
    } finally { setBulkPickingLoading(false) }
  }

  async function submitBulkPicking() {
    if (!merchant || !bulkPickingRows.length || bulkPickingLoading) return
    setBulkPickingLoading(true); setBulkMessage(null)
    const succeeded:string[] = []
    const failed:Array<{ orderId:string; reason:string }> = []
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
      for (const row of bulkPickingRows) {
        try {
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
            method:'POST',
            headers:{ Authorization:`Bearer ${session.access_token}`, apikey:import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type':'application/json', 'idempotency-key':crypto.randomUUID() },
            body:JSON.stringify({ merchant_code:merchant.merchant_code, action:'packages.status', confirm:true, storefront:'SA', path:{ packageId:row.packageId }, payload:{ status:'Picking', lines:row.lines, params:{} } }),
          })
          const result = await response.json().catch(() => ({}))
          if (!response.ok || result.error) throw new Error(result.error || 'رفض Trendyol بدء التجهيز')
          succeeded.push(row.packageId)
        } catch (error) {
          failed.push({ orderId:row.orderId, reason:userErrorMessage(error,'تعذر بدء التجهيز') })
        }
      }
      if (succeeded.length) setOperationalPackages(current => current.map(row => succeeded.includes(String(row.shipment_package_id)) ? { ...row, provider_status:'Picking', status:'processing' } : row))
      setBulkPickingOpen(false); setBulkPickingRows([])
      setBulkMessage(failed.length
        ? { type:'err', text:`بدأ تجهيز ${succeeded.length.toLocaleString('ar-SA-u-nu-latn')} شحنة، وتعذر ${failed.length.toLocaleString('ar-SA-u-nu-latn')}. افتح الطلبات المتعثرة لمراجعة السبب.` }
        : { type:'ok', text:`تم بدء تجهيز ${succeeded.length.toLocaleString('ar-SA-u-nu-latn')} شحنة في Trendyol بنجاح.` })
    } catch (error) {
      setBulkMessage({ type:'err', text:userErrorMessage(error,'تعذر بدء التجهيز الجماعي.') })
    } finally { setBulkPickingLoading(false) }
  }

  async function openOrder(order: Order) {
    setSelectedOrder(order); setSelectedItems([]); setSelectedPackages([]); setActivePackageId(''); setSelectedActions([]); setSelectedProductCosts(new Map()); setInvoiceFile(null); setDetailLoading(true); setOrderActionMessage(null)
    const [detail, items, packages, actions] = await Promise.all([
      supabase.from('orders').select('raw,shipment_address,invoice_address,last_synced_at,gross_amount').eq('merchant_code', order.merchant_code).eq('id', order.id).maybeSingle(),
      supabase.from('order_items').select('*').eq('merchant_code', order.merchant_code).eq('platform', order.platform).eq('order_id', order.order_id).order('line_id'),
      supabase.from('order_packages').select('*').eq('merchant_code', order.merchant_code).eq('platform', order.platform).eq('order_id', order.order_id).order('modified_at', { ascending:false }),
      order.platform === 'trendyol'
        ? supabase.from('marketplace_action_logs').select('id,action,status,error_message,started_at,request').eq('merchant_code',order.merchant_code).eq('platform','trendyol').order('started_at',{ascending:false}).limit(50)
        : Promise.resolve({data:[] as any[]}),
    ])
    if (detail.data) setSelectedOrder(current => current ? ({ ...current, ...detail.data } as Order) : current)
    const packageRows = packages.data || []
    const packageIds = new Set(packageRows.map(item => String(item.shipment_package_id)))
    const initialPackageId = String(packageRows[0]?.shipment_package_id || order.shipment_package_id || '')
    setSelectedItems(items.data || [])
    setSelectedPackages(packageRows)
    setActivePackageId(initialPackageId)
    setSelectedActions((actions.data || []).filter(log => String(log.request?.path?.packageId || '') === initialPackageId && packageIds.has(initialPackageId)).slice(0,8))
    const detailItems = items.data || []
    const skus = [...new Set([order.sku, ...detailItems.map(item => item.sku)].filter(Boolean).map(String))]
    const barcodes = [...new Set(detailItems.map(item => item.barcode).filter(Boolean).map(String))]
    const [skuCosts, barcodeCosts] = await Promise.all([
      skus.length ? supabase.from('products').select('sku,barcode,cost_price').eq('merchant_code', order.merchant_code).in('sku', skus) : Promise.resolve({ data: [] }),
      barcodes.length ? supabase.from('products').select('sku,barcode,cost_price').eq('merchant_code', order.merchant_code).in('barcode', barcodes) : Promise.resolve({ data: [] }),
    ])
    const costs = new Map<string, number>()
    for (const product of [...(skuCosts.data || []), ...(barcodeCosts.data || [])]) {
      const cost = Number(product.cost_price || 0)
      if (cost <= 0) continue
      if (product.sku) costs.set(`sku:${String(product.sku).trim().toLowerCase()}`, cost)
      if (product.barcode) costs.set(`barcode:${String(product.barcode).trim().toLowerCase()}`, cost)
    }
    setSelectedProductCosts(costs)
    setDetailLoading(false)
  }

  function openOrderFromList(order: Order) {
    const url = new URL(window.location.href)
    url.searchParams.set('order', order.order_id)
    window.history.pushState(null, '', url.pathname + url.search)
    void openOrder(order)
  }

  function closeOrder() {
    setSelectedOrder(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('order')
    window.history.replaceState(null, '', url.pathname + url.search)
  }

  async function selectOrderPackage(packageId: string) {
    if (!selectedOrder) return
    setActivePackageId(packageId); setSelectedActions([]); setInvoiceFile(null); setOrderActionMessage(null)
    const { data } = await supabase.from('marketplace_action_logs').select('id,action,status,error_message,started_at,request')
      .eq('merchant_code', selectedOrder.merchant_code).eq('platform', 'trendyol')
      .contains('request', { path:{ packageId } }).order('started_at', { ascending:false }).limit(8)
    setSelectedActions(data || [])
  }

  async function copyOrderValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      setOrderActionMessage({ type:'ok', text:`تم نسخ ${label}.` })
    } catch {
      setOrderActionMessage({ type:'err', text:`تعذر نسخ ${label}.` })
    }
  }

  async function refreshSelectedOrder() {
    if (!merchant || !selectedOrder || selectedOrder.platform !== 'trendyol') return
    setOrderActionLoading(true); setOrderActionMessage(null)
    const { data, error } = await supabase.functions.invoke('sync-trendyol', { body: { merchant_code: merchant.merchant_code } })
    if (error || data?.error) {
      setOrderActionMessage({ type:'err', text:data?.error || error?.message || 'تعذر تحديث الطلب من Trendyol.' })
      setOrderActionLoading(false); return
    }
    const { data: fresh } = await supabase.from('orders').select('*').eq('id', selectedOrder.id).maybeSingle()
    if (fresh) {
      setSelectedOrder(fresh as Order)
      setOrders(current => current.map(order => order.id === fresh.id ? fresh as Order : order))
      await openOrder(fresh as Order)
    }
    setOrderActionMessage({ type:'ok', text:`تم التحديث من Trendyol. تمت مزامنة ${Number(data?.records_synced || 0).toLocaleString('ar-SA')} طلب.` })
    setOrderActionLoading(false)
  }

  async function runPackageAction(action:string, payload:Record<string,unknown>, label:string) {
    if (!merchant || !selectedOrder || !activePackageId) return
    if (action === 'packages.status' && (!Array.isArray(payload.lines) || payload.lines.some((line:any) => !Number.isFinite(line.lineId) || line.quantity < 1))) {
      setOrderActionMessage({ type:'err', text:'تفاصيل بنود الطلب غير مكتملة. حدّث الطلب من Trendyol ثم حاول مجددًا.' }); return
    }
    if (!window.confirm(`تأكيد ${label} وإرساله إلى Trendyol؟`)) return
    setOrderActionLoading(true); setOrderActionMessage(null)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
        method:'POST', headers:{ Authorization:`Bearer ${session.access_token}`, apikey:import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type':'application/json', 'idempotency-key':crypto.randomUUID() },
        body:JSON.stringify({ merchant_code:merchant.merchant_code, action, confirm:true, storefront:'SA', path:{ packageId:activePackageId }, payload }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || `رفض Trendyol ${label}`)
      setSelectedActions(current => [{ id:crypto.randomUUID(), action, status:result.status || 'success', error_message:null, started_at:new Date().toISOString() }, ...current].slice(0,8))
      setSelectedPackages(current => current.map(packageRow => {
        if (String(packageRow.shipment_package_id) !== activePackageId) return packageRow
        if (action === 'packages.status') return {
          ...packageRow,
          status:'processing',
          provider_status:String(payload.status || packageRow.provider_status || ''),
          invoice_number:(payload as any)?.params?.invoiceNumber || packageRow.invoice_number,
        }
        if (action === 'packages.tracking') return {
          ...packageRow,
          cargo_tracking_number:String(payload.cargoSenderNumber || packageRow.cargo_tracking_number || ''),
          cargo_provider:String(payload.providerCode || packageRow.cargo_provider || ''),
        }
        return packageRow
      }))
      setOrderActionMessage({ type:'ok', text:`تم ${label} في Trendyol بنجاح.` })
      return true
    } catch (error:any) {
      console.error('order marketplace action', error)
      setOrderActionMessage({ type:'err', text:userErrorMessage(error, `تعذّر ${label}.`) })
      return false
    } finally { setOrderActionLoading(false) }
  }

  async function runPackageLabelAction(action:'packages.common_label_create'|'packages.common_label_get') {
    if (!merchant || !activePackage) return
    const trackingNumber = String(activePackage.cargo_tracking_number || '').trim()
    if (!trackingNumber) {
      setOrderActionMessage({ type:'err', text:'رقم التتبع غير متوفر لهذه الشحنة. سجّل بيانات الشحن أولًا.' })
      return
    }
    const creating = action === 'packages.common_label_create'
    if (creating && !window.confirm('تأكيد طلب إنشاء ملصق شحن من Trendyol؟')) return
    setOrderActionLoading(true); setOrderActionMessage(null)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
        method:'POST', headers:{ Authorization:`Bearer ${session.access_token}`, apikey:import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type':'application/json', 'idempotency-key':crypto.randomUUID() },
        body:JSON.stringify({
          merchant_code:merchant.merchant_code, action, confirm:true, storefront:'SA',
          path:{ cargoTrackingNumber:trackingNumber },
          payload:creating ? { format:'ZPL', boxQuantity:1 } : undefined,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || 'رفض Trendyol عملية الملصق')
      if (creating) {
        setOrderActionMessage({ type:'ok', text:'تم طلب إنشاء الملصق. انتظر قليلًا ثم اضغط «تنزيل الملصق».' })
      } else {
        const base64 = result?.data?.data_base64
        const labels = Array.isArray(result?.data?.data) ? result.data.data.map((item:any) => item?.label).filter(Boolean) : []
        const inlineLabel = result?.data?.label || labels.join('\n')
        if (!base64 && !inlineLabel) throw new Error('لم يصبح الملصق جاهزًا بعد. حاول التنزيل بعد قليل.')
        const blob = base64
          ? new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type:result.data.content_type || 'application/octet-stream' })
          : new Blob([inlineLabel], { type:'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `trendyol-label-${trackingNumber}.zpl`; anchor.click()
        URL.revokeObjectURL(url)
        setOrderActionMessage({ type:'ok', text:'تم تنزيل ملصق الشحن.' })
      }
      setSelectedActions(current => [{ id:crypto.randomUUID(), action, status:'success', error_message:null, started_at:new Date().toISOString() }, ...current].slice(0,8))
    } catch (error:any) {
      console.error('Trendyol shipping label', error)
      setOrderActionMessage({ type:'err', text:userErrorMessage(error, 'تعذّر تجهيز ملصق الشحن.') })
    } finally { setOrderActionLoading(false) }
  }

  function chooseInvoiceFile(file: File | null) {
    setOrderActionMessage(null)
    if (!file) { setInvoiceFile(null); return }
    const type = invoiceMime(file)
    if (!Object.values(INVOICE_TYPES).includes(type)) {
      setInvoiceFile(null); setOrderActionMessage({ type:'err', text:'اختر فاتورة بصيغة PDF أو JPG أو PNG.' }); return
    }
    if (file.size > INVOICE_MAX_BYTES) {
      setInvoiceFile(null); setOrderActionMessage({ type:'err', text:'حجم ملف الفاتورة يجب ألا يتجاوز 10 ميجابايت.' }); return
    }
    if (!file.size) {
      setInvoiceFile(null); setOrderActionMessage({ type:'err', text:'ملف الفاتورة فارغ.' }); return
    }
    setInvoiceFile(file)
  }

  async function uploadInvoiceFile() {
    if (!merchant || !activePackageId || !invoiceFile) return
    if (!window.confirm(`تأكيد رفع «${invoiceFile.name}» إلى فاتورة هذه الشحنة في Trendyol؟`)) return
    setOrderActionLoading(true); setOrderActionMessage(null)
    try {
      const { data:{ session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('انتهت جلسة الدخول. حدّث الصفحة ثم حاول مجددًا.')
      const invoiceNumber = packageForm.invoiceNumber.trim()
      const microExportNumber = /^[A-Za-z0-9]{3}\d{13}$/.test(invoiceNumber) ? invoiceNumber : undefined
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trendyol-actions`, {
        method:'POST',
        headers:{ Authorization:`Bearer ${session.access_token}`, apikey:import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type':'application/json', 'idempotency-key':crypto.randomUUID() },
        body:JSON.stringify({
          merchant_code:merchant.merchant_code,
          action:'invoices.send_file',
          confirm:true,
          storefront:'SA',
          path:{ packageId:activePackageId },
          payload:{
            shipmentPackageId:activePackageId,
            fileName:invoiceFile.name,
            contentType:invoiceMime(invoiceFile),
            dataBase64:await fileToBase64(invoiceFile),
            ...(microExportNumber ? { invoiceNumber:microExportNumber, invoiceDateTime:String(Date.now()) } : {}),
          },
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || 'رفض Trendyol ملف الفاتورة')
      setSelectedPackages(current => current.map(packageRow => String(packageRow.shipment_package_id) === activePackageId
        ? { ...packageRow, invoice_status:'sent', invoice_number:invoiceNumber || packageRow.invoice_number }
        : packageRow))
      setSelectedActions(current => [{ id:crypto.randomUUID(), action:'invoices.send_file', status:'success', error_message:null, started_at:new Date().toISOString() }, ...current].slice(0,8))
      setInvoiceFile(null)
      setOrderActionMessage({ type:'ok', text:'تم رفع ملف الفاتورة إلى Trendyol وربطه بالشحنة بنجاح.' })
    } catch (error:any) {
      console.error('Trendyol invoice upload', error)
      setOrderActionMessage({ type:'err', text:userErrorMessage(error, 'تعذّر رفع ملف الفاتورة إلى Trendyol.') })
    } finally { setOrderActionLoading(false) }
  }

  const activePackage = selectedPackages.find(item => String(item.shipment_package_id) === activePackageId) || null
  const activePackageItems = selectedItems.filter(item => !item.shipment_package_id || String(item.shipment_package_id) === activePackageId)
  const packageWorkflow = trendyolPackageWorkflow(activePackage, selectedOrder?.status)
  const selectedOrderFees = selectedOrder?.platform === 'trendyol'
    ? (selectedItems.length
      ? selectedItems.reduce((sum, item) => sum + Number(item.line_total || Number(item.unit_price || 0) * Number(item.quantity || 1)) * Number(item.commission_rate || 0) / 100 * 1.15, 0)
      : selectedOrder ? trendyolCommission(selectedOrder) : 0)
    : Number(selectedOrder?.platform_fee || 0)
  const selectedOrderProfit = selectedOrder
    ? calculateOrderProfit(selectedOrder, selectedItems, selectedProductCosts, selectedOrderFees)
    : null

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:400 }}>
      <div style={{ width:36, height:36, border:'3px solid var(--border)', borderTopColor:'var(--accent)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (loadError) return (
    <div style={S.wrap}>
      <PageTabs tabs={[{ label: 'الطلبات', path: '/orders' }, { label: 'الأرباح والتسويات', path: '/statement' }]} />
      <div style={{ maxWidth:520, margin:'70px auto', padding:24, textAlign:'center', border:'1px solid var(--border)', borderRadius:12, background:'var(--surface)' }}>
        <h2 style={{ margin:'0 0 8px', fontSize:18 }}>تعذر تحميل الطلبات</h2>
        <p style={{ margin:'0 0 18px', color:'var(--text2)', fontSize:13, lineHeight:1.8 }}>{loadError}</p>
        <button onClick={() => setLoadVersion(value => value + 1)} style={S.exportBtn}>إعادة المحاولة</button>
      </div>
    </div>
  )

  // التبويبات قبل الحالة الفارغة: تاجر تراندايول-فقط (بياناته لقطات لا طلبات) كان يفقد
  // الوصول إلى «الصافي المستحق» كلياً. والرسالة توافق النموذج المُدار (الفريق يرفع، لا التاجر).
  if (orders.length === 0 && trendyolSnaps.length === 0) return (
    <div style={S.wrap}>
      <PageTabs tabs={[{ label: 'الطلبات', path: '/orders' }, { label: 'الأرباح والتسويات', path: '/statement' }]} />
      <div style={{ padding:'60px 32px', textAlign:'center', maxWidth:480, margin:'0 auto' }}>
          <div style={{ fontSize:14, fontWeight:800, marginBottom:10 }}>لا توجد طلبات بعد</div>
        <h2 style={{ fontSize:20, fontWeight:800, marginBottom:8 }}>لا توجد طلبات بعد</h2>
        <p style={{ fontSize:13, color:'var(--text3)', lineHeight:1.8, marginBottom:28 }}>
          اربط Trendyol للمزامنة المباشرة، أو ارفع ملف Amazon أو Noon أو سلة أو زد، وستظهر الطلبات هنا دون تدخل الإدارة.
        </p>
        <button onClick={() => { window.history.pushState(null,'','/integrations'); window.dispatchEvent(new PopStateEvent('popstate')) }}
          style={{ background:'var(--accent-strong)', border:'none', color:'#fff', padding:'12px 28px', borderRadius:12, fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
          الربط ورفع الملفات
        </button>
      </div>
    </div>
  )

  return (
    <div style={S.wrap}>
      <PageTabs tabs={[{ label: 'الطلبات', path: '/orders' }, { label: 'الأرباح والتسويات', path: '/statement' }]} />
      {/* TOPBAR */}
      <div style={S.topbar}>
        <div>
          <h2 style={S.pageTitle}>الطلبات</h2>
          <p style={S.pageSub}>عرض {totalOrders.toLocaleString()} من أصل {orders.length.toLocaleString()} طلب</p>
        </div>
        <button style={S.exportBtn} onClick={exportCSV}>تصدير CSV</button>
      </div>

      <section aria-label="مركز تشغيل الطلبات" style={{ ...S.card, padding:18, marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:14, flexWrap:'wrap' }}>
          <div><div style={{ fontSize:14, fontWeight:850 }}>مركز تشغيل الطلبات</div><div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7, marginTop:4 }}>طوابير العمل المستخرجة من حالة شحنات Trendyol الفعلية. ابدأ التجهيز جماعيًا، ثم أكمل الفاتورة والشحن من الطلب.</div></div>
          <button disabled={!operationQueue.picking.length || bulkPickingLoading} onClick={() => void prepareBulkPicking()} style={{ ...S.primaryBtn, opacity:operationQueue.picking.length && !bulkPickingLoading ? 1 : .5 }}>{bulkPickingLoading && !bulkPickingOpen ? 'جارٍ تجهيز القائمة…' : 'بدء تجهيز الشحنات الجاهزة'}</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr 1fr' : 'repeat(4,minmax(130px,1fr))', gap:8, marginTop:14 }}>
          {[
            ['بانتظار التجهيز',operationQueue.picking.length,'يبدأ من هنا'],
            ['بانتظار الفاتورة',operationQueue.invoicing.length,'افتح الطلب'],
            ['ينقصها بيانات الشحن',operationQueue.tracking.length,'افتح الطلب'],
            ['مرتجعات تحتاج قرار',pendingReturnCount,'راجع المرتجعات'],
          ].map(([label,value,hint]) => <button key={String(label)} onClick={() => { if (label === 'مرتجعات تحتاج قرار') { window.history.pushState(null,'','/statement?tab=returns'); window.dispatchEvent(new PopStateEvent('popstate')); return } setTab('list'); setPlatform('trendyol'); setStatus(label === 'بانتظار التجهيز' ? 'pending' : 'processing') }} style={{ textAlign:'right', padding:'11px 12px', border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)', color:'var(--text)', cursor:'pointer', fontFamily:'inherit' }}><span style={{ display:'block', color:'var(--text3)', fontSize:10 }}>{label}</span><strong style={{ display:'block', fontSize:19, marginTop:2 }}>{Number(value).toLocaleString('ar-SA-u-nu-latn')}</strong><small style={{ color:'var(--accent)', fontSize:9 }}>{hint}</small></button>)}
        </div>
        {bulkMessage ? <div role="status" style={{ marginTop:12, padding:'10px 12px', borderRadius:9, background:bulkMessage.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color:bulkMessage.type === 'ok' ? 'var(--accent2)' : 'var(--danger-text)', fontSize:11, lineHeight:1.7 }}>{bulkMessage.text}</div> : null}
      </section>

      {/* FILTERS */}
      <div style={S.filtersRow}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {[
            { k:'today', l:'اليوم' }, { k:'last7', l:'7 أيام' },
            { k:'last30', l:'30 يوم' }, { k:'thisMonth', l:'هذا الشهر' },
            { k:'needsAction', l:`تحتاج إجراء (${needsActionCount.toLocaleString('ar-SA')})` },
            { k:'financialReview', l:`مراجعة مالية (${financialReviewCount.toLocaleString('ar-SA')})` },
            { k:'all', l:'الكل' },
          ].map(p => (
            <button key={p.k} style={{ ...S.pill, ...(preset===p.k ? S.pillActive : {}) }} onClick={() => setPreset(p.k)}>{p.l}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          <select aria-label="تصفية الطلبات حسب المنصة" style={S.select} value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="all">كل المنصات</option>
            {platforms.map(p => <option key={p} value={p}>{PLATFORM_MAP[p] || p}</option>)}
          </select>
          <select aria-label="تصفية الطلبات حسب الحالة" style={S.select} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">كل الحالات</option>
            {(Object.keys(STATUS_MAP) as OrderStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_MAP[s].label}</option>
            ))}
          </select>
          <input
            style={{ ...S.select, flex:1, minWidth:200 }}
            placeholder="ابحث برقم الطلب أو المنتج أو رقم التتبع..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {(platform !== 'all' || status !== 'all' || preset !== 'all' || search.trim()) && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, margin:'-8px 0 16px', padding:'10px 12px', border:'1px solid var(--border)', borderRadius:10, background:'var(--surface)' }}>
          <span style={{ fontSize:12, color:'var(--text2)' }}>هناك فلاتر مفعّلة — تظهر {filtered.length.toLocaleString()} من {orders.length.toLocaleString()} طلب</span>
          <button onClick={() => { setPlatform('all'); setStatus('all'); setPreset('all'); setSearch('') }} style={{ border:'none', background:'transparent', color:'var(--accent)', fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>مسح كل الفلاتر</button>
        </div>
      )}

      {/* KPIs */}
      <div style={{ ...S.kpisGrid, gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)' }}>
        {[
          { label:'إجمالي الإيراد',   value: fmt(totalRevenue),               icon:'', color:'#0f958c' },
          { label:'عدد الطلبات',      value: totalOrders.toLocaleString(),     icon:'', color:'var(--success-text)' },
          { label:'متوسط الطلب',      value: fmt(aov),                         icon:'', color:'var(--warning-text)' },
          { label:'تم التسليم',       value: deliveredCount.toLocaleString(),  icon:'', color:'var(--success-text)' },
          { label:'نسبة الإلغاء',     value: cancelRate.toFixed(1) + '%',      icon:'', color:'var(--danger-text)' },
        ].map((k,i) => (
          <div key={i} style={S.kpiCard}>
            <div style={{ ...S.kpiBar, background:k.color }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={S.kpiLabel}>{k.label}</span>
              <span style={{ fontSize:18 }}>{k.icon}</span>
            </div>
            <div style={{ ...S.kpiValue, color:k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'1px solid var(--border)', paddingBottom:0 }}>
        {([['list','قائمة الطلبات'], ['compare','مقارنة المنصات'], ['chart','الرسوم البيانية']] as const).map(([k,l]) => (
          <button
            key={k}
            style={{ ...S.tabBtn, ...(tab===k ? S.tabActive : {}) }}
            onClick={() => setTab(k)}
          >{l}</button>
        ))}
      </div>

      {/* TAB: LIST */}
      {tab === 'list' && (
        <div style={S.card}>
          <div style={{ overflowX:'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {['رقم الطلب','المنصة','المصدر','المنتج','الكمية','المبلغ','رسوم المنصة','المدينة','الحالة','التاريخ'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding:'50px', textAlign:'center', color:'var(--text3)' }}>
                    لا توجد طلبات في هذه الفترة
                  </td></tr>
                ) : pageRows.map(o => (
                  <tr key={o.id} style={S.tr}>
                    <td style={{ ...S.td, fontFamily:'monospace', fontSize:11 }}>
                      <button onClick={() => openOrderFromList(o)} style={S.orderLink} title="فتح تفاصيل الطلب">
                        {o.order_id}
                      </button>
                    </td>
                    <td style={S.td}>
                      <span style={{ ...S.platformTag, background:(PLATFORM_COLORS[o.platform]||'#5a5a7a')+'22', color:o.platform === 'trendyol' ? '#9a3f00' : PLATFORM_COLORS[o.platform]||'#5a5a7a' }}>
                        {PLATFORM_MAP[o.platform] || o.platform}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span title={orderSource(o).title} style={{ ...S.statusBadge, background:orderSource(o).bg, color:orderSource(o).color, whiteSpace:'nowrap' }}>
                        {orderSource(o).label}
                      </span>
                    </td>
                    <td style={{ ...S.td, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {o.product_name || '—'}
                    </td>
                    <td style={{ ...S.td, textAlign:'center' }}>{o.quantity}</td>
                    <td style={{ ...S.td, fontWeight:700 }}>{fmt(o.total_amount)}</td>
                    <td style={{ ...S.td, color:'var(--text3)', fontVariantNumeric:'tabular-nums' }}>{o.platform === 'trendyol' ? fmtExact(trendyolCommission(o)) : fmt(o.platform_fee || 0)}</td>
                    <td style={{ ...S.td, color:'var(--text2)', fontSize:12 }}>{o.customer_city || '—'}</td>
                    <td style={S.td}>
                      <span style={{ ...S.statusBadge, background:STATUS_MAP[o.status]?.bg, color:STATUS_MAP[o.status]?.color }}>
                        {STATUS_MAP[o.status]?.label || o.status}
                      </span>
                    </td>
                    <td style={{ ...S.td, fontSize:11, color:'var(--text3)' }}>
                      {new Date(o.order_date).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderTop:'1px solid var(--border)' }}>
              <span style={{ fontSize:12, color:'var(--text3)' }}>
                {orderPage * ORDER_PAGE_SIZE + 1}–{Math.min((orderPage + 1) * ORDER_PAGE_SIZE, filtered.length)} من {filtered.length.toLocaleString()} طلب
              </span>
              <div style={{ display:'flex', gap:8 }}>
                <button
                  onClick={() => setOrderPage(p => Math.max(0, p - 1))}
                  disabled={orderPage === 0}
                  style={{ ...S.pageBtn, opacity: orderPage === 0 ? 0.4 : 1 }}
                >›</button>
                <span style={{ fontSize:12, color:'var(--text2)', padding:'0 4px', alignSelf:'center' }}>
                  {orderPage + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setOrderPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={orderPage >= totalPages - 1}
                  style={{ ...S.pageBtn, opacity: orderPage >= totalPages - 1 ? 0.4 : 1 }}
                >‹</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: COMPARE */}
      {tab === 'compare' && (
        <div>
          {platformCompare.length === 0 ? (
            <div style={{ ...S.card, padding:50, textAlign:'center', color:'var(--text3)' }}>لا توجد بيانات</div>
          ) : (
            <>
              {/* Platform cards */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:16, marginBottom:20 }}>
                {platformCompare.map(p => (
                  <div key={p.platform} style={{ ...S.card, padding:20, borderTop:`3px solid ${PLATFORM_COLORS[p.platform]||'#0f958c'}` }}>
                    <div style={{ fontSize:16, fontWeight:800, marginBottom:14, color:PLATFORM_COLORS[p.platform]||'#0f958c' }}>
                      {p.name}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                      {[
                        { label:'الإيراد',       value: fmt(p.revenue) },
                        { label:'الطلبات',       value: p.count.toLocaleString() },
                        { label:'متوسط الطلب',  value: fmt(p.aov) },
                        { label:'نسبة التسليم',  value: p.deliveryRate + '%' },
                        { label:'نسبة الإلغاء',  value: p.cancelRate + '%' },
                      ].map((item,i) => (
                        <div key={i} style={{ background:'var(--bg)', borderRadius:8, padding:'8px 12px' }}>
                          <div style={{ fontSize:10, color:'var(--text3)', fontWeight:700, marginBottom:3 }}>{item.label}</div>
                          <div style={{ fontSize:14, fontWeight:800, color:'var(--text)' }}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Bar comparison */}
              <div style={{ ...S.card, padding:20 }}>
                <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>مقارنة الإيراد بين المنصات</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={platformCompare} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fill:'var(--text3)', fontSize:11 }} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(0)+'k' : String(v)} />
                    <YAxis type="category" dataKey="name" tick={{ fill:'var(--text)', fontSize:12 }} width={70} />
                    <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:10, color:'var(--text)' }} formatter={(v:number) => [fmt(v), 'الإيراد']} />
                    <Bar dataKey="revenue" radius={[0,6,6,0]}>
                      {platformCompare.map((p,i) => (
                        <Cell key={i} fill={PLATFORM_COLORS[p.platform]||'#0f958c'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB: CHART */}
      {tab === 'chart' && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16 }}>
          <div style={{ ...S.card, padding:20 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>الإيراد اليومي</div>
            {dailyData.length === 0 ? (
              <div style={{ height:200, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)' }}>لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fill:'var(--text3)', fontSize:10 }} />
                  <YAxis tick={{ fill:'var(--text3)', fontSize:10 }} tickFormatter={v => v>=1000?(v/1000).toFixed(0)+'k':v} />
                  <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:10, color:'var(--text)' }} formatter={(v:number) => [fmt(v), 'الإيراد']} />
                  <Line type="monotone" dataKey="revenue" stroke="#0f958c" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div style={{ ...S.card, padding:20 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:16 }}>عدد الطلبات اليومي</div>
            {dailyData.length === 0 ? (
              <div style={{ height:200, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)' }}>لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fill:'var(--text3)', fontSize:10 }} />
                  <YAxis tick={{ fill:'var(--text3)', fontSize:10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:10, color:'var(--text)' }} formatter={(v:number) => [v, 'طلب']} />
                  <Bar dataKey="count" fill="var(--green)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {bulkPickingOpen && (
        <div style={S.modalBackdrop} onClick={() => !bulkPickingLoading && setBulkPickingOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="مراجعة بدء تجهيز الشحنات" style={{ ...S.modal, maxWidth:620 }} onClick={event => event.stopPropagation()}>
            <div style={S.modalHeader}><div><div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>إجراء جماعي</div><div style={{ fontSize:18, fontWeight:800 }}>مراجعة بدء تجهيز الشحنات</div></div><button disabled={bulkPickingLoading} onClick={() => setBulkPickingOpen(false)} style={S.closeBtn} aria-label="إغلاق">×</button></div>
            <p style={{ fontSize:12, color:'var(--text2)', lineHeight:1.8, margin:'0 0 12px' }}>سيُرسل طلب مستقل وآمن لكل شحنة. نجاح شحنة لا يعتمد على بقية الدفعة، ولن نكرر الشحنات التي نجحت إذا تعثرت أخرى.</p>
            <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', maxHeight:300, overflowY:'auto' }}>
              {bulkPickingRows.map((row,index) => <div key={row.packageId} style={{ display:'grid', gridTemplateColumns:'36px minmax(0,1fr) 100px', gap:8, alignItems:'center', padding:'10px 12px', borderBottom:index < bulkPickingRows.length - 1 ? '1px solid var(--border)' : 'none', fontSize:11 }}><span style={{ color:'var(--text3)' }}>{index + 1}</span><strong style={{ fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis' }}>{row.orderId}</strong><span>{row.lines.length.toLocaleString('ar-SA-u-nu-latn')} بند</span></div>)}
            </div>
            <div style={{ padding:'10px 12px', borderRadius:9, background:'var(--warning-bg)', color:'var(--warning-text)', fontSize:11, lineHeight:1.7 }}>سيتم تغيير حالة هذه الشحنات إلى «قيد التجهيز» مباشرة في Trendyol. الحد الأقصى في الدفعة الواحدة 20 شحنة.</div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}><button disabled={bulkPickingLoading} onClick={() => setBulkPickingOpen(false)} style={S.actionBtn}>العودة</button><button disabled={bulkPickingLoading} onClick={() => void submitBulkPicking()} style={S.primaryBtn}>{bulkPickingLoading ? 'جارٍ تنفيذ الدفعة…' : `تأكيد بدء تجهيز ${bulkPickingRows.length.toLocaleString('ar-SA-u-nu-latn')} شحنة`}</button></div>
          </div>
        </div>
      )}

      {selectedOrder && (
        <div style={S.modalBackdrop} onClick={closeOrder}>
          <div role="dialog" aria-modal="true" aria-label={`تفاصيل الطلب ${selectedOrder.order_id}`} style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div>
                <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>تفاصيل الطلب</div>
                <div style={{ fontSize:18, fontWeight:800, fontFamily:'monospace' }}>{selectedOrder.order_id}</div>
              </div>
              <button onClick={closeOrder} style={S.closeBtn} aria-label="إغلاق">×</button>
            </div>

            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
              <button onClick={() => void copyOrderValue(selectedOrder.order_id, 'رقم الطلب')} style={S.actionBtn}>نسخ رقم الطلب</button>
              {(activePackage?.cargo_tracking_number || selectedOrder.cargo_tracking_number) ? <button onClick={() => void copyOrderValue(String(activePackage?.cargo_tracking_number || selectedOrder.cargo_tracking_number), 'رقم التتبع')} style={S.actionBtn}>نسخ رقم التتبع</button> : null}
              {selectedOrder.platform === 'trendyol' ? <button onClick={() => void refreshSelectedOrder()} disabled={orderActionLoading} style={{ ...S.actionBtn, color:'var(--accent)', borderColor:'rgba(15,149,140,.35)', opacity:orderActionLoading ? .6 : 1 }}>{orderActionLoading ? 'جارٍ التحديث...' : 'تحديث من Trendyol'}</button> : null}
            </div>
            {orderActionMessage ? <div style={{ marginBottom:14, padding:'9px 11px', borderRadius:8, fontSize:11, background:orderActionMessage.type === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color:orderActionMessage.type === 'ok' ? 'var(--success-text)' : 'var(--danger-text)' }}>{orderActionMessage.text}</div> : null}
            {orderFinancialIssue(selectedOrder) ? <div style={{ marginBottom:14, padding:'10px 12px', borderRadius:8, background:'var(--warning-bg)', border:'1px solid rgba(245,166,35,.35)' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'var(--warning-text)' }}>القيم المالية تحتاج مراجعة</div>
              <div style={{ fontSize:11, color:'var(--text2)', marginTop:3 }}>{orderFinancialIssue(selectedOrder)} راجع تعريف أعمدة الملف قبل الاعتماد على ربحية هذا الطلب.</div>
            </div> : null}
            {selectedOrderProfit ? <section style={{ marginBottom:16, padding:14, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'flex-start', marginBottom:11 }}>
                <div><div style={{ fontSize:12, fontWeight:850 }}>صافي الطلب</div><div style={{ fontSize:10, color:'var(--text3)', marginTop:3, lineHeight:1.6 }}>الإجمالي ناقص عمولة المنصة والشحن والخصومات وتكلفة المنتجات المسجلة.</div></div>
                <div style={{ textAlign:'left' }}>
                  <strong style={{ display:'block', fontSize:18, color:selectedOrderProfit.netProfit === null ? 'var(--warning-text)' : selectedOrderProfit.netProfit >= 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>
                    {selectedOrderProfit.netProfit === null ? 'غير مكتمل' : fmtExact(selectedOrderProfit.netProfit)}
                  </strong>
                  <small style={{ color:'var(--text3)', fontSize:9 }}>{selectedOrderProfit.costComplete ? 'محسوب من البيانات المتاحة' : `ينقص تكلفة ${selectedOrderProfit.missingCostUnits.toLocaleString('ar-SA-u-nu-latn')} وحدة`}</small>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(105px,1fr))', gap:7 }}>
                {[
                  [selectedOrderProfit.usesGrossAmount ? 'قبل الخصم' : 'إجمالي الطلب', selectedOrderProfit.revenue],
                  ['عمولة المنصة', -selectedOrderProfit.fees],
                  ['الشحن', -selectedOrderProfit.shipping],
                  ['الخصومات', -selectedOrderProfit.discounts],
                  ['تكلفة المنتجات', selectedOrderProfit.costComplete ? -selectedOrderProfit.productCost : null],
                ].map(([label,value]) => <div key={String(label)} style={{ padding:'8px 9px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface)' }}>
                  <div style={{ fontSize:9, color:'var(--text3)', marginBottom:4 }}>{label}</div>
                  <div style={{ fontSize:11, fontWeight:800, color:Number(value) < 0 ? 'var(--danger-text)' : 'var(--text)' }}>{value === null ? 'غير متاح' : fmtExact(Number(value))}</div>
                </div>)}
              </div>
              {!selectedOrderProfit.costComplete ? <button onClick={() => { closeOrder(); window.history.pushState(null,'','/products?costs=import'); window.dispatchEvent(new PopStateEvent('popstate')) }} style={{ ...S.actionBtn, marginTop:10, color:'var(--accent)', borderColor:'rgba(15,149,140,.35)' }}>استكمال تكاليف المنتجات</button> : null}
            </section> : null}
            {selectedPackages.length ? <div style={{ marginBottom:16, padding:13, border:'1px solid var(--border)', borderRadius:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:10 }}>
                <div><div style={{ fontSize:12, fontWeight:800 }}>شحنات الطلب</div><div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>اختر الشحنة لعرض حالتها وشركة الشحن ورقم التتبع. إجراءات التنفيذ المباشر تظهر فقط عندما تدعمها المنصة.</div></div>
                <span style={{ ...S.statusBadge, background:'var(--surface2)', color:'var(--text2)' }}>{selectedPackages.length.toLocaleString('ar-SA')} شحنة</span>
              </div>
              <div style={{ display:'flex', gap:7, overflowX:'auto', paddingBottom:4 }}>
                {selectedPackages.map((shipment, index) => {
                  const selected = String(shipment.shipment_package_id) === activePackageId
                  return <button key={shipment.id} onClick={() => void selectOrderPackage(String(shipment.shipment_package_id))} style={{ ...S.actionBtn, minWidth:120, borderColor:selected ? 'var(--accent)' : 'var(--border)', color:selected ? 'var(--accent)' : 'var(--text2)', background:selected ? 'rgba(15,149,140,.08)' : 'var(--surface)' }}>
                    الشحنة {index + 1} · {packageStatusLabel(shipment.provider_status || shipment.raw?.shipmentPackageStatus || shipment.raw?.status || shipment.status)}
                  </button>
                })}
              </div>
              {activePackage ? <div style={{ ...S.detailGrid, marginTop:10 }}>
                {[
                  ['حالة الشحنة', packageStatusLabel(packageWorkflow.providerStatus || activePackage.status)],
                  ['شركة الشحن', activePackage.cargo_provider || '—'],
                  ['رقم التتبع', activePackage.cargo_tracking_number || '—'],
                  ['حالة الفاتورة', activePackage.invoice_status ? packageStatusLabel(activePackage.invoice_status) : activePackage.invoice_number ? 'مسجلة' : 'غير مسجلة'],
                ].map(([label,value]) => <div key={label} style={S.detailItem}><div style={S.detailLabel}>{label}</div><div style={S.detailValue}>{value}</div></div>)}
              </div> : null}
            </div> : null}
            {selectedOrder.platform === 'trendyol' && activePackageId ? <div style={{ marginBottom:16, padding:13, border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
              <div style={{ fontSize:12, fontWeight:800, marginBottom:4 }}>إجراءات تنفيذ الطلب</div>
              <div style={{ fontSize:10, color:'var(--text3)', lineHeight:1.6, marginBottom:10 }}>{packageWorkflow.guidance} كل إجراء يُرسل مباشرة إلى Trendyol ويُحفظ في سجل التدقيق.</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                <button disabled={orderActionLoading || !packageWorkflow.canStartPicking || activePackageItems.length === 0} onClick={() => void runPackageAction('packages.status', { lines:activePackageItems.map(item => ({ lineId:Number(item.line_id), quantity:Number(item.quantity) })), params:{}, status:'Picking' }, 'بدء تجهيز الطلب')} style={{...S.actionBtn,opacity:packageWorkflow.canStartPicking ? 1 : .5}}>بدء التجهيز</button>
                <input disabled={!packageWorkflow.canInvoice} value={packageForm.invoiceNumber} onChange={e => setPackageForm({...packageForm,invoiceNumber:e.target.value})} placeholder="رقم الفاتورة" style={{...S.select,minWidth:150,opacity:packageWorkflow.canInvoice ? 1 : .55}}/>
                <button disabled={orderActionLoading || !packageWorkflow.canInvoice || activePackageItems.length === 0 || !packageForm.invoiceNumber.trim()} onClick={() => void runPackageAction('packages.status', { lines:activePackageItems.map(item => ({ lineId:Number(item.line_id), quantity:Number(item.quantity) })), params:{ invoiceNumber:packageForm.invoiceNumber.trim() }, status:'Invoiced' }, 'تسجيل إصدار الفاتورة')} style={{...S.actionBtn,opacity:packageWorkflow.canInvoice ? 1 : .5}}>تسجيل الفاتورة</button>
              </div>
              <div style={{ marginBottom:10, padding:10, border:'1px solid var(--border)', borderRadius:9, background:'var(--surface)' }}>
                <div style={{ fontSize:11, fontWeight:800, marginBottom:3 }}>ملف فاتورة العميل</div>
                <div style={{ fontSize:10, color:'var(--text3)', lineHeight:1.6, marginBottom:8 }}>ارفع PDF أو صورة حتى 10 ميجابايت. سيُربط الملف بالشحنة الحالية فقط. لطلبات التصدير استخدم رقم فاتورة من 16 خانة في الحقل أعلاه.</div>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <label style={{ ...S.actionBtn, display:'inline-flex', alignItems:'center', cursor:orderActionLoading ? 'not-allowed' : 'pointer' }}>
                    اختيار ملف
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={orderActionLoading} onChange={event => chooseInvoiceFile(event.target.files?.[0] || null)} style={{ display:'none' }}/>
                  </label>
                  <span style={{ fontSize:10, color:invoiceFile ? 'var(--text2)' : 'var(--text3)' }}>{invoiceFile ? `${invoiceFile.name} · ${(invoiceFile.size / 1024 / 1024).toLocaleString('ar-SA', { maximumFractionDigits:2 })} م.ب` : 'لم يتم اختيار ملف'}</span>
                  <button disabled={orderActionLoading || !invoiceFile} onClick={() => void uploadInvoiceFile()} style={{ ...S.actionBtn, color:'var(--accent)', borderColor:'rgba(15,149,140,.35)', opacity:invoiceFile && !orderActionLoading ? 1 : .5 }}>{orderActionLoading && invoiceFile ? 'جارٍ الرفع...' : 'رفع الفاتورة إلى Trendyol'}</button>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'minmax(150px,1fr) minmax(150px,1fr) auto', gap:8 }}>
                <input disabled={!packageWorkflow.canUpdateTracking} value={packageForm.trackingNumber} onChange={e => setPackageForm({...packageForm,trackingNumber:e.target.value})} placeholder="رقم التتبع" style={{...S.select,opacity:packageWorkflow.canUpdateTracking ? 1 : .55}}/>
                <select aria-label="شركة الشحن" disabled={!packageWorkflow.canUpdateTracking} value={packageForm.providerCode} onChange={e => setPackageForm({...packageForm,providerCode:e.target.value})} style={{...S.select,opacity:packageWorkflow.canUpdateTracking ? 1 : .55}}>{SA_CARRIERS.map(([code,label]) => <option key={code} value={code}>{label}</option>)}</select>
                <button disabled={orderActionLoading || !packageWorkflow.canUpdateTracking || !packageForm.trackingNumber.trim()} onClick={() => void runPackageAction('packages.tracking', { cargoSenderNumber:packageForm.trackingNumber.trim(), providerCode:packageForm.providerCode }, 'تسجيل بيانات الشحن')} style={{...S.actionBtn,opacity:packageWorkflow.canUpdateTracking ? 1 : .5}}>حفظ الشحن</button>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10 }}>
                <button disabled={orderActionLoading || !activePackage?.cargo_tracking_number || (!packageWorkflow.canInvoice && String(packageWorkflow.providerStatus).toLowerCase() !== 'invoiced')} onClick={() => void runPackageLabelAction('packages.common_label_create')} style={S.actionBtn}>طلب ملصق الشحن</button>
                <button disabled={orderActionLoading || !activePackage?.cargo_tracking_number} onClick={() => void runPackageLabelAction('packages.common_label_get')} style={S.actionBtn}>تنزيل الملصق</button>
              </div>
              <OrderExceptionPanel key={activePackageId} items={activePackageItems} workflow={packageWorkflow} busy={orderActionLoading} onRun={runPackageAction}/>
              {selectedActions.length ? <div style={{ marginTop:12, borderTop:'1px solid var(--border)', paddingTop:9 }}>
                <div style={{ fontSize:10, fontWeight:800, color:'var(--text3)', marginBottom:6 }}>آخر إجراءات هذا الطلب</div>
                <div style={{ display:'grid', gap:5 }}>{selectedActions.map(log => <div key={log.id} style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:10 }}>
                  <span>{({ 'packages.status':'تحديث حالة الطلب', 'packages.tracking':'تسجيل الشحن', 'packages.cancel':'إلغاء بند', 'packages.common_label':'تحميل الملصق', 'packages.common_label_create':'طلب الملصق', 'packages.common_label_get':'تنزيل الملصق', 'invoices.send_file':'رفع ملف الفاتورة' } as Record<string,string>)[log.action] || 'إجراء Trendyol'}</span>
                  <span style={{ color:['success','accepted'].includes(log.status) ? 'var(--success-text)' : ['failed','partial'].includes(log.status) ? 'var(--danger-text)' : 'var(--warning-text)', fontWeight:700 }}>{log.status === 'success' ? 'تم' : log.status === 'accepted' ? 'تم الإرسال' : log.status === 'failed' ? 'فشل' : log.status === 'partial' ? 'جزئي' : 'قيد التنفيذ'}</span>
                </div>)}</div>
              </div> : null}
            </div> : null}

            <div style={S.detailGrid}>
              {[
                ['المنصة', PLATFORM_MAP[selectedOrder.platform] || selectedOrder.platform],
                ['مصدر الطلب', orderSource(selectedOrder).exportLabel],
                ['الحالة', STATUS_MAP[selectedOrder.status]?.label || selectedOrder.status],
                ['تاريخ الطلب', new Date(selectedOrder.order_date).toLocaleString('ar-SA-u-ca-gregory-nu-latn')],
                ['المنتج', selectedOrder.product_name || '—'],
                ['SKU', selectedOrder.sku || '—'],
                ['الكمية', selectedOrder.quantity.toLocaleString('ar-SA')],
                ['سعر الوحدة', fmt(selectedOrder.unit_price || 0)],
                ['إجمالي الطلب', fmt(selectedOrder.total_amount)],
                [selectedOrder.platform === 'trendyol' ? 'العمولة (شاملة ضريبة القيمة المضافة)' : 'رسوم المنصة', fmtExact(selectedOrderFees)],
                ['نسبة العمولة', selectedOrder.commission_rate ? `${Number(selectedOrder.commission_rate).toLocaleString('ar-SA', { maximumFractionDigits: 2 })}%` : '—'],
                ['الخصومات', fmt(selectedOrder.discount_amount || 0)],
                ['تكلفة الشحن', fmt(selectedOrder.shipping_cost || 0)],
                ['شركة الشحن', activePackage?.cargo_provider || selectedOrder.cargo_provider || '—'],
                ['رقم التتبع', activePackage?.cargo_tracking_number || selectedOrder.cargo_tracking_number || '—'],
                ['المدينة', selectedOrder.customer_city || '—'],
                ['العملة', selectedOrder.currency || 'SAR'],
              ].map(([label, value]) => (
                <div key={label} style={S.detailItem}>
                  <div style={S.detailLabel}>{label}</div>
                  <div style={S.detailValue}>{value}</div>
                </div>
              ))}
            </div>
            {detailLoading ? <div style={S.modalNote}>جارٍ تحميل بيانات العميل والمنتجات…</div> : <>
              {['trendyol', 'amazon', 'noon'].includes(selectedOrder.platform) ? <>
                <div style={S.sectionTitle}>بيانات العميل</div>
                <div style={S.detailGrid}>
                  {(() => {
                    const raw:any = selectedOrder.raw || {}
                    const address:any = raw.recipient?.deliveryAddress || raw.shipmentAddress || raw.delivery_address || selectedOrder.shipment_address || {}
                    const buyer:any = raw.buyer || {}
                    return [
                      ['الاسم', buyer.buyerName || (raw.customerFirstName || raw.customerLastName ? `${raw.customerFirstName || ''} ${raw.customerLastName || ''}`.trim() : address.name || address.fullName || '—')],
                      ['البريد الإلكتروني', buyer.buyerEmail || raw.customerEmail || '—'], ['رقم الهاتف', address.phone || '—'],
                      ['رقم العميل', raw.customerId || '—'], ['العنوان', address.fullAddress || [address.addressLine1, address.addressLine2, address.addressLine3].filter(Boolean).join('، ') || address.address1 || '—'],
                      ['الحي / المنطقة', address.district || address.districtOrCounty || address.stateOrRegion || address.countyName || '—'], ['الرمز البريدي', address.postalCode || '—'],
                    ].map(([label,value]) => <div key={label} style={S.detailItem}><div style={S.detailLabel}>{label}</div><div style={S.detailValue}>{String(value)}</div></div>)
                  })()}
                </div>
              </> : null}
              <div style={S.sectionTitle}>منتجات الطلب ({selectedItems.length || selectedOrder.quantity})</div>
              {selectedItems.length ? <div style={{ display:'grid', gap:10 }}>
                {selectedItems.map(item => <div key={item.id} style={S.productRow}>
                  <div style={S.productImage}>{item.image_url ? <img src={item.image_url} alt={item.product_name || 'المنتج'} style={{ width:'100%', height:'100%', objectFit:'contain' }} /> : <span style={{fontSize:11,color:'var(--text3)'}}>لا توجد صورة</span>}</div>
                  <div style={{ flex:1, minWidth:0 }}><div style={{ fontWeight:800, fontSize:13 }}>{item.product_name_ar || item.product_name || '—'}</div>{item.product_name_ar && item.product_name_ar !== item.product_name ? <div dir="ltr" style={{ fontSize:10, color:'var(--text3)', marginTop:3, textAlign:'right' }}>{item.product_name}</div> : null}<div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>الباركود: {item.barcode || '—'} · SKU: {item.sku || '—'}</div><div style={{ fontSize:11, color:'var(--text2)', marginTop:5 }}>الكمية {item.quantity} · سعر الوحدة {fmt(Number(item.unit_price || 0))} · الخصم {fmt(Number(item.discount_amount || 0))} · العمولة {item.commission_rate || 0}% · الضريبة {item.vat_rate || 0}%</div></div>
                </div>)}
              </div> : <div style={S.modalNote}>تفاصيل المنتج الحالية: {selectedOrder.product_name || '—'} — ستظهر الصورة عند توفرها في بيانات {PLATFORM_MAP[selectedOrder.platform] || 'المنصة'} أو بعد مطابقة المنتج مع الكتالوج.</div>}
            </>}
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:       { padding:'28px 32px', minHeight:'100vh' },
  topbar:     { display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20 },
  pageTitle:  { fontSize:24, fontWeight:800, letterSpacing:'-0.5px' },
  pageSub:    { fontSize:13, color:'var(--text2)', marginTop:3 },
  exportBtn:  { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'9px 18px', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer' },
  primaryBtn: { background:'var(--accent-strong)', border:'1px solid var(--accent-strong)', color:'#fff', padding:'9px 18px', borderRadius:10, fontSize:13, fontWeight:750, cursor:'pointer', fontFamily:'inherit' },
  actionBtn:  { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text2)', padding:'7px 11px', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' },
  filtersRow: { display:'flex', flexDirection:'column', gap:10, marginBottom:20 },
  pill:       { padding:'7px 16px', border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text2)', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer' },
  pillActive: { background:'var(--accent-strong)', borderColor:'var(--accent)', color:'#fff' },
  select:     { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:9, fontSize:12, outline:'none', cursor:'pointer' },
  kpisGrid:   { display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14, marginBottom:22 },
  kpiCard:    { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:16, position:'relative', overflow:'hidden' },
  kpiBar:     { position:'absolute', top:0, left:0, right:0, height:3 },
  kpiLabel:   { fontSize:11, color:'var(--text3)', fontWeight:600 },
  kpiValue:   { fontSize:22, fontWeight:800, marginTop:4 },
  tabBtn:     { padding:'10px 20px', background:'transparent', border:'none', color:'var(--text2)', fontSize:13, fontWeight:600, cursor:'pointer', borderBottom:'2px solid transparent', marginBottom:-1 },
  tabActive:  { color:'var(--accent)', borderBottomColor:'var(--accent)' },
  card:       { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', marginBottom:0 },
  table:      { width:'100%', borderCollapse:'collapse' },
  th:         { padding:'10px 16px', textAlign:'right', fontSize:11, fontWeight:700, color:'var(--text3)', background:'var(--surface2)', borderBottom:'1px solid var(--border)' },
  tr:         { borderBottom:'1px solid var(--border)' },
  td:         { padding:'11px 16px', fontSize:13, color:'var(--text)' },
  platformTag:{ padding:'3px 10px', borderRadius:6, fontSize:11, fontWeight:600 },
  statusBadge:{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700 },
  pageBtn:    { background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', width:32, height:32, borderRadius:8, fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  orderLink:  { background:'transparent', border:'none', padding:0, color:'var(--accent)', font:'inherit', fontWeight:700, textDecoration:'underline', textUnderlineOffset:3, cursor:'pointer' },
  modalBackdrop:{ position:'fixed', inset:0, zIndex:1000, background:'rgba(6,18,27,0.58)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 },
  modal:      { width:'min(680px, 100%)', maxHeight:'88vh', overflowY:'auto', background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:18, padding:22, boxShadow:'0 24px 70px rgba(0,0,0,0.28)' },
  modalHeader:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', paddingBottom:16, marginBottom:16, borderBottom:'1px solid var(--border)' },
  closeBtn:   { width:34, height:34, borderRadius:9, border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text)', fontSize:24, lineHeight:1, cursor:'pointer' },
  detailGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:10 },
  detailItem: { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px' },
  detailLabel:{ fontSize:11, color:'var(--text3)', fontWeight:700, marginBottom:5 },
  detailValue:{ fontSize:13, color:'var(--text)', fontWeight:700, overflowWrap:'anywhere' },
  modalNote:  { marginTop:16, padding:'10px 12px', borderRadius:10, background:'var(--info-bg)', color:'var(--info-text)', fontSize:11, lineHeight:1.7 },
  sectionTitle:{ fontSize:13, fontWeight:800, marginTop:18, marginBottom:9, paddingTop:14, borderTop:'1px solid var(--border)' },
  productRow: { display:'flex', gap:12, alignItems:'center', padding:10, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:11 },
  productImage:{ width:70, height:70, flexShrink:0, display:'grid', placeItems:'center', background:'#fff', border:'1px solid var(--border)', borderRadius:9, overflow:'hidden', fontSize:24 },
}
