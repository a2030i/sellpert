ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS provider_claim_item_id text;

CREATE INDEX IF NOT EXISTS returns_trendyol_claim_item_idx
  ON public.returns (merchant_code, provider_claim_item_id)
  WHERE platform = 'trendyol' AND provider_claim_item_id IS NOT NULL;

UPDATE public.returns
SET
  provider_claim_item_id = COALESCE(
    NULLIF(raw->'providerClaimItem'->>'id', ''),
    NULLIF(raw->'item'->'claimItems'->-1->>'id', '')
  ),
  status = CASE lower(COALESCE(
    raw->'providerClaimItem'->'claimItemStatus'->>'name',
    raw->'item'->'claimItems'->-1->'claimItemStatus'->>'name',
    status,
    'pending'
  ))
    WHEN 'accepted' THEN 'approved'
    WHEN 'approved' THEN 'approved'
    WHEN 'autoaccepted' THEN 'approved'
    WHEN 'refunded' THEN 'refunded'
    WHEN 'completed' THEN 'refunded'
    WHEN 'processed' THEN 'refunded'
    WHEN 'resolved' THEN 'refunded'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'declined' THEN 'rejected'
    WHEN 'cancelled' THEN 'rejected'
    ELSE 'pending'
  END,
  reason = COALESCE(
    NULLIF(raw->'providerClaimItem'->'customerClaimItemReason'->>'name', ''),
    NULLIF(raw->'item'->'claimItems'->-1->'customerClaimItemReason'->>'name', ''),
    NULLIF(raw->'providerClaimItem'->'trendyolClaimItemReason'->>'name', ''),
    NULLIF(raw->'item'->'claimItems'->-1->'trendyolClaimItemReason'->>'name', ''),
    reason
  )
WHERE platform = 'trendyol';
