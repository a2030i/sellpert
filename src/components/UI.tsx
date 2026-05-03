import { useState, type ReactNode, type CSSProperties } from 'react'

// ─── Skeleton ────────────────────────────────────────────────────────────────
export function Skeleton({ width = '100%', height = 16, radius = 6, style }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return (
    <div style={{
      width, height, borderRadius: radius,
      background: 'linear-gradient(90deg, var(--surface2) 25%, var(--border) 50%, var(--surface2) 75%)',
      backgroundSize: '200% 100%',
      animation: 'sk 1.4s ease infinite',
      ...style,
    }}>
      <style>{`@keyframes sk { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
    </div>
  )
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
      <Skeleton width="40%" height={16} style={{ marginBottom: 14 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} width="100%" height={28} style={{ marginBottom: 8 }} />
      ))}
    </div>
  )
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', cursor: 'help' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', right: '50%', transform: 'translateX(50%)',
          background: 'var(--text)', color: 'var(--surface)', padding: '6px 10px', borderRadius: 6,
          fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 1000,
          boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
        }}>
          {text}
          <span style={{ position: 'absolute', top: '100%', right: '50%', transform: 'translateX(50%)',
            borderWidth: 5, borderStyle: 'solid', borderColor: 'var(--text) transparent transparent transparent',
            width: 0, height: 0,
          }} />
        </span>
      )}
    </span>
  )
}

export function InfoIcon({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--text3)', color: 'var(--surface)', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}>ⓘ</span>
    </Tooltip>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────
export function EmptyState({ icon = '📭', title, description, action }: { icon?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 24px', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14 }}>
      <div style={{ fontSize: 48, marginBottom: 14, filter: 'grayscale(0.3)' }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{title}</div>
      {description && <div style={{ fontSize: 13, color: 'var(--text3)', maxWidth: 400, margin: '0 auto', lineHeight: 1.7 }}>{description}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  )
}

// ─── Pagination ──────────────────────────────────────────────────────────────
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const from = (page - 1) * pageSize + 1
  const to   = Math.min(page * pageSize, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text3)' }}>
      <span>{from}–{to} من {total.toLocaleString('ar-SA')}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => onPage(1)} disabled={page === 1} style={pgBtn}>«</button>
        <button onClick={() => onPage(page - 1)} disabled={page === 1} style={pgBtn}>‹</button>
        <span style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{page}/{pages}</span>
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} style={pgBtn}>›</button>
        <button onClick={() => onPage(pages)} disabled={page >= pages} style={pgBtn}>»</button>
      </div>
    </div>
  )
}

const pgBtn: CSSProperties = {
  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text2)',
  padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit', minWidth: 32,
}

// ─── Sortable header ─────────────────────────────────────────────────────────
export function Sortable({ label, dir, onClick }: { label: string; dir: 'asc' | 'desc' | null; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
      {label}
      <span style={{ fontSize: 9, opacity: dir ? 1 : 0.35 }}>{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}</span>
    </button>
  )
}
