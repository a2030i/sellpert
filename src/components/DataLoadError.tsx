export default function DataLoadError({ message = 'تعذّر تحميل البيانات. لم تُحتسب أرقام من نتيجة غير مكتملة.', onRetry }: { message?: string; onRetry: () => void }) {
  return <div role="alert" className="merchant-page-state data-load-error">
    <p>{message}</p>
    <button type="button" className="data-load-error__retry" onClick={onRetry}>إعادة المحاولة</button>
  </div>
}
