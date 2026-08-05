-- Order-item provider payloads are operational order data. Dashboard users
-- and platform staff can obtain aggregate order facts through the existing
-- safe RPCs, but must not be able to read raw marketplace line payloads.

DROP POLICY IF EXISTS merchant_permission_read ON public.order_items;
DROP POLICY IF EXISTS merchant_permission_select_boundary ON public.order_items;

CREATE POLICY merchant_permission_read ON public.order_items
FOR SELECT TO authenticated
USING (
  NOT (SELECT security.is_platform_staff_account())
  AND (SELECT security.current_has_merchant_permission('orders'))
);

CREATE POLICY merchant_permission_select_boundary ON public.order_items
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  NOT (SELECT security.is_platform_staff_account())
  AND (SELECT security.current_has_merchant_permission('orders'))
);
