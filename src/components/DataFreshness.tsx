import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PLATFORM_MAP } from '../lib/constants'

type Row = { platform: string; last_data_date: string; age_days: number }

// عمر البيانات المقبول (خدمة مُدارة، رفع دوري): أخضر ≤ يومين · أصفر ≤ أسبوع · أحمر أكثر
function tone(age: number) {
  if (age <= 2) return { bg: 'var(--success-bg)', fg: 'var(--success-text)', dot: 'var(--green)', word: 'محدّثة' }
  if (age <= 7) return { bg: 'var(--warning-bg)', fg: 'var(--warning-text)', dot: 'var(--gold)', word: `متأخرة ${age} يوم` }
  return { bg: 'var(--danger-bg)', fg: 'var(--danger-text)', dot: 'var(--red)', word: `متأخرة ${age} يوم` }
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' })
}

/**
 * شريط نضارة البيانات لكل منصة — يعرض «بيانات حتى {آخر يوم فعلي}» بلون حسب العمر.
 * يستبدل مؤشر «آخر تحديث» المضلِّل (الذي كان يقيس وقت رفع الملف لا عمر البيانات).
 */
export default function DataFreshness({ merchantCode, compact }: { merchantCode?: string; compact?: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!merchantCode) return
    supabase.rpc('data_freshness', { p_merchant_code: merchantCode })
      .then(({ data }) => { setRows(((data as Row[]) || []).filter(row => row.platform === 'trendyol')); setLoaded(true) })
  }, [merchantCode])

  if (!loaded || rows.length === 0) return null

  const stale = rows.filter(r => r.age_days > 7)

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
      background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
      padding: compact ? '8px 12px' : '10px 14px', marginBottom: compact ? 0 : 16,
    }}>
      <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
        نضارة بياناتك:
      </span>
      {rows.map(r => {
        const t = tone(r.age_days)
        return (
          <span key={r.platform} title={`آخر يوم فيه مبيعات: ${fmtDate(r.last_data_date)}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: t.bg, color: t.fg, fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.dot }} />
            {PLATFORM_MAP[r.platform] || r.platform} — حتى {fmtDate(r.last_data_date)}
            <span style={{ opacity: 0.85 }}>· {t.word}</span>
          </span>
        )
      })}
      {stale.length > 0 && !compact && (
        <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 'auto' }}>
          بياناتك متأخرة — شغّل مزامنة Trendyol من صفحة مصادر البيانات
        </span>
      )}
    </div>
  )
}
