import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant, MerchantPlatformMapping, SyncLog } from '../lib/supabase'

const PLATFORM_META: Record<string, { nameAr: string; logo: string; color: string; textColor?: string }> = {
  trendyol: { nameAr: 'تراندايول', logo: '🟠', color: '#f27a1a' },
  noon:     { nameAr: 'نون',        logo: '🟡', color: '#ffe600', textColor: '#1a1a1a' },
  amazon:   { nameAr: 'أمازون',     logo: '📦', color: '#ff9900' },
}

export default function Integrations({ merchant }: { merchant: Merchant | null }) {
  const [mappings, setMappings] = useState<MerchantPlatformMapping[]>([])
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (merchant) loadData() }, [merchant])

  async function loadData() {
    setLoading(true)
    const [{ data: maps }, { data: logs }] = await Promise.all([
      supabase
        .from('merchant_platform_mappings')
        .select('*')
        .eq('merchant_code', merchant!.merchant_code)
        .eq('is_active', true),
      supabase
        .from('sync_logs')
        .select('*')
        .eq('merchant_code', merchant!.merchant_code)
        .order('started_at', { ascending: false })
        .limit(20),
    ])
    setMappings(maps || [])
    setSyncLogs(logs || [])
    setLoading(false)
  }

  const connectedPlatforms = new Set(mappings.map(m => m.platform))

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <h2 style={S.title}>المنصات المرتبطة</h2>
        <p style={S.sub}>المنصات التي ربطها الفريق بحسابك — تتم المزامنة تلقائياً</p>
      </div>

      {loading ? (
        <div style={S.loading}>جاري التحميل...</div>
      ) : (
        <>
          {/* Platform status cards */}
          <div style={S.cardsGrid}>
            {Object.entries(PLATFORM_META).map(([id, meta]) => {
              const mapping = mappings.find(m => m.platform === id)
              const connected = !!mapping

              return (
                <div key={id} style={S.card}>
                  <div style={S.cardLeft}>
                    <div style={{ ...S.icon, background: meta.color + '22', border: `1px solid ${meta.color}44` }}>
                      <span style={{ fontSize: 26 }}>{meta.logo}</span>
                    </div>
                    <div>
                      <div style={S.platformName}>{meta.nameAr}</div>
                      {connected && mapping.seller_id && (
                        <div style={S.sellerId}>Seller ID: {mapping.seller_id}</div>
                      )}
                    </div>
                  </div>

                  <div style={S.cardRight}>
                    {connected ? (
                      <>
                        <div style={S.stats}>
                          <div style={S.stat}>
                            <span style={S.statLabel}>آخر مزامنة</span>
                            <span style={S.statVal}>
                              {mapping.last_sync_at
                                ? new Date(mapping.last_sync_at).toLocaleString('ar-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                : 'لم تتم بعد'}
                            </span>
                          </div>
                          <div style={S.stat}>
                            <span style={S.statLabel}>طلبات</span>
                            <span style={S.statVal}>{mapping.records_synced?.toLocaleString() || 0}</span>
                          </div>
                        </div>
                        <span style={{
                          ...S.statusBadge,
                          ...(mapping.last_sync_status === 'success' ? S.badgeSuccess
                            : mapping.last_sync_status === 'error' ? S.badgeError
                            : mapping.last_sync_status === 'running' ? S.badgeRunning
                            : S.badgePending),
                        }}>
                          {mapping.last_sync_status === 'success' ? '✓ متزامن'
                            : mapping.last_sync_status === 'error' ? '✕ خطأ'
                            : mapping.last_sync_status === 'running' ? '⟳ جاري...'
                            : '○ بانتظار'}
                        </span>
                      </>
                    ) : (
                      <span style={S.badgeNotConnected}>○ غير مرتبط</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {connectedPlatforms.size === 0 && (
            <div style={S.emptyState}>
              <div style={S.emptyIcon}>🔌</div>
              <div style={S.emptyTitle}>لا توجد منصات مرتبطة بعد</div>
              <div style={S.emptySub}>تواصل مع الفريق لربط منصاتك وبدء مزامنة البيانات</div>
            </div>
          )}

          {/* Sync logs */}
          {syncLogs.length > 0 && (
            <div style={S.logsCard}>
              <div style={S.logsHeader}>
                <div style={S.logsTitle}>سجل المزامنات</div>
                <span style={S.badge}>{syncLogs.length} عملية</span>
              </div>
              <table style={S.table}>
                <thead>
                  <tr>
                    {['المنصة', 'الحالة', 'السجلات', 'الوقت', 'المدة'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map(log => {
                    const duration = log.finished_at
                      ? Math.round((new Date(log.finished_at).getTime() - new Date(log.started_at).getTime()) / 1000)
                      : null
                    const meta = PLATFORM_META[log.platform]
                    return (
                      <tr key={log.id} style={S.tr}>
                        <td style={S.td}>
                          <span style={S.platformTag}>
                            {meta?.logo} {meta?.nameAr || log.platform}
                          </span>
                        </td>
                        <td style={S.td}>
                          <span style={{
                            ...S.statusBadge,
                            ...(log.status === 'success' ? S.badgeSuccess : log.status === 'error' ? S.badgeError : S.badgeRunning),
                          }}>
                            {log.status === 'success' ? '✓ نجح' : log.status === 'error' ? '✕ خطأ' : '⟳ جاري'}
                          </span>
                        </td>
                        <td style={S.td}>{log.records_synced?.toLocaleString() || 0}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text3)' }}>
                          {new Date(log.started_at).toLocaleString('ar-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>
                          {duration !== null ? `${duration}ث` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: '32px', minHeight: '100vh', maxWidth: 900, margin: '0 auto' },
  header: { marginBottom: 28 },
  title: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  sub: { fontSize: 13, color: 'var(--text2)', marginTop: 4 },
  loading: { padding: 40, textAlign: 'center', color: 'var(--text3)' },

  cardsGrid: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 },
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 14, padding: '20px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
  },
  cardLeft: { display: 'flex', alignItems: 'center', gap: 16 },
  cardRight: { display: 'flex', alignItems: 'center', gap: 20 },
  icon: {
    width: 52, height: 52, borderRadius: 13,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  platformName: { fontSize: 16, fontWeight: 700 },
  sellerId: { fontSize: 11, color: 'var(--text3)', marginTop: 3, fontFamily: 'monospace' },

  stats: { display: 'flex', gap: 24 },
  stat: { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' },
  statLabel: { fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase' },
  statVal: { fontSize: 13, fontWeight: 700 },

  statusBadge: { padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700 },
  badgeSuccess: { background: 'rgba(0,229,176,0.12)', color: 'var(--green)' },
  badgeError:   { background: 'rgba(255,77,109,0.12)', color: 'var(--red)' },
  badgeRunning: { background: 'rgba(255,209,102,0.12)', color: '#ffd166' },
  badgePending: { background: 'var(--surface2)', color: 'var(--text3)' },
  badgeNotConnected: { padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: 'var(--surface2)', color: 'var(--text3)' },

  emptyState: { textAlign: 'center', padding: '60px 20px', color: 'var(--text3)' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--text2)' },
  emptySub: { fontSize: 13 },

  logsCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 14, overflow: 'hidden',
  },
  logsHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid var(--border)',
  },
  logsTitle: { fontSize: 14, fontWeight: 700 },
  badge: {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text2)', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '10px 20px', textAlign: 'right',
    fontSize: 11, fontWeight: 700, color: 'var(--text3)',
    background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
  },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 20px', fontSize: 13 },
  platformTag: {
    background: 'rgba(108,99,255,0.1)', color: 'var(--accent)',
    padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
  },
}
