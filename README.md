# Sellpert Merchant Analytics Dashboard

## Files
- `dashboard.html` — Main analytics dashboard
- `login.html` — Login page

## Setup (New Supabase Project)

### 1. Supabase Config
Open both `dashboard.html` and `login.html` and replace:
```
const SP_SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SP_SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```
With your new project's URL and anon key from:
**Supabase → Settings → API**

---

### 2. Create Tables

Run this SQL in **Supabase → SQL Editor**:

```sql
-- Merchants table
CREATE TABLE merchants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  merchant_code text NOT NULL UNIQUE,
  merchant_name text,
  created_at timestamptz DEFAULT now()
);

-- Performance data table
CREATE TABLE performance_data (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_code text NOT NULL REFERENCES merchants(merchant_code),
  date date NOT NULL,
  revenue numeric DEFAULT 0,
  orders integer DEFAULT 0,
  roi numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
```

---

### 3. Enable Row Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_data ENABLE ROW LEVEL SECURITY;

-- Merchants: each user sees only their own record
CREATE POLICY "merchant_own" ON merchants
  FOR SELECT USING (email = auth.email());

-- Performance data: merchant sees only their data
CREATE POLICY "performance_own" ON performance_data
  FOR SELECT USING (
    merchant_code = (
      SELECT merchant_code FROM merchants WHERE email = auth.email()
    )
  );
```

---

### 4. Create a Merchant User
1. **Supabase → Authentication → Users → Add User**
2. Enter email + password
3. Run SQL to link them to a merchant:
```sql
INSERT INTO merchants (email, merchant_code, merchant_name)
VALUES ('merchant@example.com', 'MC001', 'My Store');
```

---

### 5. Add Sample Data (optional)
```sql
INSERT INTO performance_data (merchant_code, date, revenue, orders, roi) VALUES
('MC001', '2024-01-01', 5200.00, 43, 18.5),
('MC001', '2024-01-02', 4800.00, 38, 15.2),
('MC001', '2024-01-03', 6100.00, 51, 22.1);
```

---

## Features
- ✅ Supabase Auth with session guard
- ✅ Merchant-scoped data isolation
- ✅ 3 languages: English, Malay, Chinese
- ✅ 6 date preset filters (client-side)
- ✅ 4 KPI cards (Revenue, Orders, AOV, ROI)
- ✅ Revenue line chart + Orders bar chart (Chart.js)
- ✅ Color-coded data table
- ✅ Auto column name detection (revenue/total_sales, orders/order_count, roi/margin)
- ✅ Language preference saved in localStorage
