import { useEffect, useState } from 'react'
import { AlertCircle, Link2, MessageSquareText, ShieldCheck } from 'lucide-react'
import { PageHeader, Skeleton } from '../components/UI'
import { TrendyolCustomerInbox } from '../components/TrendyolActionCenter'
import { listPlatformCredentials } from '../lib/platformCredentialManager'
import type { Merchant } from '../lib/supabase'
import './CustomerService.css'

function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function CustomerService({ merchant }: { merchant: Merchant | null }) {
  const [connectionState, setConnectionState] = useState<'loading'|'connected'|'disconnected'|'unknown'>('loading')

  useEffect(() => {
    if (!merchant?.merchant_code) return
    if (merchant.role === 'employee') {
      setConnectionState('unknown')
      return
    }
    let active = true
    listPlatformCredentials(merchant.merchant_code)
      .then(credentials => {
        if (active) setConnectionState(credentials.some(item => item.platform === 'trendyol' && item.is_active) ? 'connected' : 'disconnected')
      })
      .catch(() => { if (active) setConnectionState('unknown') })
    return () => { active = false }
  }, [merchant?.merchant_code, merchant?.role])

  if (!merchant?.merchant_code) return null

  return <div className="customer-service-page">
    <PageHeader
      title="خدمة العملاء"
      description="استقبل أسئلة عملاء Trendyol ورد عليها من مساحة عمل متجرك، مع حفظ سجل كل محاولة إرسال."
      icon={MessageSquareText}
    />

    <div className="customer-service-assurances" aria-label="خصائص خدمة العملاء">
      <div><ShieldCheck size={17}/><span><strong>معزولة لمتجرك</strong> لا تظهر أسئلة أو ردود أي متجر آخر.</span></div>
      <div><Link2 size={17}/><span><strong>مرتبطة مباشرة</strong> الرد المؤكد يُرسل إلى Trendyol ويُسجل.</span></div>
    </div>

    {connectionState === 'loading' ? <div className="customer-service-loading"><Skeleton height={180}/></div> :
      connectionState === 'disconnected' ? <section className="customer-service-empty">
        <AlertCircle size={24}/>
        <h2>اربط Trendyol لبدء خدمة العملاء</h2>
        <p>بعد تفعيل الربط ستظهر أسئلة العملاء هنا تلقائيًا، ويمكن الرد دون الرجوع إلى الإدارة.</p>
        <button onClick={() => navigate('/integrations')}>فتح الربط ورفع الملفات</button>
      </section> :
      <TrendyolCustomerInbox merchantCode={merchant.merchant_code} standalone />}
  </div>
}
