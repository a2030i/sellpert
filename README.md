# Sellpert 2.0 — منصة تحليلات المبيعات

## التقنيات
- React 18 + TypeScript + Vite
- Supabase (Auth + DB + RLS)
- Recharts للرسوم البيانية
- Cairo/Tajawal fonts (عربي)

## الصفحات
- `/` → تسجيل الدخول
- Dashboard → لوحة التاجر (KPIs + Charts + Table)
- AdminPanel → لوحة الإدارة (إدارة التجار + GMV)

## الإعداد

### 1. تثبيت المكتبات
```
npm install
```

### 2. المتغيرات البيئية
الملف `.env` موجود ومضبوط على مشروعك في Supabase.

### 3. قاعدة البيانات
افتح `supabase-schema.sql` والصقه في:
**Supabase → SQL Editor → Run**

### 4. تشغيل المشروع
```
npm run dev
```

### 5. البناء للنشر
```
npm run build
```

## المستخدمون

### تسجيل أدمن
```sql
-- بعد إنشاء المستخدم في Supabase Auth
UPDATE merchants SET role = 'admin' WHERE email = 'admin@sellpert.com';
```

### إضافة تاجر
من لوحة الأدمن → "إضافة تاجر" (يُنشئ السجل تلقائياً)
ثم أنشئ حسابه في Supabase Auth يدوياً.

## الميزات
✅ Auth + RLS (عزل بيانات كل تاجر)
✅ 4 KPI cards (مبيعات، AOV، هامش، ROAS)
✅ 3 رسوم بيانية (خطي + بار + دائري للمنصات)
✅ فلتر التاريخ (6 خيارات)
✅ فلتر المنصة (سلة، نون، أمازون، زد، شوبيفاي)
✅ تصدير CSV
✅ لوحة أدمن كاملة
✅ دعم RTL عربي كامل
✅ عملة ديناميكية (SAR)
