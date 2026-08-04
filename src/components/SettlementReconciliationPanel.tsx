import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { useMobile } from '../lib/hooks'
import { PLATFORM_MAP } from '../lib/constants'
import { reconcileSettlements, type SettlementStatus, type SettlementTransaction } from '../lib/settlementReconciliation'

const STATUS: Record<SettlementStatus, { label:string; detail:string; color:string; bg:string }> = {
  matched: { label:'مطابقة', detail:'صافي التسوية يساوي التحويل المسجل لدى المنصة.', color:'var(--success-text)', bg:'var(--success-bg)' },
  awaiting_transfer: { label:'بانتظار التحويل', detail:'اكتملت حركات التسوية ولم تسجل المنصة تحويلًا بعد.', color:'var(--warning-text)', bg:'var(--warning-bg)' },
  variance: { label:'يوجد فرق', detail:'قيمة التحويل المسجلة لا تساوي صافي التسوية.', color:'var(--danger-text)', bg:'var(--danger-bg)' },
  review: { label:'تحتاج مراجعة', detail:'التسوية سالبة أو لا تحتوي مستحقًا موجبًا قابلًا للمطابقة.', color:'var(--danger-text)', bg:'var(--danger-bg)' },
}

function money(value:number) {
  return Number(value || 0).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' ر.س'
}

function date(value:string) {
  return value ? new Date(value).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day:'numeric', month:'short', year:'numeric' }) : '—'
}

function reference(value:string) {
  return value.length > 14 ? `…${value.slice(-10)}` : value
}

