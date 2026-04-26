import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant, MerchantRequest } from '../lib/supabase'

const TYPE_LABELS: Record<string, string> = {
  price_change: 'تغيير سعر',
  add_product: 'إضافة منتج',
  remove_product: 'إيقاف منتج',
  update_info: 'تعديل معلومات',
  other: 'أخرى',
}
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'بانتظار المراجعة', color: '#ffd166', bg: 'rgba(255,209,102,0.15)' },
  in_progress: { label: 'قيد التنفيذ',       color: '#4cc9f0', bg: 'rgba(76,201,240,0.15)' },
  done:        { label: 'تم التنفيذ',         color: '#00e5b0', bg: 'rgba(0,229,176,0.15)' },
  rejected:    { label: 'مرفوض',             color: '#ff4d6d', bg: 'rgba(255,77,109,0.15)' },
}

export default function Requests({ merchant }: { merchant: Merchant | null }) {
  const [requests, setRequests] = useState<MerchantRequest[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'all' | MerchantRequest['status']>('all')

  useEffect(() => { if (merchant) load() }, [merchant])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('merchant_requests')
      .select('*')
      .eq('merchant_code', merchant!.merchant_code)
      .order('created_at', { ascending: false })
    setRequests(data || [])
    setLoading(false)
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)
  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    in_progress: requests.filter(r => r.status === 'in_progress').length,
    done: requests.filter(r => r.status === 'done').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  }

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <h2 style={S.title}>طلباتي</h2>
        <p style={S.sub}>جميع طلباتك المرسلة للفريق ومتابعة حالتها</p>
      </div>

      {/* Filter tabs */}
      <div style={S.tabs}>
        {(['all', 'pending', 'in_progress', 'done', 'rejected'] as const).map(k => (
          <button key={k} style={{ ...S.tab, ...(filter === k ? S.tabActive : {}) }} onClick={() => setFilter(k)}>
            {k === 'all' ? 'الكل' : STATUS_META[k].label}
            {counts[k] > 0 && <span style={{ ...S.badge, background: k === 'pending' ? 'rgba(255,209,102,0.2)' : 'var(--surface2)', color: k === 'pending' ? '#ffd166' : 'var(--text3)' }}>{counts[k]}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={S.center}>جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>لا توجد طلبات</div>
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>يمكنك إرسال طلب من صفحة المنتجات</div>
        </div>
      ) : (
        <div style={S.list}>
          {filtered.map(req => {
            const st = STATUS_META[req.status]
            return (
              <div key={req.id} style={S.card}>
                <div style={S.cardTop}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ ...S.typeBadge }}>{TYPE_LABELS[req.type] || req.type}</span>
                    {req.details?.product_name && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{req.details.product_name}</span>
                    )}
                  </div>
                  <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                </div>

                {req.note && (
                  <div style={S.noteBox}>
                    <span style={S.noteLabel}>ملاحظتك:</span> {req.note}
                  </div>
                )}

                {req.type === 'price_change' && req.details?.new_target_price && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                    السعر الصافي المطلوب: <strong style={{ color: 'var(--accent)' }}>{req.details.new_target_price} ر.س</strong>
                  </div>
                )}

                {req.admin_note && (
                  <div style={{ ...S.noteBox, background: 'rgba(124,107,255,0.08)', borderColor: 'rgba(124,107,255,0.2)', marginTop: 8 }}>
                    <span style={{ ...S.noteLabel, color: 'var(--accent)' }}>رد الفريق:</span> {req.admin_note}
                  </div>
                )}

                <div style={S.cardFooter}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {new Date(req.created_at).toLocaleString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {req.resolved_at && (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                      تم الرد: {new Date(req.resolved_at).toLocaleDateString('ar-SA')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:     { padding: '28px 32px', minHeight: '100vh', maxWidth: 800, margin: '0 auto' },
  header:   { marginBottom: 24 },
  title:    { fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' },
  sub:      { fontSize: 13, color: 'var(--text2)', marginTop: 3 },
  tabs:     { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 },
  tab:      { padding: '9px 16px', background: 'transparent', border: 'none', color: 'var(--text2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6 },
  tabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  badge:    { padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700 },
  center:   { padding: 40, textAlign: 'center', color: 'var(--text3)' },
  empty:    { textAlign: 'center', padding: '80px 20px', color: 'var(--text3)' },
  list:     { display: 'flex', flexDirection: 'column', gap: 12 },
  card:     { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px' },
  cardTop:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  typeBadge: { background: 'rgba(124,107,255,0.12)', color: 'var(--accent)', padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700 },
  noteBox:  { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--text2)' },
  noteLabel: { fontWeight: 700, color: 'var(--text3)', fontSize: 11 },
  cardFooter: { display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' },
}
