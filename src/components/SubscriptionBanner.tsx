import { PLANS, getPlan, getUpgradePlan, type PlanKey } from '../lib/subscription'
import type { Merchant } from '../lib/supabase'

interface Props {
  merchant: Merchant | null
  onUpgrade?: () => void
}

export default function SubscriptionBanner({ merchant, onUpgrade }: Props) {
  if (!merchant) return null
  if (['admin', 'super_admin', 'employee'].includes(merchant.role)) return null

  const status = merchant.subscription_status ?? 'active'
  const plan   = (merchant.subscription_plan as PlanKey) ?? 'free'
  const cfg    = PLANS[plan] || PLANS.free

  // Suspended — critical banner
  if (status === 'suspended') {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: 'linear-gradient(135deg, #ff4d6d, #c9184a)',
        color: '#fff', padding: '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 4px 20px rgba(255,77,109,0.4)',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🚫</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>اشتراكك متوقف</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              تم إيقاف الوصول إلى البيانات. جدّد اشتراكك من متجر سلة لاستئناف الخدمة.
            </div>
          </div>
        </div>
        <button
          onClick={onUpgrade}
          style={{
            background: '#fff', color: '#c9184a',
            border: 'none', padding: '8px 18px', borderRadius: 10,
            fontSize: 13, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
          }}
        >
          تجديد الاشتراك
        </button>
      </div>
    )
  }

  // Upgrade prompt — show for salla/free plans
  if (['salla', 'free'].includes(plan)) {
    const upgradeTo = getUpgradePlan(plan)
    if (!upgradeTo) return null
    const upgradeCfg = PLANS[upgradeTo]
    return (
      <div style={{
        background: 'linear-gradient(135deg, rgba(124,107,255,0.12), rgba(0,229,176,0.08))',
        border: '1px solid rgba(124,107,255,0.25)',
        borderRadius: 12, padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        margin: '0 0 16px 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>✨</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              أنت على {cfg.label} — {cfg.channels.length} قناة متاحة
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
              ترقى إلى {upgradeCfg.label} وفتح {upgradeCfg.channels.length} قنوات ({upgradeCfg.channels.join(' · ')})
            </div>
          </div>
        </div>
        <button
          onClick={onUpgrade}
          style={{
            background: 'var(--accent)', border: 'none', color: '#fff',
            padding: '7px 16px', borderRadius: 9, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', flexShrink: 0,
            boxShadow: '0 3px 12px rgba(124,107,255,0.35)',
          }}
        >
          ترقية — {upgradeCfg.price} ر.س/شهر
        </button>
      </div>
    )
  }

  return null
}
