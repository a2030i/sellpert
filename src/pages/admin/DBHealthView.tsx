import { useState, useEffect } from 'react'
import {
  AlertTriangle, CheckCircle2, CircleX, Clock3, Database, FileCheck2,
  Gauge, HardDrive, Link2Off, RefreshCw, ServerCog, ShoppingBag,
  Store, Webhook, type LucideIcon,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'

const SUPABASE_PLANS = {
  free:       { label: 'Free',       db_limit_mb: 500,   conn_limit: 60,   color: '#ffd166' },
  pro:        { label: 'Pro',        db_limit_mb: 8192,  conn_limit: 200,  color: '#0f958c' },
  team:       { label: 'Team',       db_limit_mb: 8192,  conn_limit: 200,  color: '#00e5b0' },
  enterprise: { label: 'Enterprise', db_limit_mb: 99999, conn_limit: 1000, color: '#ff9900' },
}
type PlanKey = keyof typeof SUPABASE_PLANS

const KEY_TABLES = ['orders', 'merchants', 'sync_queue', 'webhook_events', 'salla_connections',
  'subscriptions', 'invoices', 'products', 'performance_data', 'notifications']

type Incident = {
  source: 'sync' | 'upload'
  merchant_code: string | null
  platform: string | null
  occurred_at: string | null
  message: string | null
}

type HealthPayload = {
  db_size_bytes: number
  table_stats: Array<{ table: string; rows: number; size_bytes: number }>
  total_connections: number
  queue_stats: { pending: number; running: number; failed: number; done_today: number; stalled: number }
  upload_stats: { processing: number; stalled: number; failed_24h: number; success_24h: number; last_success_at: string | null }
  sync_stats: { errors_24h: number; success_24h: number; last_success_at: string | null; last_error_at: string | null }
  stale_active_connections: number
  recent_incidents: Incident[]
  webhook_errors_24h: number
  merchant_count: number
  active_subscriptions: number
  orders_total: number
  orders_today: number
  cache_hit_ratio: number | null
  oldest_pending_minutes: number | null
}

type Metric = { label: string; value: string | number; color: string; Icon: LucideIcon }

export default function DBHealthView() {
  const [health, setHealth]     = useState<HealthPayload | null>(null)
  const [loading, setLoading]   = useState(true)
  const [plan, setPlan]         = useState<PlanKey>('free')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'supabase_plan').maybeSingle()
      .then(({ data }) => { if (data?.value) setPlan(data.value as PlanKey) })
    load()
  }, [])

  async function load() {
    setLoading(true)
    setErrorMessage('')
    const { data, error } = await supabase.rpc('get_db_health')
    if (error) setErrorMessage('تعذر تحميل مؤشرات صحة النظام. أعد المحاولة، وإن استمر الخطأ راجع سجل التدقيق.')
    else if (data) setHealth(data as unknown as HealthPayload)
    setLastRefresh(new Date())
    setLoading(false)
  }

  async function savePlan(p: PlanKey) {
    const previous = plan
    setPlan(p)
    const { error } = await supabase.from('app_settings').upsert({ key: 'supabase_plan', value: p, is_secret: false })
    if (error) {
      setPlan(previous)
      setErrorMessage('لم يتم حفظ سعة Supabase المختارة. تحقق من الصلاحيات ثم أعد المحاولة.')
    }
  }

  const cfg = SUPABASE_PLANS[plan]

  const dbMb      = health ? Math.round(health.db_size_bytes / 1024 / 1024) : 0
  const dbPct     = Math.min(100, Math.round(dbMb / cfg.db_limit_mb * 100))
  const connPct   = Math.min(100, Math.round((health?.total_connections || 0) / cfg.conn_limit * 100))
  const cacheHit  = health?.cache_hit_ratio ?? 0
  const queueFail = health?.queue_stats?.failed ?? 0
  const webhookErr = health?.webhook_errors_24h ?? 0
  const oldestMin  = health?.oldest_pending_minutes ?? 0
  const queueStalled = health?.queue_stats?.stalled ?? 0
  const uploadStats = health?.upload_stats
  const syncStats = health?.sync_stats
  const staleConnections = health?.stale_active_connections ?? 0
  const incidents: Incident[] = health?.recent_incidents || []

  const dbAlert   = dbPct >= 90 ? 'critical' : dbPct >= 70 ? 'warn' : 'ok'
  const connAlert = connPct >= 80 ? 'warn' : 'ok'
  const queueAlert = queueFail > 0 || queueStalled > 0 ? 'warn' : 'ok'
  const stalledOperations = queueStalled + (uploadStats?.stalled ?? 0)
  const recentOperationErrors = (syncStats?.errors_24h ?? 0) + (uploadStats?.failed_24h ?? 0) + webhookErr
  const operationsAlert = stalledOperations > 0 || recentOperationErrors > 0
  const overallAlert = dbAlert !== 'ok' || operationsAlert

  const alertColor = (level: string) =>
    level === 'critical' ? '#ff4d6d' : level === 'warn' ? '#ffd166' : '#00e5b0'

  function fmtBytes(bytes: number) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB'
    if (bytes >= 1048576)    return (bytes / 1048576).toFixed(1) + ' MB'
    return (bytes / 1024).toFixed(0) + ' KB'
  }

  const tableStats = (health?.table_stats || [])
    .filter(t => KEY_TABLES.includes(t.table))
    .sort((a, b) => KEY_TABLES.indexOf(a.table) - KEY_TABLES.indexOf(b.table))

  const alertTitle = dbAlert === 'critical'
    ? `سعة قاعدة البيانات حرجة: ${dbPct}% مستخدم`
    : operationsAlert
      ? 'توجد حوادث تشغيلية تحتاج متابعة'
      : `سعة قاعدة البيانات وصلت إلى ${dbPct}%`
  const alertDescription = dbAlert === 'critical'
    ? `الاستخدام الحالي ${dbMb} MB من ${cfg.db_limit_mb >= 99999 ? 'سعة غير محدودة' : `${cfg.db_limit_mb} MB`}.`
    : operationsAlert
      ? `${stalledOperations} عملية متوقفة و${recentOperationErrors} أخطاء خلال آخر 24 ساعة. راجع الحوادث أدناه قبل إعادة المزامنة.`
      : `الاستخدام الحالي ${dbMb} MB من ${cfg.db_limit_mb >= 99999 ? 'سعة غير محدودة' : `${cfg.db_limit_mb} MB`}. خطط للتوسعة قبل بلوغ 90%.`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            آخر تحديث: {lastRefresh.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 }}>
            {(Object.keys(SUPABASE_PLANS) as PlanKey[]).map(p => (
              <button key={p} onClick={() => savePlan(p)} style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: plan === p ? SUPABASE_PLANS[p].color : 'transparent',
                color: plan === p ? '#fff' : 'var(--text3)',
                transition: 'all 0.2s',
              }}>{SUPABASE_PLANS[p].label}</button>
            ))}
          </div>
          <button onClick={load} disabled={loading} style={{ ...S.refreshBtn, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <RefreshCw size={15} style={{ animation: loading ? 'spin .8s linear infinite' : undefined }} />
            {loading ? 'جارٍ التحديث' : 'تحديث المؤشرات'}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid color-mix(in srgb, var(--danger-text) 25%, transparent)', fontSize: 13 }}>
          <CircleX size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {overallAlert && !loading && (
        <div style={{
          padding: '16px 18px', borderRadius: 12,
          background: dbAlert === 'critical' ? 'var(--danger-bg)' : 'var(--warning-bg)',
          border: `1px solid color-mix(in srgb, ${dbAlert === 'critical' ? 'var(--danger-text)' : 'var(--warning-text)'} 24%, transparent)`,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, color: dbAlert === 'critical' ? 'var(--danger-text)' : 'var(--warning-text)', background: 'var(--surface)' }}>
            <AlertTriangle size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: dbAlert === 'critical' ? 'var(--danger-text)' : 'var(--warning-text)', marginBottom: 4 }}>
              {alertTitle}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.65 }}>{alertDescription}</div>
          </div>
          {dbAlert !== 'ok' && plan === 'free' && (
            <a href="https://supabase.com/pricing" target="_blank" rel="noopener noreferrer"
              style={{ marginRight: 'auto', background: 'var(--accent-strong)', color: '#fff', padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 800, textDecoration: 'none', flexShrink: 0 }}>
              ترقية الآن ↗
            </a>
          )}
        </div>
      )}

      {loading && !health ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
          <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : health && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {([
              { label: 'حجم قاعدة البيانات', value: `${dbMb} MB`, Icon: Database, color: alertColor(dbAlert) },
              { label: 'التجار', value: health.merchant_count, Icon: Store, color: '#0f958c' },
              { label: 'الطلبات الكلية', value: Number(health.orders_total).toLocaleString(), Icon: ShoppingBag, color: '#b7791f' },
              { label: 'طلبات اليوم', value: health.orders_today, Icon: Clock3, color: '#2563eb' },
              { label: 'كفاءة القراءة', value: `${cacheHit}%`, Icon: Gauge, color: cacheHit >= 90 ? '#00a67e' : cacheHit >= 70 ? '#b7791f' : '#d64545' },
              { label: 'أخطاء Webhook 24h', value: webhookErr, Icon: Webhook, color: webhookErr > 0 ? '#b7791f' : '#00a67e' },
              { label: 'فشل في الطابور', value: queueFail, Icon: CircleX, color: queueFail > 0 ? alertColor(queueAlert) : '#00a67e' },
              { label: 'مزامنات ناجحة 24h', value: syncStats?.success_24h ?? 0, Icon: CheckCircle2, color: '#00a67e' },
              { label: 'أخطاء مزامنة 24h', value: syncStats?.errors_24h ?? 0, Icon: AlertTriangle, color: (syncStats?.errors_24h ?? 0) > 0 ? '#d64545' : '#00a67e' },
              { label: 'ملفات ناجحة 24h', value: uploadStats?.success_24h ?? 0, Icon: FileCheck2, color: '#0f958c' },
              { label: 'عمليات متوقفة', value: stalledOperations, Icon: ServerCog, color: stalledOperations > 0 ? '#d64545' : '#00a67e' },
              { label: 'روابط تحتاج تحديث', value: staleConnections, Icon: Link2Off, color: staleConnections > 0 ? '#b7791f' : '#00a67e' },
            ] satisfies Metric[]).map((k) => (
              <div key={k.label} style={{ ...S.kpiCard, padding: 16, position: 'relative', overflow: 'hidden' }}>
                <div style={{ ...S.kpiBar, background: k.color }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
                  <span style={{ width: 30, height: 30, borderRadius: 7, background: k.color + '18', color: k.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><k.Icon size={16} /></span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ ...S.chartCard, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...S.chartTitle, display: 'flex', alignItems: 'center', gap: 7 }}><HardDrive size={17} /> استخدام الموارد — سعة {cfg.label}</div>
            {[
              { label: 'حجم قاعدة البيانات', used: dbMb, limit: cfg.db_limit_mb, pct: dbPct, unit: 'MB', alert: dbAlert, hint: cfg.db_limit_mb >= 99999 ? 'غير محدود' : `${cfg.db_limit_mb} MB` },
              { label: 'الاتصالات النشطة', used: health.total_connections, limit: cfg.conn_limit, pct: connPct, unit: '', alert: connAlert, hint: `${cfg.conn_limit} اتصال` },
            ].map((bar, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>{bar.label}</span>
                  <span style={{ color: alertColor(bar.alert), fontWeight: 700 }}>
                    {bar.used}{bar.unit} / {bar.hint}
                    {bar.alert !== 'ok' && <span style={{ marginRight: 6 }}>{bar.pct}%</span>}
                  </span>
                </div>
                <div style={{ height: 10, borderRadius: 5, background: 'var(--surface2)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 5, width: `${bar.pct}%`,
                    background: bar.pct >= 90 ? 'linear-gradient(90deg,var(--red),#ff6b6b)' : bar.pct >= 70 ? 'linear-gradient(90deg,var(--gold),#ffba08)' : `linear-gradient(90deg,${cfg.color},${cfg.color}99)`,
                    transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...S.chartCard, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ ...S.chartTitle, display: 'flex', alignItems: 'center', gap: 7 }}><ServerCog size={17} /> حالة طابور المزامنة</div>
              {oldestMin > 30 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: 'var(--warning-bg)', color: 'var(--warning-text)', border: '1px solid var(--warning-bg)' }}>
                  أقدم مهمة معلّقة منذ {oldestMin} دقيقة
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12 }}>
              {[
                { label: 'قيد الانتظار', value: health.queue_stats?.pending ?? 0, color: '#ffd166' },
                { label: 'جارٍ التنفيذ', value: health.queue_stats?.running ?? 0, color: '#4cc9f0' },
                { label: 'فشل',          value: health.queue_stats?.failed  ?? 0, color: '#ff4d6d' },
                { label: 'منجز (24 ساعة)', value: health.queue_stats?.done_today ?? 0, color: '#00e5b0' },
              ].map((s, i) => (
                <div key={i} style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--surface2)', border: `1px solid ${s.color}33`, textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{Number(s.value).toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, fontWeight: 600 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...S.chartCard, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={S.chartTitle}>آخر الحوادث التشغيلية</div>
              <div style={S.chartSub}>آخر أخطاء المزامنة واستيراد الملفات مع المتجر والمصدر ووقت الحدث</div>
            </div>
            {incidents.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--text3)', textAlign: 'center', fontSize: 13 }}>
                لا توجد حوادث تشغيلية مسجلة.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead><tr>{['المصدر', 'المتجر', 'المنصة', 'الوقت', 'التفاصيل'].map(label => <th key={label} style={S.th}>{label}</th>)}</tr></thead>
                  <tbody>{incidents.map((incident, index) => <tr key={`${incident.source}-${incident.occurred_at}-${index}`} style={S.tr}>
                    <td style={S.td}>{incident.source === 'sync' ? 'مزامنة API' : 'رفع ملف'}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace' }}>{incident.merchant_code || '—'}</td>
                    <td style={S.td}>{incident.platform || '—'}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{incident.occurred_at ? new Date(incident.occurred_at).toLocaleString('ar-SA-u-ca-gregory-nu-latn') : '—'}</td>
                    <td style={{ ...S.td, maxWidth: 420, whiteSpace: 'normal', lineHeight: 1.6 }}>{incident.message || 'تعذر إكمال العملية'}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ ...S.chartCard, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ ...S.chartTitle, display: 'flex', alignItems: 'center', gap: 7 }}><Database size={17} /> حجم الجداول الرئيسية</div>
              <div style={S.chartSub}>عدد الصفوف والحجم لكل جدول</div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>{['الجدول', 'الصفوف', 'الحجم', 'نسبة من DB'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {tableStats.map(t => {
                    const rowPct = health.db_size_bytes > 0 ? Math.min(100, Math.round(t.size_bytes / health.db_size_bytes * 100)) : 0
                    return (
                      <tr key={t.table} style={S.tr}>
                        <td style={S.td}>
                          <code style={{ fontSize: 12, fontFamily: 'monospace' }}>{t.table}</code>
                        </td>
                        <td style={{ ...S.td, fontWeight: 700 }}>{Number(t.rows).toLocaleString('ar-SA')}</td>
                        <td style={{ ...S.td, color: 'var(--text3)', fontSize: 12 }}>{fmtBytes(t.size_bytes)}</td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--surface2)', maxWidth: 120 }}>
                              <div style={{ height: '100%', borderRadius: 3, width: `${rowPct}%`, background: 'var(--accent)', opacity: 0.7 }} />
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text3)', minWidth: 28 }}>{rowPct}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
