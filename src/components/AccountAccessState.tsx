import { LogOut, RefreshCw } from 'lucide-react'

interface Props {
  state: 'missing' | 'suspended'
  email?: string
  detail?: string
  onRetry?: () => void
  onSignOut: () => void
}

const COPY = {
  missing: {
    eyebrow: 'حالة مساحة العمل',
    title: 'لم تكتمل تهيئة حساب المتجر',
    description: 'جلسة الدخول صالحة، لكن مساحة العمل المرتبطة بهذا الحساب غير متاحة بعد. أعد المحاولة، وإذا استمرت الحالة فسجّل الخروج ثم ادخل من جديد.',
  },
  suspended: {
    eyebrow: 'حالة مساحة العمل',
    title: 'مساحة العمل موقوفة',
    description: 'تم إيقاف الوصول إلى المتجر وبياناته مؤقتًا، ويشمل ذلك جميع أعضاء الفريق. بيانات المتجر محفوظة ولن تظهر أو تتغير أثناء الإيقاف.',
  },
} as const

export default function AccountAccessState({ state, email, detail, onRetry, onSignOut }: Props) {
  const copy = COPY[state]

  return (
    <main style={styles.page} dir="rtl">
      <section style={styles.card} aria-labelledby="account-state-title">
        <div style={styles.rule} />
        <p style={styles.eyebrow}>{copy.eyebrow}</p>
        <h1 id="account-state-title" style={styles.title}>{copy.title}</h1>
        <p style={styles.description}>{copy.description}</p>

        <dl style={styles.details}>
          {email ? <div style={styles.detailRow}><dt>الحساب</dt><dd dir="ltr">{email}</dd></div> : null}
          <div style={styles.detailRow}><dt>حالة البيانات</dt><dd>محفوظة ومعزولة</dd></div>
        </dl>

        {detail ? <p style={styles.technicalDetail}>{detail}</p> : null}

        <div style={styles.actions}>
          {state === 'missing' && onRetry ? (
            <button type="button" style={styles.primary} onClick={onRetry}>
              <RefreshCw size={16} aria-hidden="true" /> إعادة المحاولة
            </button>
          ) : null}
          <button type="button" style={styles.secondary} onClick={onSignOut}>
            <LogOut size={16} aria-hidden="true" /> تسجيل الخروج
          </button>
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
    background: 'var(--bg)', color: 'var(--text)',
  },
  card: {
    width: '100%', maxWidth: 560, padding: '34px 36px 30px',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
    boxShadow: '0 18px 50px rgba(15, 23, 42, .12)',
  },
  rule: { width: 48, height: 3, borderRadius: 2, background: 'var(--accent)', marginBottom: 20 },
  eyebrow: { margin: 0, color: 'var(--text3)', fontSize: 12, fontWeight: 600 },
  title: { margin: '8px 0 12px', fontSize: 24, lineHeight: 1.5 },
  description: { margin: 0, color: 'var(--text2)', fontSize: 14, lineHeight: 1.9 },
  details: {
    margin: '24px 0 0', padding: 0, borderTop: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
  },
  detailRow: {
    minHeight: 46, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 18, color: 'var(--text2)', fontSize: 13,
  },
  technicalDetail: {
    margin: '16px 0 0', padding: '10px 12px', color: 'var(--text3)', fontSize: 12,
    lineHeight: 1.7, background: 'var(--surface2)', borderRadius: 7,
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 },
  primary: {
    minHeight: 42, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 7,
    border: '1px solid var(--accent)', borderRadius: 8, background: 'var(--accent)', color: '#fff',
    fontSize: 13, fontWeight: 600,
  },
  secondary: {
    minHeight: 42, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 7,
    border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text2)',
    fontSize: 13, fontWeight: 600,
  },
}
