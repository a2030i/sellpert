import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  Users, CheckSquare, AlertTriangle, Activity, Star, TrendingUp, Upload, DollarSign, Heart,
} from 'lucide-react'
import { fmtCurrency, fmtNumber } from '../../lib/formatters'

interface KPIs {
  total_merchants: number
  active_30d: number
  pending_tasks: number
  overdue_tasks: number
  avg_health: number
  nps_avg: number | null
  promoters: number
  passives: number
  detractors: number
  uploads_30d: number
  gmv_30d: number
  notifications_30d?: number
}

export default function TeamDashboardView() {
  const [k, setK] = useState<KPIs | null>(null)
  const [loading, setLoading] = useState(true)
  const [topMerchants, setTopMerchants] = useState<any[]>([])
  const [recentNPS, setRecentNPS] = useState<any[]>([])
  const [openTasks, setOpenTasks] = useState<any[]>([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [kpiResp, topResp, npsResp, tasksResp] = await Promise.all([
      supabase.rpc('team_dashboard_kpis'),
      supabase.from('merchants').select('merchant_code,name,health_score,last_active_at,subscription_plan').order('health_score', { ascending: false, nullsFirst: false }).limit(10),
      supabase.from('nps_responses').select('*').order('created_at', { ascending: false }).limit(8),
      supabase.from('admin_tasks').select('id,title,priority,due_date,status,merchant_code,assignee_email').in('status', ['pending', 'in_progress']).order('priority', { ascending: false }).limit(10),
    ])
    setK(kpiResp.data || null)
    setTopMerchants(topResp.data || [])
    setRecentNPS(npsResp.data || [])
    setOpenTasks(tasksResp.data || [])
    setLoading(false)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>جاري التحميل...</div>

  const npsScore = k?.nps_avg ?? 0
  const npsHealth = ((k?.promoters || 0) - (k?.detractors || 0)) / Math.max(((k?.promoters || 0) + (k?.passives || 0) + (k?.detractors || 0)), 1) * 100

  return (
    <div style={{ padding: 16, maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>لوحة الفريق</h1>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>مؤشرات الأداء الداخلية للفريق</div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <KPI Icon={Users} label="إجمالي التجار" value={fmtNumber(k?.total_merchants || 0)} color="#7c6bff" sub={`${k?.active_30d || 0} نشطون آخر 30 يوم`} />
        <KPI Icon={CheckSquare} label="المهام المعلقة" value={fmtNumber(k?.pending_tasks || 0)} color="#00b894" sub={(k?.overdue_tasks || 0) > 0 ? `${k?.overdue_tasks} متأخرة!` : 'لا متأخرات'} subRed={(k?.overdue_tasks || 0) > 0} />
        <KPI Icon={Heart} label="متوسط Health" value={(k?.avg_health || 0).toFixed(0) + '%'} color="#f0a800" sub="من 100" />
        <KPI Icon={Star} label="NPS" value={npsScore ? npsHealth.toFixed(0) : '—'} color="#ff6b6b" sub={`${k?.promoters || 0} مروج · ${k?.detractors || 0} منتقد`} />
        <KPI Icon={Upload} label="ملفات مرفوعة" value={fmtNumber(k?.uploads_30d || 0)} color="#6c5ce7" sub="آخر 30 يوم" />
        <KPI Icon={DollarSign} label="GMV (30 يوم)" value={fmtCurrency(k?.gmv_30d || 0)} color="#00b894" sub="إجمالي المبيعات" />
      </div>

      {/* Two columns: Open tasks + NPS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginBottom: 14 }}>
        <Panel title="مهام مفتوحة" Icon={CheckSquare}>
          {openTasks.length === 0 ? (
            <Empty text="لا توجد مهام مفتوحة" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {openTasks.map((t: any) => (
                <div key={t.id} style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PriorityDot priority={t.priority} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                      {t.merchant_code} {t.assignee_email && `· ${t.assignee_email}`} {t.due_date && `· موعد: ${t.due_date}`}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: t.status === 'in_progress' ? 'rgba(245,158,11,0.15)' : 'rgba(108,92,231,0.15)', color: t.status === 'in_progress' ? '#f59e0b' : 'var(--accent)', fontWeight: 700 }}>
                    {t.status === 'in_progress' ? 'قيد التنفيذ' : 'معلقة'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="آخر تقييمات NPS" Icon={Star}>
          {recentNPS.length === 0 ? (
            <Empty text="لا توجد تقييمات بعد" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentNPS.map((n: any) => {
                const color = n.category === 'promoter' ? '#00b894' : n.category === 'detractor' ? '#e84040' : '#f0a800'
                return (
                  <div key={n.id} style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, display: 'flex', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: color + '20', color: color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800,
                    }}>{n.score}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>
                        {n.merchant_code} · {fmtRelative(n.created_at)}
                      </div>
                      {n.feedback && <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{n.feedback}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* Top merchants */}
      <Panel title="أعلى التجار صحة" Icon={TrendingUp}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={th}>المتجر</th>
                <th style={th}>الكود</th>
                <th style={th}>الخطة</th>
                <th style={th}>Health</th>
                <th style={th}>آخر نشاط</th>
              </tr>
            </thead>
            <tbody>
              {topMerchants.map(m => (
                <tr key={m.merchant_code} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={td}>{m.name}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: 'var(--text3)' }}>{m.merchant_code}</td>
                  <td style={td}>
                    <span style={{ fontSize: 10, padding: '2px 7px', background: 'var(--surface2)', borderRadius: 4, fontWeight: 700 }}>
                      {m.subscription_plan || 'free'}
                    </span>
                  </td>
                  <td style={td}>
                    <HealthBar score={m.health_score || 0} />
                  </td>
                  <td style={{ ...td, color: 'var(--text3)', fontSize: 11 }}>
                    {m.last_active_at ? fmtRelative(m.last_active_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function fmtRelative(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'الآن'
  if (m < 60) return `منذ ${m} د`
  const h = Math.floor(m / 60)
  if (h < 24) return `منذ ${h} س`
  return `منذ ${Math.floor(h / 24)} يوم`
}

function KPI({ Icon, label, value, color, sub, subRed }: any) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: color + '20', color: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={15} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: subRed ? '#e84040' : 'var(--text3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Panel({ title, Icon, children }: any) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon size={14} color="var(--accent)" />
        <h3 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', margin: 0 }}>{title}</h3>
      </div>
      {children}
    </div>
  )
}

function PriorityDot({ priority }: { priority: string }) {
  const c = priority === 'urgent' ? '#e84040' : priority === 'high' ? '#f59e0b' : priority === 'medium' ? '#7c6bff' : '#94a0b8'
  return <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? '#00b894' : score >= 40 ? '#f0a800' : '#e84040'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 90 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: Math.min(score, 100) + '%', background: color }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 28 }}>{score.toFixed(0)}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>{text}</div>
}

const th: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text3)' }
const td: React.CSSProperties = { padding: '10px', color: 'var(--text)', fontSize: 12 }
