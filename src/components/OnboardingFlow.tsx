import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Merchant } from '../lib/supabase'

interface Props {
  merchant: Merchant
  onComplete: () => void
}

function getSteps(signupSource: string) {
  const isSalla = signupSource === 'salla_app'
  return [
    {
      icon: '🏪',
      title: isSalla ? 'متجرك جاهز!' : 'مرحباً بك في Sellpert!',
      desc: isSalla
        ? 'تم ربط متجر سلة بنجاح. Sellpert سيزامن طلباتك ومنتجاتك تلقائياً.'
        : 'أهلاً — منصتك الموحدة لإدارة مبيعاتك على تراندايول ونون وأمازون من مكان واحد.',
    },
    {
      icon: '📊',
      title: 'لوحة التحكم',
      desc: 'تابع مبيعاتك اليومية، الطلبات، وأداء متجرك من مكان واحد.',
    },
    {
      icon: isSalla ? '📦' : '🔗',
      title: isSalla ? 'الطلبات والمخزون' : 'ارفع تقارير منصاتك',
      desc: isSalla
        ? 'كل طلبات سلة تظهر هنا تلقائياً. يمكنك تتبع الحالة وإدارة المخزون.'
        : 'من صفحة "المنصات" ارفع تقارير تراندايول أو نون أو أمازون وستظهر بياناتك فوراً في لوحة التحكم.',
    },
    {
      icon: '🚀',
      title: 'وسّع قنواتك',
      desc: 'هل تبيع على أكثر من منصة؟ رقّي اشتراكك لباقة النمو وادر كل قنواتك من مكان واحد.',
      cta: true,
    },
  ]
}

export default function OnboardingFlow({ merchant, onComplete }: Props) {
  const STEPS = getSteps(merchant.signup_source || '')
  const [step, setStep]     = useState(0)
  const [closing, setClosing] = useState(false)

  async function finish() {
    setClosing(true)
    supabase.from('merchants')
      .update({ onboarding_done: true })
      .eq('merchant_code', merchant.merchant_code)
      .then(() => { onComplete() }, () => { onComplete() })
  }

  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      opacity: closing ? 0 : 1,
      transition: 'opacity 0.3s',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '40px 32px',
        maxWidth: 460,
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        position: 'relative',
      }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 28 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6,
              height: 6,
              borderRadius: 3,
              background: i <= step ? 'var(--accent)' : 'var(--surface2)',
              transition: 'all 0.3s',
            }} />
          ))}
        </div>

        {/* Icon */}
        <div style={{
          width: 80, height: 80, borderRadius: 20,
          background: 'linear-gradient(135deg, rgba(124,107,255,0.2), rgba(0,229,176,0.1))',
          border: '1px solid rgba(124,107,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 40, margin: '0 auto 20px',
        }}>
          {current.icon}
        </div>

        {/* Content */}
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12, color: 'var(--text)' }}>
          {current.title}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.7, marginBottom: 32 }}>
          {current.desc}
        </p>

        {/* Store name badge */}
        {step === 0 && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(0,229,176,0.12)', border: '1px solid rgba(0,229,176,0.25)',
            color: 'var(--accent2)', padding: '8px 16px', borderRadius: 30,
            fontSize: 13, fontWeight: 700, marginBottom: 24,
          }}>
            <span>🏪</span>
            {merchant.name}
            <span style={{ fontSize: 11, opacity: 0.8, fontFamily: 'monospace' }}>
              {merchant.merchant_code}
            </span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {isLast ? (
            <>
              <button
                onClick={finish}
                style={{
                  flex: 1, background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--text2)',
                  padding: '12px', borderRadius: 12, fontSize: 13, cursor: 'pointer',
                }}
              >
                ابدأ بالباقة الحالية
              </button>
              <button
                onClick={finish}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, var(--accent), #a594ff)',
                  border: 'none', color: '#fff',
                  padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(124,107,255,0.4)',
                }}
              >
                🚀 ترقية الباقة
              </button>
            </>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, var(--accent), #a594ff)',
                border: 'none', color: '#fff',
                padding: '14px', borderRadius: 12, fontSize: 14, fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(124,107,255,0.35)',
              }}
            >
              التالي →
            </button>
          )}
        </div>

        {/* Skip */}
        <button
          onClick={finish}
          style={{
            marginTop: 16, background: 'transparent', border: 'none',
            color: 'var(--text3)', fontSize: 12, cursor: 'pointer',
          }}
        >
          تخطي الجولة
        </button>
      </div>
    </div>
  )
}
