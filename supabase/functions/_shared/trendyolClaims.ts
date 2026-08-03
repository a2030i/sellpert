export function normalizeTrendyolClaimStatus(value: unknown): string {
  const status = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '')
  if (['accepted', 'approved', 'autoaccepted'].includes(status)) return 'approved'
  if (['refunded', 'completed', 'processed', 'resolved'].includes(status)) return 'refunded'
  if (['rejected', 'declined', 'cancelled'].includes(status)) return 'rejected'
  return 'pending'
}
