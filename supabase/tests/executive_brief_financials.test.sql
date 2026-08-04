BEGIN;

DO $$
BEGIN
  IF security.net_order_contribution(100::numeric, 10::numeric, 5::numeric) IS DISTINCT FROM 85::numeric THEN
    RAISE EXCEPTION 'net order contribution did not subtract platform fee and shipping correctly';
  END IF;

  IF security.net_order_contribution(100::numeric, NULL::numeric, NULL::numeric) IS DISTINCT FROM 100::numeric THEN
    RAISE EXCEPTION 'net order contribution did not default missing deductions to zero';
  END IF;
END
$$;

ROLLBACK;
