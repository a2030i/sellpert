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

// ─── مكوّنات مشتركة (للتبنّي التدريجي بدل تكرار الأنماط في كل صفحة) ──────────────
export function Card({ children, style, flat }: { children: ReactNode; style?: CSSProperties; flat?: boolean }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, boxShadow: flat ? 'none' : 'var(--shadow)', ...style }}>
      {children}
    </div>
  )
}

export function SectionTitle({ title, subtitle, info, action }: { title: string; subtitle?: string; info?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: subtitle ? 14 : 10 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}>
          {title}{info && <InfoIcon text={info} />}
        </div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

const BADGE_TONES: Record<string, { bg: string; fg: string }> = {
  green: { bg: 'rgba(0,184,148,0.12)', fg: 'var(--green)' },
  red:   { bg: 'rgba(232,64,64,0.12)', fg: 'var(--red)' },
  amber: { bg: 'rgba(255,153,0,0.12)', fg: '#ff9900' },
  accent:{ bg: 'var(--accent-glow)',   fg: 'var(--accent)' },
  gray:  { bg: 'var(--surface2)',      fg: 'var(--text3)' },
}
export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.gray
  return <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>{children}</span>
}

// ─── PageTabs ─────────────────────────────────────────────────────────────────
// شريط تبويبات يدمج صفحتين متلازمتين تحت قسم واحد (الطلبات/الكشف، المنتجات/المخزون).
// كل تبويب ينتقل عبر مسار مستقل فتبقى الروابط العميقة تعمل.
export function PageTabs({ tabs }: { tabs: { label: string; path: string }[] }) {
  const current = '/' + window.location.pathname.replace(/^\//, '').split('/')[0]
  const go = (path: string) => {
    if (path === current) return
    window.history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
      {tabs.map(t => {
        const active = current === t.path
        return (
          <button key={t.path} onClick={() => go(t.path)}
            style={{
              padding: '10px 18px', background: 'none', border: 'none', borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              color: active ? 'var(--accent)' : 'var(--text3)', fontSize: 14, fontWeight: active ? 800 : 600,
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', marginBottom: -1,
            }}>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
// يفتح بالـ hover (سطح المكتب) وبالنقر (الجوال)، والنص يلتفّ بدل أن يفيض خارج الشاشة
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', cursor: 'help' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow(s => !s) }}
      onBlur={() => setShow(false)} tabIndex={0}>
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', right: '50%', transform: 'translateX(50%)',
          background: 'var(--text)', color: 'var(--surface)', padding: '8px 12px', borderRadius: 8,
          fontSize: 11.5, fontWeight: 600, whiteSpace: 'normal', width: 'max-content', maxWidth: 240, lineHeight: 1.6,
          textAlign: 'right', zIndex: 1000, boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
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
      <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--text3)', color: 'var(--surface)', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginInlineEnd: 4, flexShrink: 0 }}>ⓘ</span>
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
