-- ============================================
-- SELLPERT 2.0 — قاعدة البيانات الكاملة
-- شغّل هذا في Supabase → SQL Editor
-- ============================================

-- جدول التجار
CREATE TABLE merchants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_code text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  currency text DEFAULT 'SAR',
  logo_url text,
  role text DEFAULT 'merchant' CHECK (role IN ('merchant', 'admin', 'super_admin')),
  subscription_plan text DEFAULT 'free' CHECK (subscription_plan IN ('free', 'pro', 'elite')),
  created_at timestamptz DEFAULT now()
);

-- جدول بيانات الأداء
CREATE TABLE performance_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_code text NOT NULL REFERENCES merchants(merchant_code),
  created_at timestamptz DEFAULT now(),
  platform text DEFAULT 'other' CHECK (platform IN ('salla', 'noon', 'amazon', 'zid', 'shopify', 'other')),
  total_sales numeric DEFAULT 0,
  order_count integer DEFAULT 0,
  margin numeric DEFAULT 0,
  ad_spend numeric DEFAULT 0,
  platform_fees numeric DEFAULT 0,
  product_name text
);

-- تفعيل RLS
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_data ENABLE ROW LEVEL SECURITY;

-- سياسات التاجر: يشوف بياناته فقط
CREATE POLICY "merchant_select_own" ON merchants
  FOR SELECT USING (email = auth.email());

CREATE POLICY "performance_select_own" ON performance_data
  FOR SELECT USING (
    merchant_code = (SELECT merchant_code FROM merchants WHERE email = auth.email())
  );

-- سياسات الأدمن: يشوف كل شي
CREATE POLICY "admin_select_all_merchants" ON merchants
  FOR ALL USING (
    EXISTS (SELECT 1 FROM merchants WHERE email = auth.email() AND role IN ('admin', 'super_admin'))
  );

CREATE POLICY "admin_select_all_data" ON performance_data
  FOR ALL USING (
    EXISTS (SELECT 1 FROM merchants WHERE email = auth.email() AND role IN ('admin', 'super_admin'))
  );

-- بيانات تجريبية (اختياري)
INSERT INTO merchants (merchant_code, name, email, currency, role, subscription_plan) VALUES
('ADMIN-001', 'مدير النظام', 'admin@sellpert.com', 'SAR', 'admin', 'elite'),
('M-101', 'متجر النور', 'merchant@example.com', 'SAR', 'merchant', 'pro');

INSERT INTO performance_data (merchant_code, created_at, platform, total_sales, order_count, margin, ad_spend, platform_fees) VALUES
('M-101', now() - interval '1 day', 'salla', 5200, 43, 22.5, 800, 260),
('M-101', now() - interval '2 days', 'noon', 3800, 31, 18.2, 600, 190),
('M-101', now() - interval '3 days', 'amazon', 6100, 55, 25.1, 950, 305),
('M-101', now() - interval '4 days', 'salla', 4400, 37, 19.8, 700, 220),
('M-101', now() - interval '5 days', 'noon', 2900, 24, 15.5, 450, 145),
('M-101', now() - interval '6 days', 'amazon', 7200, 62, 28.3, 1100, 360),
('M-101', now() - interval '7 days', 'salla', 5500, 47, 21.0, 850, 275);
