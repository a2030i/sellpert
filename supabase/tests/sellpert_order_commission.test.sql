BEGIN;
SELECT plan(6);

SELECT is(
  security.sellpert_order_commission('delivered', 100, 15, 'percentage', 10),
  11.5000::numeric,
  'percentage uses successful order sales including customer shipping'
);

SELECT is(
  security.sellpert_order_commission('cancelled', 100, 15, 'percentage', 10),
  0.0000::numeric,
  'cancelled orders earn no Sellpert commission'
);

SELECT is(
  security.sellpert_order_commission('returned', 100, 15, 'fixed', 10),
  0.0000::numeric,
  'returned orders earn no Sellpert commission'
);

SELECT is(
  security.sellpert_order_commission('shipped', 100, 15, 'fixed', 10),
  0.0000::numeric,
  'orders not yet delivered earn no Sellpert commission'
);

SELECT is(
  security.sellpert_order_commission('delivered', 500, 0, 'fixed', 10),
  10.0000::numeric,
  'fixed commission is charged once for the whole order'
);

SELECT is(
  security.sellpert_order_commission('delivered', 500, 0, 'none', 0),
  0.0000::numeric,
  'zero contract earns no commission'
);

SELECT * FROM finish();
ROLLBACK;
