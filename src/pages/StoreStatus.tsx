import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, CircleDot, Clock3, Database, FileSpreadsheet, Link2, RefreshCw, Wrench } from 'lucide-react'
import { supabase, type Merchant, type PlatformCredential } from '../lib/supabase'
import { listPlatformCredentials } from '../lib/platformCredentialManager'
import { buildStoreHealth, platformLabel, type HealthJob, type HealthLog, type HealthUpload } from '../lib/storeHealth'
import { Badge, Card, PageHeader, Skeleton } from '../components/UI'
import './StoreStatus.css'

type Credential = PlatformCredential & { test_status?: string | null }
type TimelineItem = { id: string; platform: string; status: string; at: string | null; title: string; detail: string }

const TONE = {
  healthy: { color: 'var(--success-text)', bg: 'var(--success-bg)', Icon: CheckCircle2 },
  attention: { color: 'var(--warning-text)', bg: 'var(--warning-bg)', Icon: Clock3 },
  action: { color: 'var(--danger-text)', bg: 'var(--danger-bg)', Icon: AlertCircle },
  setup: { color: 'var(--accent)', bg: 'var(--accent-glow)', Icon: Wrench },
}

export default function StoreStatus({ merchant }: { merchant: Merchant | null }) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [logs, setLogs] = useState<HealthLog[]>([])
  const [jobs, setJobs] = useState<HealthJob[]>([])
  const [uploads, setUploads] = useState<HealthUpload[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const load = useCallback(async (manual = false) => {
    if (!merchant?.merchant_code) return
    manual ? setRefreshing(true) : setLoading(true)
    setLoadError('')
    const code = merchant.merchant_code
    const results = await Promise.allSettled([
      listPlatformCredentials(code),
      supabase.from('sync_logs').select('id,platform,status,records_synced,error_message,started_at,finished_at').eq('merchant_code', code).order('started_at', { ascending: false }).limit(40),
      supabase.from('sync_queue').select('id,platform,status,error_message,attempts,max_attempts,created_at,started_at,finished_at').eq('merchant_code', code).order('created_at', { ascending: false }).limit(40),
      supabase.from('platform_file_uploads').select('id,platform,status,error_message,rows_processed,uploaded_at,finished_at').eq('merchant_code', code).order('uploaded_at', { ascending: false }).limit(40),
    ])

    const failures: string[] = []
    if (results[0].status === 'fulfilled') setCredentials(results[0].value as Credential[])
    else failures.push('الربط')
    if (results[1].status === 'fulfilled' && !results[1].value.error) setLogs((results[1].value.data || []) as HealthLog[])
    else failures.push('المزامنة')
    if (results[2].status === 'fulfilled' && !results[2].value.error) setJobs((results[2].value.data || []) as HealthJob[])
    else failures.push('العمليات')
    if (results[3].status === 'fulfilled' && !results[3].value.error) setUploads((results[3].value.data || []) as HealthUpload[])
    else failures.push('الملفات')
    if (failures.length) setLoadError(`تعذر تحديث جزء من الحالة: ${failures.join('، ')}. أعد المحاولة بعد قليل.`)
    setCheckedAt(new Date())
    setLoading(false); setRefreshing(false)
  }, [merchant?.merchant_code])

  useEffect(() => {
    load()
    const timer = window.setInterval(() => load(true), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  const health = useMemo(() => buildStoreHealth({ credentials, logs, jobs, uploads }), [credentials, logs, jobs, uploads])
  const timeline = useMemo(() => buildTimeline(logs, jobs, uploads), [logs, jobs, uploads])
  const tone = TONE[health.level]
  const HealthIcon = tone.Icon
  const connected = credentials.filter(item => item.is_active !== false)
  const latestUploads = latestPerPlatform(uploads, item => item.uploaded_at)

  function navigate(path: string) {
    window.history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  if (loading) return <StatusSkeleton />

  return (
    <div className="store-status-page">
      <PageHeader
        title="حالة المتجر"
        description="راقب صحة الربط وتحديث البيانات والعمليات الجارية من مكان واحد."
        icon={Activity}
        action={<button className="status-refresh" onClick={() => load(true)} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} />{refreshing ? 'جاري التحقق...' : 'تحديث الحالة'}</button>}
      />

      {loadError && <div className="status-load-error" role="alert"><AlertCircle size={17} />{loadError}</div>}

      <section className="status-hero" style={{ '--status-color': tone.color, '--status-bg': tone.bg } as React.CSSProperties}>
        <div className="status-hero__identity">
          <span className="status-hero__icon"><HealthIcon size={27} /></span>
          <div>
            <div className="status-hero__eyebrow">الحالة التشغيلية الآن</div>
            <h2>{health.title}</h2>
            <p>{health.description}</p>
          </div>
        </div>
        <div className="status-hero__checked"><CircleDot size={14} /> آخر تحقق {checkedAt ? timeAgo(checkedAt.toISOString()) : 'الآن'}</div>
      </section>

      <div className="status-kpis">
        <StatusKpi icon={<Link2 size={18} />} label="مصادر البيانات" value={health.activeSources ? String(health.activeSources) : 'لا يوجد'} note={health.activeSources ? 'مصادر مرتبطة أو ملفات مستلمة' : 'اربط منصة أو ارفع ملفًا'} />
        <StatusKpi icon={<Activity size={18} />} label="عمليات جارية" value={String(health.runningOperations)} note={health.runningOperations ? 'لا تضغط المزامنة مرة أخرى' : 'لا توجد عمليات تنتظر'} />
        <StatusKpi icon={<Database size={18} />} label="آخر تحديث ناجح" value={health.lastSuccessfulAt ? timeAgo(health.lastSuccessfulAt) : 'غير متوفر'} note={health.lastSuccessfulAt ? formatDate(health.lastSuccessfulAt) : 'لم يكتمل تحديث بعد'} />
      </div>

      {health.issues.length > 0 && (
        <Card style={{ marginBottom: 18 }}>
          <div className="status-section-heading"><div><h3>إجراءات مقترحة</h3><p>مرتبة حسب ما يحتاج تدخلًا منك أولًا.</p></div><Badge tone={health.level === 'action' ? 'red' : 'amber'}>{health.issues.length} {health.issues.length === 1 ? 'إجراء' : 'إجراءات'}</Badge></div>
          <div className="status-issues">
            {health.issues.slice(0, 8).map(issue => (
              <div key={issue.id} className="status-issue">
                <span className={`status-issue__mark ${issue.level}`}><AlertCircle size={17} /></span>
                <div className="status-issue__copy"><strong>{issue.title}</strong><span>{issue.description}</span></div>
                <button onClick={() => navigate(issue.destination)}>{issue.destination === '/integrations' ? 'فتح الربط والملفات' : 'فتح الدعم'}</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {health.level === 'setup' && (
        <Card style={{ marginBottom: 18 }}>
          <div className="status-setup"><span><Wrench size={21} /></span><div><strong>ابدأ بربط مصدر بيانات</strong><p>يمكنك ربط Trendyol مباشرة، أو رفع ملفات Amazon وNoon وسلة وزد.</p></div><button onClick={() => navigate('/integrations')}>فتح الربط ورفع الملفات</button></div>
        </Card>
      )}

      <div className="status-grid">
        <Card>
          <div className="status-section-heading"><div><h3>الربط المباشر</h3><p>حالة اتصالات API المحفوظة.</p></div><Link2 size={18} /></div>
          {connected.length ? <div className="status-source-list">{connected.map(item => {
            const isFresh = item.last_sync_at && Date.now() - new Date(item.last_sync_at).getTime() <= 24 * 60 * 60 * 1000
            const ok = item.test_status === 'success' && isFresh
            return <div className="status-source" key={item.platform}><span className={`status-source__dot ${ok ? 'ok' : 'warn'}`} /><div><strong>{platformLabel(item.platform)}</strong><span>{item.last_sync_at ? `آخر مزامنة ${timeAgo(item.last_sync_at)}` : 'بانتظار أول مزامنة'}</span></div><Badge tone={ok ? 'green' : 'amber'}>{ok ? 'محدّث' : 'يحتاج متابعة'}</Badge></div>
          })}</div> : <EmptySource text="لا توجد منصة مربوطة مباشرة." />}
        </Card>

        <Card>
          <div className="status-section-heading"><div><h3>الملفات المستلمة</h3><p>آخر ملف لكل منصة وحالة معالجته.</p></div><FileSpreadsheet size={18} /></div>
          {latestUploads.length ? <div className="status-source-list">{latestUploads.map(item => {
            const status = String(item.status || '').toLowerCase()
            const ok = ['success', 'completed', 'done'].includes(status)
            const running = ['pending', 'processing', 'running'].includes(status)
            return <div className="status-source" key={item.id}><span className={`status-source__dot ${ok ? 'ok' : running ? 'warn' : 'bad'}`} /><div><strong>{platformLabel(item.platform)}</strong><span>{item.uploaded_at ? `رُفع ${timeAgo(item.uploaded_at)}` : 'وقت الرفع غير متوفر'}{item.rows_processed != null ? ` · ${item.rows_processed.toLocaleString('ar-SA')} صف` : ''}</span></div><Badge tone={ok ? 'green' : running ? 'amber' : 'red'}>{ok ? 'اكتمل' : running ? 'قيد المعالجة' : 'لم يكتمل'}</Badge></div>
          })}</div> : <EmptySource text="لم تُرفع ملفات حتى الآن." />}
        </Card>
      </div>

      <Card style={{ marginTop: 18 }}>
        <div className="status-section-heading"><div><h3>آخر النشاطات</h3><p>تسلسل واضح لعمليات المزامنة والاستيراد الأخيرة.</p></div><Activity size={18} /></div>
        {timeline.length ? <div className="status-timeline">{timeline.slice(0, 12).map(item => <div className="status-timeline__row" key={item.id}><span className={`status-source__dot ${statusTone(item.status)}`} /><div><strong>{item.title}</strong><span>{item.detail}</span></div><time>{item.at ? timeAgo(item.at) : '—'}</time></div>)}</div> : <EmptySource text="لا يوجد نشاط مسجل بعد." />}
      </Card>
    </div>
  )
}

function StatusKpi({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <Card flat><div className="status-kpi"><span className="status-kpi__icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div></Card>
}

function EmptySource({ text }: { text: string }) {
  return <div className="status-empty"><CircleDot size={17} />{text}</div>
}

function StatusSkeleton() {
  return <div className="store-status-page"><Skeleton width="38%" height={34} style={{ marginBottom: 12 }} /><Skeleton width="65%" height={18} style={{ marginBottom: 28 }} /><Skeleton height={142} radius={16} style={{ marginBottom: 16 }} /><div className="status-kpis">{[1, 2, 3].map(i => <Skeleton key={i} height={112} radius={14} />)}</div></div>
}

function latestPerPlatform<T extends { platform: string }>(items: T[], dateOf: (item: T) => string | null | undefined) {
  const map = new Map<string, T>()
  for (const item of items) {
    const current = map.get(item.platform)
    if (!current || new Date(dateOf(item) || 0).getTime() > new Date(dateOf(current) || 0).getTime()) map.set(item.platform, item)
  }
  return [...map.values()]
}

function buildTimeline(logs: HealthLog[], jobs: HealthJob[], uploads: HealthUpload[]): TimelineItem[] {
  return [
    ...logs.map(item => ({ id: `log-${item.id}`, platform: item.platform, status: item.status || '', at: item.finished_at || item.started_at || null, title: `مزامنة ${platformLabel(item.platform)}`, detail: ['success', 'completed'].includes(String(item.status).toLowerCase()) ? `اكتملت${item.records_synced != null ? ` · ${item.records_synced.toLocaleString('ar-SA')} سجل` : ''}` : statusLabel(item.status) })),
    ...jobs.map(item => ({ id: `job-${item.id}`, platform: item.platform, status: item.status, at: item.finished_at || item.started_at || item.created_at || null, title: `عملية ${platformLabel(item.platform)}`, detail: statusLabel(item.status) })),
    ...uploads.map(item => ({ id: `upload-${item.id}`, platform: item.platform, status: item.status || '', at: item.finished_at || item.uploaded_at || null, title: `ملف ${platformLabel(item.platform)}`, detail: `${statusLabel(item.status)}${item.rows_processed != null ? ` · ${item.rows_processed.toLocaleString('ar-SA')} صف` : ''}` })),
  ].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
}

function statusLabel(status?: string | null) {
  const value = String(status || '').toLowerCase()
  if (['success', 'completed', 'done'].includes(value)) return 'اكتملت بنجاح'
  if (value === 'partial') return 'اكتملت جزئيًا'
  if (['pending', 'queued'].includes(value)) return 'في قائمة الانتظار'
  if (['processing', 'running'].includes(value)) return 'قيد التنفيذ'
  if (['error', 'failed', 'stalled', 'dead'].includes(value)) return 'لم تكتمل'
  return 'تم تسجيل العملية'
}

function statusTone(status: string) {
  const value = status.toLowerCase()
  if (['success', 'completed', 'done'].includes(value)) return 'ok'
  if (['pending', 'queued', 'processing', 'running', 'partial'].includes(value)) return 'warn'
  return 'bad'
}

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return `منذ ${minutes} دقيقة`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `منذ ${hours} ساعة`
  const days = Math.floor(hours / 24)
  return `منذ ${days} ${days === 1 ? 'يوم' : 'أيام'}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
