import type { ReactNode } from 'react'
import { LEGAL_DOCUMENT_VERSION } from '../lib/legal'

export default function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <main dir="rtl" style={S.page}>
      <header style={S.topbar}>
        <a href="/" style={S.brand} aria-label="العودة إلى Sellpert">Sellpert</a>
        <a href="/" style={S.back}>العودة إلى تسجيل الدخول</a>
      </header>
      <article style={S.article}>
        <div style={S.kicker}>المستندات النظامية</div>
        <h1 style={S.title}>{title}</h1>
        <p style={S.updated}>الإصدار المعتمد: {LEGAL_DOCUMENT_VERSION}</p>
        <p style={S.intro}>{intro}</p>
        <div style={S.content}>{children}</div>
      </article>
    </main>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return <section style={S.section}><h2 style={S.sectionTitle}>{title}</h2><div style={S.body}>{children}</div></section>
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' },
  topbar: { height: 68, padding: '0 clamp(20px,5vw,64px)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' },
  brand: { fontFamily: 'var(--font-heading)', fontSize: 21, fontWeight: 800, color: 'var(--accent)', textDecoration: 'none' },
  back: { fontSize: 13.5, fontWeight: 700, color: 'var(--text2)', textDecoration: 'none' },
  article: { maxWidth: 820, margin: '0 auto', padding: 'clamp(40px,7vw,76px) clamp(20px,4vw,40px) 80px' },
  kicker: { fontSize: 12.5, fontWeight: 800, color: 'var(--accent)', marginBottom: 10 },
  title: { fontFamily: 'var(--font-heading)', fontSize: 'clamp(30px,5vw,44px)', lineHeight: 1.25, margin: 0 },
  updated: { color: 'var(--text3)', fontSize: 13, margin: '12px 0 22px' },
  intro: { fontSize: 16, lineHeight: 2, color: 'var(--text2)', paddingBottom: 26, borderBottom: '1px solid var(--border)' },
  content: { marginTop: 30 },
  section: { marginBottom: 30 },
  sectionTitle: { fontFamily: 'var(--font-heading)', fontSize: 19, lineHeight: 1.5, marginBottom: 9 },
  body: { fontSize: 14.5, lineHeight: 2, color: 'var(--text2)' },
}
