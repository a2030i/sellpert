import { useMemo, useState } from 'react'
import { Network, ShieldCheck } from 'lucide-react'
import OmnifulAmazonTrialCard from '../../components/OmnifulAmazonTrialCard'
import type { Merchant } from '../../lib/supabase'
import { S } from './adminShared'

export default function OmnifulView({ merchants }: { merchants: Merchant[] }) {
  const merchantOnly = useMemo(
    () => merchants.filter(merchant => merchant.role === 'merchant' && merchant.is_active !== false),
    [merchants],
  )
  const [merchantCode, setMerchantCode] = useState(merchantOnly[0]?.merchant_code || '')
  const selected = merchantOnly.find(merchant => merchant.merchant_code === merchantCode)

  return <section>
    <div style={{ ...S.tableCard, padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
          <span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'rgba(14,129,119,.1)', color: 'var(--accent)' }}><Network size={20} /></span>
          <div>
            <strong style={{ display: 'block', fontSize: 15 }}>إدارة حسابات Omniful للتجار</strong>
            <span style={{ display: 'block', marginTop: 4, color: 'var(--text3)', fontSize: 11, lineHeight: 1.7 }}>يمكن لكل تاجر ربط حسابه الخاص بنفسه، أو استخدام حساب Sellpert المركزي مع عزل Seller ID وStore ID.</span>
          </div>
        </div>
        <label style={{ display: 'grid', gap: 5, minWidth: 260, color: 'var(--text3)', fontSize: 10, fontWeight: 750 }}>
          التاجر
          <select style={{ ...S.input, width: '100%' }} value={merchantCode} onChange={event => setMerchantCode(event.target.value)}>
            {merchantOnly.map(merchant => <option key={merchant.merchant_code} value={merchant.merchant_code}>{merchant.name} — {merchant.merchant_code}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 14, padding: '10px 12px', borderRadius: 9, background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: 10, lineHeight: 1.7 }}>
        <ShieldCheck size={15} style={{ flex: '0 0 auto', marginTop: 1 }} />
        <span>حساب التاجر الخاص يُحفظ مرة واحدة في خزنة مشفرة. لا نضيف Secret جديدًا للخادم لكل تاجر، وتبقى المصادر الحالية فعالة أثناء التجربة.</span>
      </div>
    </div>

    {!merchantCode
      ? <div style={{ ...S.tableCard, padding: 32, textAlign: 'center', color: 'var(--text3)' }}>لا يوجد تاجر نشط لإعداد الربط.</div>
      : <>
          <div style={{ marginBottom: 8, color: 'var(--text2)', fontSize: 11 }}>إعداد: <strong>{selected?.name || merchantCode}</strong></div>
          <OmnifulAmazonTrialCard key={merchantCode} merchantCode={merchantCode} />
        </>}
  </section>
}
