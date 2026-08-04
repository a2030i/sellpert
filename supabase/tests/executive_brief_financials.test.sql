BEGIN;
SELECT plan(2);

SELECT is(
  security.net_order_contribution(100::numeric, 10::numeric, 5::numeric),
  85::numeric,
  'net order contribution subtracts platform fee and shipping only'
);

SELECT is(
  security.net_order_contribution(100::numeric, NULL::numeric, NULL::numeric),
  100::numeric,
  'missing deductions default to zero'
);

SELECT * FROM finish();
ROLLBACK;
