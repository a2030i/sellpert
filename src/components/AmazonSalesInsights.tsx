import { useEffect, useMemo, useState } from 'react'
import { Eye, Link2, MousePointerClick, PackageCheck, ShoppingBag, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/db'
import { findMatchingAmazonDailyReport, type AmazonDailySalesRow } from '../lib/amazonReportReconciliation'

interface AmazonProductRow {
  asin: string | null
  product_name: string | null
  snapshot_date: string
  sessions: number
  page_views: number
  buy_box_percentage: number
  unit_session_percentage: number
  sold: number
  total_orders: number
  gross_sales: number
}

interface DecisionRow extends AmazonProductRow {
  action: string
  reason: string
  score: number
}

const money = (value: number) => `${value.toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })} ر.س`
const number = (value: number) => value.toLocaleString('ar-SA-u-nu-latn')
const percent = (value: number) => `${value.toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 1 })}%`
const shortDate = (value?: string) => value
  ? new Date(value + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

export default function AmazonSalesInsights({ merchantCode, showEmpty = false }: { merchantCode?: string; showEmpty?: boolean }) {
  const [products, setProducts] = useState<AmazonProductRow[]>([])
  const [dailyRows, setDailyRows] = useState<AmazonDailySalesRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!merchantCode) { setProducts([]); setDailyRows([]); return }
    let cancelled = false
    setLoading(true)

    ;(async () => {
      const latest = await supabase.from('product_performance_snapshots')
        .select('snapshot_date')
        .eq('merchant_code', merchantCode)
        .eq('platform', 'amazon')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      const latestSnapshot = latest.data?.snapshot_date
      const [productRows, salesRows] = await Promise.all([
        latestSnapshot
          ? fetchAll<AmazonProductRow>((from, to) => supabase.from('product_performance_snapshots')
              .select('asin,product_name,snapshot_date,sessions,page_views,buy_box_percentage,unit_session_percentage,sold,total_orders,gross_sales')
              .eq('merchant_code', merchantCode)
              .eq('platform', 'amazon')
              .eq('snapshot_date', latestSnapshot)
              .order('gross_sales', { ascending: false })
              .range(from, to), 'أداء منتجات أمازون')
          : Promise.resolve([]),
        fetchAll<AmazonDailySalesRow>((from, to) => supabase.from('amazon_daily_sales')
          .select('data_date,total_sales,units,upload_id')
          .eq('merchant_code', merchantCode)
          .order('data_date', { ascending: false })
          .range(from, to), 'مبيعات أمازون اليومية'),
      ])

      if (!cancelled) {
        setProducts(productRows)
        setDailyRows(salesRows)
        setLoading(false)
      }
    })().catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [merchantCode])

  const summary = useMemo(() => {
    const sales = products.reduce((sum, row) => sum + Number(row.gross_sales || 0), 0)
    const units = products.reduce((sum, row) => sum + Number(row.sold || 0), 0)
    const orders = products.reduce((sum, row) => sum + Number(row.total_orders || 0), 0)
    const sessions = products.reduce((sum, row) => sum + Number(row.sessions || 0), 0)
    const views = products.reduce((sum, row) => sum + Number(row.page_views || 0), 0)
    const conversion = sessions > 0 ? units / sessions * 100 : 0
    return { sales, units, orders, sessions, views, conversion }
  }, [products])

  const match = useMemo(() => findMatchingAmazonDailyReport({
    sales: summary.sales,
    units: summary.units,
    orderItems: summary.orders,
  }, dailyRows), [summary, dailyRows])

  const decisions = useMemo<DecisionRow[]>(() => {
    if (!products.length) return []
    const avgSessions = summary.sessions / products.length
    const baseConversion = Math.max(summary.conversion, 0.1)

    return products.map(row => {
      const rowConversion = row.sessions > 0 ? row.sold / row.sessions * 100 : 0
      if (row.sessions >= avgSessions && rowConversion < baseConversion * 0.6) {
        return { ...row, action: 'حسّن صفحة المنتج والسعر', reason: `${number(row.sessions)} جلسة لكن التحويل ${percent(rowConversion)}`, score: 300 + row.sessions }
      }
      if (row.sessions >= avgSessions && Number(row.buy_box_percentage || 0) < 90) {
        return { ...row, action: 'استعد الـ Buy Box', reason: `Buy Box عند ${percent(Number(row.buy_box_percentage || 0))} مع زيارات جيدة`, score: 250 + row.sessions }
      }
      if (rowConversion > baseConversion * 1.3 && row.sessions < avgSessions) {
        return { ...row, action: 'زد الظهور أو الإعلان', reason: `تحويل قوي ${percent(rowConversion)} لكن الزيارات محدودة`, score: 200 + rowConversion }
      }
      return { ...row, action: 'حافظ على الأداء', reason: `${money(Number(row.gross_sales || 0))} مبيعات · ${number(row.sold || 0)} وحدة`, score: Number(row.gross_sales || 0) }
    }).sort((a, b) => b.score - a.score).slice(0, 5)
  }, [products, summary])

  if (loading) return (
    <div style={{ height: 120, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 20, display: 'grid', placeItems: 'center', color: 'var(--text3)', fontSize: 12 }}>
      جاري ربط تقارير أمازون…
    </div>
  )
  if (!products.length) return showEmpty ? (
    <div style={{ padding: 18, borderRadius: 14, background: 'var(--surface)', border: '1px dashed var(--border)', marginBottom: 20, color: 'var(--text2)', fontSize: 13 }}>
      ارفع «تقرير الأعمال» و«لوحة المبيعات» من أمازون معاً لعرض الزيارات والتحويل والمبيعات اليومية في تحليل واحد.
    </div>
  ) : null

  const metrics = [
    { label: 'مبيعات الفترة', value: money(summary.sales), Icon: ShoppingBag },
    { label: 'منتجات الطلب', value: number(summary.orders), Icon: PackageCheck },
    { label: 'الوحدات المباعة', value: number(summary.units), Icon: ShoppingBag },
    { label: 'الجلسات', value: number(summary.sessions), Icon: MousePointerClick },
    { label: 'مشاهدات الصفحات', value: number(summary.views), Icon: Eye },
    { label: 'التحويل', value: percent(summary.conversion), Icon: Sparkles },
  ]

  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid #ff9900', borderRadius: 16, padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>أداء أمازون: من الزيارة إلى البيع</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            تفصيل المنتجات من تقرير الأعمال · اتجاه الأيام من لوحة المبيعات
          </div>
        </div>
        {match ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--success-text)', background: 'var(--success-bg)', padding: '6px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800 }}>
            <Link2 size={13} /> متطابق · {shortDate(match.rangeStart)} — {shortDate(match.rangeEnd)}
          </div>
        ) : (
          <div style={{ color: 'var(--warning-text)', background: 'var(--warning-bg)', padding: '6px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
            لقطة المنتجات: {shortDate(products[0]?.snapshot_date)}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: 9, marginBottom: 14 }}>
        {metrics.map(({ label, value, Icon }) => (
          <div key={label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '11px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text3)', fontSize: 10, marginBottom: 6 }}><Icon size={13} />{label}</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>أين تتخذ قراراً الآن؟</div>
      <div style={{ display: 'grid', gap: 7 }}>
        {decisions.map((row, index) => (
          <div key={`${row.asin}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 10, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 9, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.product_name || row.asin || 'منتج أمازون'}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{row.reason}</div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: row.action === 'حافظ على الأداء' ? 'var(--success-text)' : '#d97706' }}>{row.action}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 11, fontSize: 10, color: 'var(--text3)', lineHeight: 1.6 }}>
        تنبيه محاسبي: إجمالي تقرير الأعمال مرجع للتحقق وتوزيع الأداء على ASIN، وليس مبيعات إضافية فوق لوحة المبيعات.
      </div>
    </section>
  )
}
