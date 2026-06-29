// ─────────────────────────────────────────────────────────────────────────────
// مصدر الحقيقة الواحد للثيم (Single source of truth)
// ─────────────────────────────────────────────────────────────────────────────
// القيم هنا تطابق ما في src/index.css (الذي يبقى الافتراضي لتبديل فاتح/داكن
// عبر [data-theme]). الفائدة العملية لهذا الملف:
//   1) مكان واحد موثّق لقيم العلامة (--accent وعائلته).
//   2) applyAccent(hex): يغيّر لون العلامة وقت التشغيل على كامل الواجهة بتعديل
//      واحد — وهو ما يفتح: لوحات جاهزة (presets) و white-label لكل تاجر لاحقاً.
//   3) ألوان العلامة ليست مُعاد تعريفها في الوضع الداكن، لذا تجاوزها سطرياً
//      على :root آمن ولا يكسر تبديل الثيم.
//
// لإضافة لوحة جديدة: أضف مفتاحاً في PRESETS فقط.

export type AccentTokens = {
  accent: string
  accentSoft: string
  accentStrong: string
  accentGlow: string
  accent12: string
}

// مولّدات مشتقّة بسيطة (نقية) — لا تعتمد على Date/Math.random
function clamp(n: number) { return Math.max(0, Math.min(255, Math.round(n))) }
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}
function toHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('')
}
/** يفتح اللون نحو الأبيض بنسبة amount (0..1) */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount)
}
/** يغمّق اللون نحو الأسود بنسبة amount (0..1) */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount))
}
/** rgba من hex */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

/** يشتقّ عائلة العلامة من لون واحد */
export function accentFamily(accent: string): AccentTokens {
  return {
    accent,
    accentSoft: lighten(accent, 0.22),
    accentStrong: darken(accent, 0.18), // تعبئة أزرار أغمق لتمرير تباين النص الأبيض
    accentGlow: rgba(accent, 0.3),
    accent12: rgba(accent, 0.12),
  }
}

export const DEFAULT_ACCENT = '#7c6bff'

// لوحات جاهزة (تُستخدم في الدفعة التالية: منتقي ألوان في الإعدادات)
export const PRESETS: Record<string, { label: string; accent: string }> = {
  violet:  { label: 'بنفسجي (الافتراضي)', accent: '#7c6bff' },
  emerald: { label: 'زمرّدي',             accent: '#0ea66e' },
  azure:   { label: 'أزرق',               accent: '#2f6bff' },
  sunset:  { label: 'برتقالي',            accent: '#f2762e' },
}

/**
 * يطبّق لون العلامة على كامل الواجهة بتعديل متغيّرات CSS على :root.
 * تمرير undefined يُعيد للافتراضي (يزيل التجاوز السطري فيعود لقيمة index.css).
 */
export function applyAccent(hex?: string | null) {
  const root = document.documentElement.style
  if (!hex) {
    for (const k of ['--accent', '--accent-soft', '--accent-strong', '--accent-glow', '--accent-12']) root.removeProperty(k)
    return
  }
  const f = accentFamily(hex)
  root.setProperty('--accent', f.accent)
  root.setProperty('--accent-soft', f.accentSoft)
  root.setProperty('--accent-strong', f.accentStrong)
  root.setProperty('--accent-glow', f.accentGlow)
  root.setProperty('--accent-12', f.accent12)
}

const ACCENT_KEY = 'sellpert-accent'

/** يحفظ لون علامة مخصّص ويطبّقه */
export function setStoredAccent(hex?: string | null) {
  if (hex) localStorage.setItem(ACCENT_KEY, hex)
  else localStorage.removeItem(ACCENT_KEY)
  applyAccent(hex)
}

/** يُستدعى عند الإقلاع لتطبيق أي لون علامة محفوظ (قبل أول رسم) */
export function applyStoredAccent() {
  const hex = localStorage.getItem(ACCENT_KEY)
  if (hex) applyAccent(hex)
}
