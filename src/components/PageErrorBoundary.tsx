import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { reportClientIncident } from '../lib/clientIncident'

interface Props {
  children: ReactNode
  resetKey: string
  onGoHome: () => void
}

interface State {
  hasError: boolean
}

export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled merchant page error', error, info.componentStack)
    void reportClientIncident({
      category: 'render',
      severity: 'error',
      component: 'merchant-page',
      action: this.props.resetKey,
      error,
    })
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  private retry = () => this.setState({ hasError: false })

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <section className="page-error-state" role="alert" aria-labelledby="page-error-title">
        <div className="page-error-state__mark" aria-hidden="true">!</div>
        <p className="page-error-state__eyebrow">تعذر إكمال عرض الصفحة</p>
        <h1 id="page-error-title">بقية النظام ما زالت متاحة</h1>
        <p>
          تعذر تحميل هذه الصفحة. يمكنك المحاولة مرة أخرى أو الانتقال إلى الرئيسية.
        </p>
        <div className="page-error-state__actions">
          <button type="button" className="page-error-state__primary" onClick={this.retry}>
            <RefreshCw size={16} aria-hidden="true" /> إعادة المحاولة
          </button>
          <button type="button" className="page-error-state__secondary" onClick={this.props.onGoHome}>
            الانتقال إلى الرئيسية
          </button>
        </div>
      </section>
    )
  }
}
