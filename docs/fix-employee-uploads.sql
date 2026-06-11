-- ============================================================
-- إصلاح: الموظفون لا يستطيعون رفع الملفات
-- المشروع: sellpert — Supabase ref: urdyzbsukcuibadlaath
-- التاريخ: 2026-06-11
-- المصدر: تدقيق متعدد الوكلاء، السبب الجذري مُتحقق منه عدائياً
--         على قاعدة البيانات الحية (pg_policies + محاكاة RLS)
--
-- السلسلة المسببة (بالترتيب الذي يصطدم به الموظف):
--   1. الموظف لا يرى قائمة التجار: سياسات SELECT على merchants هي
--      merchant_select_own (بريده فقط) + admin_all_merchants (is_admin()
--      = admin/super_admin فقط) ← القائمة المنسدلة فارغة ← جدار
--      "⚠️ اختر التاجر أولاً قبل رفع الملفات" ومنطقة الرفع لا تظهر أصلاً.
--   2. حتى بعد حل (1): سياسات الكتابة على جداول الاستيراد كلها admin-only
--      ← كل إدراج يفشل بـ 42501 row-level security.
--      (الاستثناءات الوحيدة الموسّعة سابقاً: products, platform_deals,
--       entry_sessions — دليل أن ترحيل صلاحيات الموظف توقف في منتصفه)
--   3. خطأ في الكود: ImportFilesView.tsx:594 يتجاهل خطأ إدراج سجل التدقيق
--      ← uploadId='' ← فشل 22P02 (uuid غير صالح) حتى على الجداول المسموحة.
--      (يُصلح في الكود — انظر docs/AUDIT-2026-06-11.md §2)
--
-- ⚠️ تحذير recursion: لا تكتب سياسة على merchants تستعلم merchants
-- مباشرة داخل USING — ستفشل بـ 42P17 infinite recursion.
-- الحل المعتمد هنا: دالة SECURITY DEFINER على نمط is_admin() الموجودة.
-- ============================================================

-- 0) دالة مساعدة: هل المستخدم من طاقم العمل؟
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM merchants
    WHERE email = auth.email()
      AND role IN ('admin','super_admin','employee')
      AND COALESCE(is_active, true)
  )
$$;

-- 0-ب) بديل أكثر تشدداً (اختياري): اربط كتابة الموظف بصلاحية upload_files
-- إن أردت التشديد، استخدم can_upload_files() بدل is_staff() في سياسات
-- الكتابة في الخطوة (2) — وأبقِ is_staff() لسياسة القراءة في الخطوة (1).
CREATE OR REPLACE FUNCTION public.can_upload_files()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM merchants
    WHERE email = auth.email()
      AND COALESCE(is_active, true)
      AND (
        role IN ('admin','super_admin')
        OR (
          role = 'employee'
          AND jsonb_typeof(to_jsonb(permissions)) = 'array'
          AND to_jsonb(permissions) ? 'upload_files'
        )
      )
  )
$$;

-- 1) [الإصلاح الحاسم — يفك الانسداد الأول] الموظف يقرأ قائمة التجار
CREATE POLICY merchants_staff_select ON public.merchants
  FOR SELECT USING (public.is_staff());

-- 2) توسيع سياسات الكتابة على جداول الاستيراد (الانسداد الثاني)
-- ملاحظة: سياسات ALL بلا WITH CHECK ترث شرط USING للإدراج،
-- لذا تكفي ALTER ... USING (تم التحقق من أسماء السياسات على القاعدة الحية).
ALTER POLICY platform_file_uploads_admin_all          ON public.platform_file_uploads          USING (public.is_staff());
ALTER POLICY account_transactions_admin_all           ON public.account_transactions           USING (public.is_staff());
ALTER POLICY ad_metrics_admin_all                     ON public.ad_metrics                     USING (public.is_staff());
ALTER POLICY goods_received_admin_all                 ON public.goods_received                 USING (public.is_staff());
ALTER POLICY inbound_shipments_admin_all              ON public.inbound_shipments              USING (public.is_staff());
ALTER POLICY inbound_shipment_items_admin_all         ON public.inbound_shipment_items         USING (public.is_staff());
ALTER POLICY product_performance_snapshots_admin_all  ON public.product_performance_snapshots  USING (public.is_staff());
ALTER POLICY admin_manage_orders                      ON public.orders                         USING (public.is_staff());
ALTER POLICY admin_manage_inventory                   ON public.inventory                      USING (public.is_staff());
ALTER POLICY admin_all_returns                        ON public.returns                        USING (public.is_staff());

-- 3) تحقق يدوي بعد التطبيق: دالة rebuild_all_derived_data (تُستدعى في
-- نهاية كل استيراد، ImportFilesView.tsx:623) هي SECURITY DEFINER، لكن
-- تأكد أنها لا تحمل حارس admin داخلي يستثني الموظف:
--   SELECT pg_get_functiondef('public.rebuild_all_derived_data'::regproc);
-- إن وجدت شرط role IN ('admin','super_admin') وسّعه ليشمل 'employee'.

-- 4) (بعد التأكد أن الرفع يعمل) أعد حسابات الطاقم إلى دورها الصحيح.
-- حالياً E-6752 و E-1541 و E-6631 مرفوعة إلى role='admin' كحل مؤقت —
-- أي أن كل موظف يملك اليوم صلاحيات كاملة (حذف تجار، مسح بيانات، اشتراكات).
-- بعد الإصلاح، أرجِعهم وفعّل نظام الصلاحيات:
--   UPDATE merchants SET role = 'employee'
--   WHERE merchant_code IN ('E-6752','E-1541','E-6631')
--     AND department <> 'manager';

-- 5) تنظيف: سجل رفع عالق في 'processing' منذ 2026-06-04 (ملف GRN لتاجر M-1842)
--   UPDATE platform_file_uploads SET status = 'failed'
--   WHERE status = 'processing' AND created_at < now() - interval '1 day';