export default function SettlementReconciliationPanel({ transactions, refreshing, onRefresh }: {
  transactions:SettlementTransaction[]
  refreshing?:boolean
  onRefresh?:() => void
}) {
  const isMobile = useMobile()
  const reconciliation = useMemo(() => reconcileSettlements(transactions), [transactions])
  const hasIssues = reconciliation.variance + reconciliation.review > 0

  return (
    <section aria-label="مطابقة التسويات والتحويلات" style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, marginBottom:20, overflow:'hidden' }}>
      <div style={{ padding:isMobile ? 14 : '16px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <div>
          <h3 style={{ margin:0, fontSize:15, fontWeight:850 }}>مطابقة التسويات والتحويلات</h3>
          <p style={{ margin:'4px 0 0', fontSize:11, lineHeight:1.7, color:'var(--text3)' }}>نجمع مبيعات وخصومات كل تسوية، ثم نقارن صافيها بالتحويل الذي سجّلته المنصة. الوصول الفعلي للبنك يحتاج كشف البنك أو تأكيد فريقك.</p>
        </div>
        {onRefresh ? <button type="button" disabled={refreshing} onClick={onRefresh} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)', color:'var(--text2)', fontSize:11, fontWeight:750, cursor:refreshing ? 'wait' : 'pointer', opacity:refreshing ? .65 : 1 }}>
          <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'spin-icon' : ''}/>{refreshing ? 'جارٍ التحديث…' : 'تحديث من Trendyol'}
        </button> : null}
      </div>

      {reconciliation.groups.length === 0 ? <div style={{ padding:isMobile ? '28px 16px' : '34px 20px', textAlign:'center' }}>
        <div style={{ fontSize:14, fontWeight:800, marginBottom:5 }}>لا توجد تسويات قابلة للمطابقة في هذه الفترة</div>
        <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7 }}>حدّث Trendyol أو ارفع كشف تسويات المنصة. لن نعرض مبلغًا مستحقًا كتأكيد بنكي دون مصدر مالي واضح.</div>
      </div> : <>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr 1fr' : 'repeat(4,1fr)', borderBottom:'1px solid var(--border)' }}>
          {[
            ['صافي التسويات', money(reconciliation.totalEntitlement), 'المستحق بعد حركات التسوية'],
            ['تحويلات المنصة', money(reconciliation.totalTransfers), 'مسجلة في كشف المنصة'],
            ['مطابقة', reconciliation.matched.toLocaleString('ar-SA-u-nu-latn'), 'لا يوجد فرق حسابي'],
            ['تحتاج إجراء', (reconciliation.variance + reconciliation.review).toLocaleString('ar-SA-u-nu-latn'), hasIssues ? 'راجع الفروقات أدناه' : 'لا توجد فروقات'],
          ].map(([label,value,detail], index) => <div key={label} style={{ padding:'14px 16px', borderLeft:!isMobile && index < 3 ? '1px solid var(--border)' : undefined, borderBottom:isMobile && index < 2 ? '1px solid var(--border)' : undefined }}>
            <div style={{ fontSize:10, color:'var(--text3)', marginBottom:4 }}>{label}</div>
            <div style={{ fontSize:16, fontWeight:850, fontFamily:label.includes('صافي') || label.includes('تحويلات') ? 'var(--font-data)' : undefined }}>{value}</div>
            <div style={{ fontSize:9, color:'var(--text3)', marginTop:3 }}>{detail}</div>
          </div>)}
        </div>

        <div style={{ padding:isMobile ? 10 : '12px 14px', display:'grid', gap:8 }}>
          {reconciliation.groups.slice(0, 20).map(group => {
            const meta = STATUS[group.status]
            return <details key={`${group.platform}:${group.reference}`} style={{ border:'1px solid var(--border)', borderRadius:10, background:'var(--surface2)' }}>
              <summary style={{ listStyle:'none', cursor:'pointer', padding:isMobile ? 11 : '12px 14px', display:'grid', gridTemplateColumns:isMobile ? '1fr auto' : 'minmax(130px,1fr) repeat(4,minmax(110px,.8fr))', alignItems:'center', gap:10 }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:800 }}>{PLATFORM_MAP[group.platform] || group.platform} · تسوية {reference(group.reference)}</div>
                  <div style={{ fontSize:9, color:'var(--text3)', marginTop:3 }}>{group.transactionCount.toLocaleString('ar-SA-u-nu-latn')} حركة · حتى {date(group.lastActivity)}</div>
                </div>
                {!isMobile ? <>
                  <div><div style={labelStyle}>صافي التسوية</div><div style={valueStyle}>{money(group.entitlement)}</div></div>
                  <div><div style={labelStyle}>التحويل المسجل</div><div style={valueStyle}>{group.transferRecorded ? money(group.transferRecorded) : 'لم يسجل'}</div></div>
                  <div><div style={labelStyle}>الفرق</div><div style={{ ...valueStyle, color:Math.abs(group.variance) > .01 ? 'var(--danger-text)' : 'var(--success-text)' }}>{money(group.variance)}</div></div>
                </> : null}
                <span style={{ justifySelf:'end', padding:'4px 9px', borderRadius:20, background:meta.bg, color:meta.color, fontSize:9, fontWeight:800 }}>{meta.label}</span>
              </summary>
              <div style={{ padding:'0 14px 13px', borderTop:'1px solid var(--border)' }}>
                {isMobile ? <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, paddingTop:11 }}>
                  {[['صافي التسوية',money(group.entitlement)],['التحويل المسجل',group.transferRecorded ? money(group.transferRecorded) : 'لم يسجل'],['الفرق',money(group.variance)],['تاريخ التحويل',date(group.transferDate)]].map(([label,value]) => <div key={label}><div style={labelStyle}>{label}</div><div style={valueStyle}>{value}</div></div>)}
                </div> : null}
                <div style={{ fontSize:10, color:meta.color, fontWeight:700, marginTop:11 }}>{meta.detail}</div>
                <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap:7, marginTop:9 }}>
                  {[['المبيعات',group.sales],['المرتجعات',-group.returns],['الخصومات والرسوم',-group.deductions],['إضافات وتصحيحات',group.additions],['تاريخ التحويل',group.transferDate]].map(([label,value]) => <div key={label} style={{ background:'var(--surface)', borderRadius:7, padding:'8px 9px' }}><div style={labelStyle}>{label}</div><div style={{ ...valueStyle, fontSize:10 }}>{label === 'تاريخ التحويل' ? date(String(value || '')) : money(Number(value))}</div></div>)}
                </div>
              </div>
            </details>
          })}
          {reconciliation.unlinkedTransactions ? <div role="note" style={{ padding:'9px 11px', background:'var(--warning-bg)', color:'var(--warning-text)', borderRadius:8, fontSize:10, lineHeight:1.6 }}>{reconciliation.unlinkedTransactions.toLocaleString('ar-SA-u-nu-latn')} حركة مالية بلا مرجع تسوية؛ تظهر في كشف المعاملات لكنها لا تدخل في المطابقة حتى توفر المنصة مرجعًا لها.</div> : null}
        </div>
      </>}
      <style>{`.spin-icon{animation:spin .8s linear infinite}`}</style>
    </section>
  )
}

const labelStyle = { fontSize:9, color:'var(--text3)', marginBottom:3 } as const
const valueStyle = { fontSize:11, color:'var(--text)', fontWeight:800, fontFamily:'var(--font-data)' } as const
