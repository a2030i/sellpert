import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from './adminShared'

const SUPABASE_PLANS = {
  free:       { label: 'Free',       db_limit_mb: 500,   conn_limit: 60,   color: '#ffd166' },
  pro:        { label: 'Pro',        db_limit_mb: 8192,  conn_limit: 200,  color: '#7c6bff' },
  team:       { label: 'Team',       db_limit_mb: 8192,  conn_limit: 200,  color: '#00e5b0' },
  enterprise: { label: 'Enterprise', db_limit_mb: 99999, conn_limit: 1000, color: '#ff9900' },
}
type PlanKey = keyof typeof SUPABASE_PLANS

const KEY_TABLES = ['orders', 'merchants', 'sync_queue', 'webhook_events', 'salla_connections',
  'subscriptions', 'invoices', 'products', 'performance_data', 'notifications']

const TABLE_ICONS: Record<string, string> = {
  orders: '📦', merchants: '👥', sync_queue: '⏳', webhook_events: '🔔',
  salla_connections: '🟢', subscriptions: '💳', invoices: '🧾',
  products: '🏷️', performance_data: '📊', notifications: '🔔',
}

export default function DBHealthView() {
  const [health, setHealth]     = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [plan, setPlan]         = useState<PlanKey>('free')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'supabase_plan').maybeSingle()
      .then(({ data }) => { if (data?.value) setPlan(data.value as PlanKey) })
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.rpc('get_db_health')
    if (!error && data) setHealth(data)
    setLastRefresh(new Date())
    setLoading(false)
  }

  async function savePlan(p: PlanKey) {
    setPlan(p)
    await supabase.from('app_settings').upsert({ key: 'supabase_plan', value: p, is_secret: false })
  }

  const cfg = SUPABASE_PLANS[plan]

  const dbMb      = health ? Math.round(health.db_size_bytes / 1024 / 1024) : 0
  const dbPct     = Math.min(100, Math.round(dbMb / cfg.db_limit_mb * 100))
  const connPct   = Math.min(100, Math.round((health?.total_connections || 0) / cfg.conn_limit * 100))
  const cacheHit  = health?.cache_hit_ratio ?? 0
  const queueFail = health?.queue_stats?.failed ?? 0
  const webhookErr = health?.webhook_errors_24h ?? 0
  const oldestMin  = health?.oldest_pending_minutes ?? 0

  const dbAlert   = dbPct >= 90 ? 'critical' : dbPct >= 70 ? 'warn' : 'ok'
  const connAlert = connPct >= 80 ? 'warn' : 'ok'
  const queueAlert = queueFail > 10 ? 'warn' : 'ok'
  const overallAlert = dbAlert === 'critical' || (dbAlert === 'warn' && queueAlert === 'warn')

  const alertColor = (level: string) =>
    level === 'critical' ? '#ff4d6d' : level === 'warn' ? '#ffd166' : '#00e5b0'

  function fmtBytes(bytes: number) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB'
    if (bytes >= 1048576)    return (bytes / 1048576).toFixed(1) + ' MB'
    return (bytes / 1024).toFixed(0) + ' KB'
  }

  const tableStats: any[] = (health?.table_stats || [])
    .filter((t: any) => KEY_TABLES.includes(t.table))
    .sort((a: any, b: any) => KEY_TABLES.indexOf(a.table) - KEY_TABLES.indexOf(b.table))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>🩺 صحة قاعدة البيانات</h3>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            آخر تحديث: {lastRefresh.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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
          <button onClick={load} disabled={loading} style={S.refreshBtn}>
            {loading ? '⟳ جارٍ...' : '⟳ تحديث'}
          </button>
        </div>
      </div>

      {overallAlert && !loading && (
        <div style={{
          padding: '14px 20px', borderRadius: 14,
          background: dbAlert === 'critical' ? 'rgba(255,77,109,0.1)' : 'rgba(255,209,102,0.1)',
          border: `1px solid ${dbAlert === 'critical' ? 'rgba(255,77,109,0.4)' : 'rgba(255,209,102,0.4)'}`,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <span style={{ fontSize: 28 }}>{dbAlert === 'critical' ? '🚨' : '⚠️'}</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: dbAlert === 'critical' ? '#ff4d6d' : '#ffd166', marginBottom: 4 }}>
              {dbAlert === 'critical'
                ? `قاعدة البيانات وصلت ${dbPct}% من الحد الأقصى — يجب الترقية الآن`
                : `قاعدة البيانات عند ${dbPct}% — يُنصح بالترقية قريباً`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              الاستخدام الحالي: <strong>{dbMb} MB</strong> من أصل <strong>{cfg.db_limit_mb >= 99999 ? 'غير محدود' : cfg.db_limit_mb + ' MB'}</strong>
              {plan === 'free' && ' — الترقية إلى Pro تعطيك 8 GB وأداءً أعلى بكثير'}
            </div>
          </div>
          {plan === 'free' && (
            <a href="https://supabase.com/pricing" target="_blank" rel="noopener noreferrer"
              style={{ marginRight: 'auto', background: '#7c6bff', color: '#fff', padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 800, textDecoration: 'none', flexShrink: 0 }}>
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
            {[
              { label: 'حجم DB',           value: `${dbMb} MB`,                               color: alertColor(dbAlert),  icon: '💾' },
              { label: 'التجار',            value: health.merchant_count,                       color: '#7c6bff',             icon: '👥' },
              { label: 'الاشتراكات النشطة', value: health.active_subscriptions,                 color: '#00e5b0',             icon: '💳' },
              { label: 'الطلبات الكلية',    value: Number(health.orders_total).toLocaleString(), color: '#ff9900',            icon: '📦' },
              { label: 'طلبات اليوم',       value: health.orders_today,                         color: '#4cc9f0',             icon: '🕒' },
              { label: 'Cache Hit',         value: `${cacheHit}%`,                              color: cacheHit >= 90 ? '#00e5b0' : cacheHit >= 70 ? '#ffd166' : '#ff4d6d', icon: '⚡' },
              { label: 'أخطاء Webhook 24h', value: webhookErr,                                  color: webhookErr > 0 ? '#ffd166' : '#00e5b0', icon: '🔔' },
              { label: 'فشل في الطابور',   value: queueFail,                                   color: queueFail > 0 ? alertColor(queueAlert) : '#00e5b0', icon: '⏳' },
            ].map((k, i) => (
              <div key={i} style={{ ...S.kpiCard, padding: 16, position: 'relative', overflow: 'hidden' }}>
                <div style={{ ...S.kpiBar, background: k.color }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600 }}>{k.label}</span>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: k.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{k.icon}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ ...S.chartCard, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={S.chartTitle}>📊 استخدام الموارد — باقة {cfg.label}</div>
            {[
              { label: 'حجم قاعدة البيانات', used: dbMb, limit: cfg.db_limit_mb, pct: dbPct, unit: 'MB', alert: dbAlert, hint: cfg.db_limit_mb >= 99999 ? 'غير محدود' : `${cfg.db_limit_mb} MB` },
              { label: 'الاتصالات النشطة', used: health.total_connections, limit: cfg.conn_limit, pct: connPct, unit: '', alert: connAlert, hint: `${cfg.conn_limit} اتصال` },
            ].map((bar, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>{bar.label}</span>
                  <span style={{ color: alertColor(bar.alert), fontWeight: 700 }}>
                    {bar.used}{bar.unit} / {bar.hint}
                    {bar.alert !== 'ok' && <span style={{ marginRight: 6 }}>{bar.alert === 'critical' ? '🚨' : '⚠️'} {bar.pct}%</span>}
                  </span>
                </div>
                <div style={{ height: 10, borderRadius: 5, background: 'var(--surface2)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 5, width: `${bar.pct}%`,
                    background: bar.pct >= 90 ? 'linear-gradient(90deg,#ff4d6d,#ff6b6b)' : bar.pct >= 70 ? 'linear-gradient(90deg,#ffd166,#ffba08)' : `linear-gradient(90deg,${cfg.color},${cfg.color}99)`,
                    transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...S.chartCard, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={S.chartTitle}>⏳ حالة طابور المزامنة</div>
              {oldestMin > 30 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: 'rgba(255,209,102,0.15)', color: '#ffd166', border: '1px solid rgba(255,209,102,0.3)' }}>
                  ⚠️ أقدم مهمة معلّقة منذ {oldestMin} دقيقة
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
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
              <div style={S.chartTitle}>📋 حجم الجداول الرئيسية</div>
              <div style={S.chartSub}>عدد الصفوف والحجم لكل جدول</div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>{['الجدول', 'الصفوف', 'الحجم', 'نسبة من DB'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {tableStats.map((t: any) => {
                    const rowPct = health.db_size_bytes > 0 ? Math.min(100, Math.round(t.size_bytes / health.db_size_bytes * 100)) : 0
                    return (
                      <tr key={t.table} style={S.tr}>
                        <td style={S.td}>
                          <span style={{ marginLeft: 6 }}>{TABLE_ICONS[t.table] || '📄'}</span>
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
