-- Covers the date-first server aggregation used by admin_overview_metrics.
-- INCLUDE keeps the common totals/index scan bounded without duplicating data
-- into a materialized dashboard table.
CREATE INDEX IF NOT EXISTS performance_data_admin_overview_idx
  ON public.performance_data (data_date, platform, merchant_code)
  INCLUDE (total_sales, order_count, platform_fees, created_at)
  WHERE data_date IS NOT NULL;
