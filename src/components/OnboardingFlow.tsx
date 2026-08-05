import { useState } from 'react'
import { ArrowLeft, CheckCircle2, Plug, ShieldCheck, Store, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'
import { toastErr } from './Toast'

interface Props {
  merchant: Merchant
  onComplete: () => void
}

const STEPS = [
  {
    Icon: Store,
    title: 'مرحبًا بك في Sellpert',
    description: 'تم إنشاء مساحة عمل مستقلة لمتجرك. من هنا تدير الطلبات والمنتجات والمخزون ونتائج القنوات من مكان واحد.',
    note: 'يمكنك البدء فورًا من دون الرجوع إلى إدارة المنصة.',
  },
  {
    Icon: ShieldCheck,
    title: 'بيانات متجرك معزولة',
    description: 'الطلبات والمنتجات والملفات وبيانات الربط الخاصة بك لا تظهر لأي متجر آخر. ينطبق العزل نفسه على الموظفين الذين تضيفهم.',
    note: 'كل موظف يرى فقط الأقسام التي تمنحه صلاحيتها.',
  },
  {
    Icon: Plug,
    title: 'اربط قناة البيع أو ارفع ملفًا',
    description: 'اربط ترنديول للمزامنة المباشرة، أو ارفع ملفات Amazon وNoon وسلة وزد. سيحدد النظام نوع التقرير ويعرض نتيجة الاستيراد بوضوح.',
    note: 'لا حاجة لنسخ أكواد تقنية أو إرسال الملفات إلى الإدارة.',
  },
  {
    Icon: Users,
    title: 'مساحة العمل جاهزة',
    description: 'ابدأ بربط منصتك وإحضار بياناتك، ثم أضف أعضاء الفريق وحدد صلاحية الطلبات أو المنتجات أو المخزون أو التقارير لكل موظف.',
    note: 'يمكنك تعديل الصلاحيات أو إيقاف وصول أي موظف لاحقًا.',
  },
]

export default function OnboardingFlow({ merchant, onComplete }: Props) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  async function finish(destination?: '/integrations') {
    setSaving(true)
    const { data, error } = await supabase.from('merchants')
      .update({ onboarding_done: true })
      .eq('id', merchant.id)
      .eq('merchant_code', merchant.merchant_code)
      .select('id,onboarding_done')
      .single()
    if (error || !data?.onboarding_done) {
      toastErr('تعذر حفظ اكتمال التهيئة. أعد المحاولة.')
      setSaving(false)
      return
    }
    onComplete()
    if (destination) {
      window.history.pushState(null, '', destination)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }

  return (
    <div style={styles.backdrop} role="presentation">
      <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" dir="rtl">
        <header style={styles.header}>
          <div>
            <div style={styles.brand}>Sellpert</div>
            <div style={styles.storeName}>{merchant.name}</div>
          </div>
          <span style={styles.stepCounter}>الخطوة {(step + 1).toLocaleString('ar-SA-u-nu-latn')} من {STEPS.length.toLocaleString('ar-SA-u-nu-latn')}</span>
        </header>

        <div style={styles.progress} aria-label={`الخطوة ${step + 1} من ${STEPS.length}`}>
          {STEPS.map((item, index) => (
            <div key={item.title} style={{ ...styles.progressSegment, background: index <= step ? 'var(--accent)' : 'var(--border)' }} />
          ))}
        </div>

        <div style={styles.content}>
          <div style={styles.iconBox} aria-hidden="true"><current.Icon size={30} strokeWidth={1.8} /></div>
          <h2 id="onboarding-title" style={styles.title}>{current.title}</h2>
          <p style={styles.description}>{current.description}</p>
          <div style={styles.note}><CheckCircle2 size={18} aria-hidden="true" /><span>{current.note}</span></div>
        </div>

        <footer style={styles.actions}>
          {isLast ? (
            <>
              <button type="button" style={styles.primaryButton} disabled={saving} onClick={() => finish('/integrations')}>
                {saving ? 'جاري تجهيز المساحة...' : 'الذهاب إلى الربط ورفع الملفات'}
                {!saving && <ArrowLeft size={17} aria-hidden="true" />}
              </button>
              <button type="button" style={styles.secondaryButton} disabled={saving} onClick={() => finish()}>الانتقال إلى نظرة عامة</button>
            </>
          ) : (
            <>
              <button type="button" style={styles.primaryButton} onClick={() => setStep(value => value + 1)}>
                متابعة <ArrowLeft size={17} aria-hidden="true" />
              </button>
              {step > 0 && <button type="button" style={styles.secondaryButton} onClick={() => setStep(value => value - 1)}>رجوع</button>}
            </>
          )}
        </footer>
      </section>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 10000, padding: 20,
    background: 'rgba(15, 23, 42, 0.66)', backdropFilter: 'blur(4px)',
    display: 'grid', placeItems: 'center',
  },
  dialog: {
    width: '100%', maxWidth: 560, overflow: 'hidden',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
    boxShadow: '0 28px 70px rgba(15, 23, 42, 0.28)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
    padding: '22px 26px 18px', borderBottom: '1px solid var(--border)',
  },
  brand: { color: 'var(--accent)', fontSize: 14, fontWeight: 800, letterSpacing: '.2px' },
  storeName: { color: 'var(--text)', fontSize: 13, fontWeight: 700, marginTop: 3 },
  stepCounter: { color: 'var(--text3)', fontSize: 11, whiteSpace: 'nowrap' },
  progress: { display: 'grid', gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`, gap: 4, padding: '0 26px', transform: 'translateY(-2px)' },
  progressSegment: { height: 3, borderRadius: 3, transition: 'background .2s ease' },
  content: { padding: '34px 34px 30px' },
  iconBox: {
    width: 58, height: 58, display: 'grid', placeItems: 'center',
    borderRadius: 12, color: 'var(--accent)', background: 'var(--accent-glow)', border: '1px solid rgba(15,149,140,.2)',
  },
  title: { margin: '22px 0 10px', color: 'var(--text)', fontSize: 23, lineHeight: 1.35, fontWeight: 800 },
  description: { margin: 0, color: 'var(--text2)', fontSize: 14, lineHeight: 1.9 },
  note: {
    display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 22, padding: '13px 14px',
    borderRight: '3px solid var(--accent)', background: 'var(--surface2)', color: 'var(--text2)',
    fontSize: 12, lineHeight: 1.7,
  },
  actions: {
    display: 'flex', gap: 10, flexWrap: 'wrap', padding: '18px 26px 24px',
    borderTop: '1px solid var(--border)', background: 'var(--bg2)',
  },
  primaryButton: {
    minHeight: 42, padding: '0 18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    border: '1px solid var(--accent)', borderRadius: 9, background: 'var(--accent)', color: '#fff',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer',
  },
  secondaryButton: {
    minHeight: 42, padding: '0 16px', border: '1px solid var(--border)', borderRadius: 9,
    background: 'var(--surface)', color: 'var(--text2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
}
