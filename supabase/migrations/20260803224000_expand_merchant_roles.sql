-- Keep account types explicit at the schema boundary.
ALTER TABLE public.merchants
  DROP CONSTRAINT IF EXISTS merchants_role_check;

ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_role_check
  CHECK (role = ANY (ARRAY['merchant','employee','staff','admin','super_admin']::text[]));
