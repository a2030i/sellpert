BEGIN;

DO $$
BEGIN
  IF security.sellpert_order_commission('delivered', 100, 15, 'percentage', 10)
      IS DISTINCT FROM 11.5000::numeric THEN
    RAISE EXCEPTION 'percentage commission must use successful order sales including customer shipping';
  END IF;

  IF security.sellpert_order_commission('cancelled', 100, 15, 'percentage', 10)
      IS DISTINCT FROM 0.0000::numeric THEN
    RAISE EXCEPTION 'cancelled orders must earn no Sellpert commission';
  END IF;

  IF security.sellpert_order_commission('returned', 100, 15, 'fixed', 10)
      IS DISTINCT FROM 0.0000::numeric THEN
    RAISE EXCEPTION 'returned orders must earn no Sellpert commission';
  END IF;

  IF security.sellpert_order_commission('shipped', 100, 15, 'fixed', 10)
      IS DISTINCT FROM 0.0000::numeric THEN
    RAISE EXCEPTION 'orders not yet delivered must earn no Sellpert commission';
  END IF;

  IF security.sellpert_order_commission('delivered', 500, 0, 'fixed', 10)
      IS DISTINCT FROM 10.0000::numeric THEN
    RAISE EXCEPTION 'fixed commission must be charged once for the whole order';
  END IF;

  IF security.sellpert_order_commission('delivered', 500, 0, 'none', 0)
      IS DISTINCT FROM 0.0000::numeric THEN
    RAISE EXCEPTION 'zero contract must earn no commission';
  END IF;
END
$$;

ROLLBACK;
