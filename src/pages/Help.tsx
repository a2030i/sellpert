import { useState } from 'react'
import type { Merchant } from '../lib/supabase'
import { Search, ChevronDown, MessageCircle, BookOpen } from 'lucide-react'
import { PageHeader, PageTabs } from '../components/UI'

const FAQ = [
  {
    cat: 'البداية',
    items: [
      { q: 'كيف أبدأ مع Sellpert؟', a: 'ابدأ من صفحة "الربط ورفع الملفات": اربط Trendyol مباشرة، أو ارفع ملف المنصة المدعوم، ثم راجع الطلبات والمنتجات والمخزون بعد اكتمال المعالجة.' },
      { q: 'كيف يتم تحديث بياناتي؟', a: 'تُحدَّث بيانات Trendyol عبر الربط المباشر، ويمكنك تشغيل المزامنة ومتابعة حالتها من صفحة "الربط ورفع الملفات".' },
      { q: 'هل أستطيع رفع التقارير بنفسي؟', a: 'نعم. اختر المنصة من صفحة "الربط ورفع الملفات" وارفع الملف. يتحقق النظام من نوعه ويعزله داخل مساحة متجرك قبل المعالجة.' },
    ],
  },
  {
    cat: 'الأرقام والتقارير',
    items: [
      { q: 'لماذا الربح يظهر سالباً؟', a: 'يحدث عادة عند رفع تقرير الإعلانات قبل تقرير المبيعات للنفس الفترة. الإنفاق الإعلاني يُسجَّل بدون مبيعات مقابلة. الأرقام ستتسوّى عند رفع التقارير الكاملة.' },
      { q: 'ما المقصود بـ ROAS؟', a: 'عائد الإنفاق الإعلاني = الإيرادات ÷ الإنفاق. مثلاً ROAS 3x يعني كل ريال إعلانات يجيب 3 ريالات مبيعات. أعلى من 3 ممتاز، أقل من 1 خاسر.' },
      { q: 'ما الفرق بين ROAS الإجمالي والصافي؟', a: 'الإجمالي يحسب الإيراد كاملاً. الصافي يطرح المرتجعات. صفحة التسويق تعرض الاثنين.' },
      { q: 'ما المقصود بـ ABC analysis؟', a: 'تصنيف منتجاتك حسب مساهمتها في الإيراد. الفئة A: أعلى 80% من الإيراد، B: التالية 15%، C: الأخيرة 5%. تساعدك تركّز على المنتجات النجمة.' },
    ],
  },
  {
    cat: 'المخزون',
    items: [
      { q: 'متى يُنبّهني النظام بإعادة التوريد؟', a: 'تلقائياً عند: نفاد منتج كان يُباع، مدة الـ 7 أيام أو أقل، أو منتج راكد لـ 30 يوم. شاهد توصيات إعادة التوريد على لوحة التحكم.' },
      { q: 'ما معنى "منتج راكد"؟', a: 'منتج لم يُبَع منذ 30 يوماً أو أكثر. يمثّل رأس مال مجمّد. يُفضّل تخفيض سعره أو الترويج له.' },
      { q: 'ما معنى ASN و GRN؟', a: 'ASN = إرسالية للمستودع (ما أرسلته لمستودع المنصة). GRN = إيصال استلام (ما استلمته المنصة فعلياً). الفرق بينهما يكشف الفقد.' },
    ],
  },
  {
    cat: 'الدعم',
    items: [
      { q: 'كيف أرفع تذكرة دعم؟', a: 'افتح صفحة "الدعم" → "إنشاء تذكرة جديدة" → اختر فئة الطلب (إعلانات/أسعار/شحن/استفسار...) → املأ النموذج. فريقنا يتابع ويرد عليك.' },
      { q: 'كيف أتواصل مع فريق Sellpert؟', a: 'استخدم تذاكر الدعم لإنشاء طلب ومتابعة حالته والردود عليه من داخل حسابك.' },
    ],
  },
]

export default function Help({ merchant: _merchant }: { merchant: Merchant | null }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const filtered = FAQ.map(s => ({
    ...s,
    items: s.items.filter(it => !q || it.q.includes(q) || it.a.includes(q))
  })).filter(s => s.items.length > 0)

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
      <PageTabs tabs={[{ label: 'تذاكر الدعم', path: '/requests' }, { label: 'الأسئلة الشائعة', path: '/help' }]} />
      <PageHeader title="مركز المساعدة" description="إجابات واضحة عن الربط والبيانات والتقارير وإدارة المتجر." icon={BookOpen} />

      <div style={{ position: 'relative', marginBottom: 22 }}>
        <Search size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث في الأسئلة..."
          style={{ width: '100%', padding: '12px 40px 12px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, color: 'var(--text)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
          لا توجد نتائج مطابقة للبحث
        </div>
      ) : (
        filtered.map(section => (
          <div key={section.cat} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
              {section.cat}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {section.items.map((item, i) => {
                const id = section.cat + '-' + i
                const isOpen = open === id
                return (
                  <div key={id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <button onClick={() => setOpen(isOpen ? null : id)} style={{
                      width: '100%', padding: '12px 16px', background: 'transparent', border: 'none',
                      color: 'var(--text)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'right',
                    }}>
                      <span>{item.q}</span>
                      <ChevronDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', flexShrink: 0 }} />
                    </button>
                    {isOpen && (
                      <div style={{ padding: '0 16px 14px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.8 }}>
                        {item.a}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      <div style={{ marginTop: 30, padding: 18, background: 'linear-gradient(135deg, rgba(15,149,140,0.06), var(--success-bg))', border: '1px solid rgba(15,149,140,0.2)', borderRadius: 12, textAlign: 'center' }}>
        <BookOpen size={28} color="var(--accent)" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>لم تجد إجابتك؟</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>اسأل المساعد الذكي أو ارفع تذكرة دعم</div>
        <button onClick={() => { window.history.pushState(null, '', '/requests'); window.dispatchEvent(new PopStateEvent('popstate')) }}
          style={{ background: 'var(--accent-strong)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <MessageCircle size={14} /> إنشاء تذكرة دعم
        </button>
      </div>
    </div>
  )
}
