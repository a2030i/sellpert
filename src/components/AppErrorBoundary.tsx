import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled application error', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg, #f7f8fc)', padding: 24, fontFamily: 'inherit' }}>
        <section style={{ width: '100%', maxWidth: 520, background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 18, padding: '32px 28px', textAlign: 'center', boxShadow: '0 18px 60px rgba(15,23,42,.10)' }}>
          <div aria-hidden="true" style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', margin: '0 auto 16px', background: 'var(--danger-bg, #fff1f2)', color: 'var(--danger-text, #e11d48)', fontSize: 26 }}>!</div>
          <h1 style={{ margin: '0 0 8px', fontSize: 21, color: 'var(--text, #111827)' }}>تعذّر عرض هذه الصفحة</h1>
          <p style={{ margin: '0 auto 22px', color: 'var(--text2, #64748b)', fontSize: 14, lineHeight: 1.8 }}>
            تم عزل الخطأ حتى لا تتوقف واجهة النظام بالكامل. أعد تحميل الصفحة للعودة إلى آخر حالة سليمة.
          </p>
          <button onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: '11px 22px', background: 'var(--accent, #6c5ce7)', color: '#fff', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
            إعادة تحميل الصفحة
          </button>
        </section>
      </main>
    )
  }
}
