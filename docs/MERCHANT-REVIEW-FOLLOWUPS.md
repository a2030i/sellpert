# Merchant review follow-ups

This release addresses the merchant screens only; it is not acceptance of the
admin screens or approval to merge historical product identities.

## Advertising

The merchant loader reads all scoped ad pages under one 20-second deadline and
cancels superseded requests. It rejects partial totals and offers retry on error.
The ad tenant policies retain their original access predicate with actor-wide
inputs evaluated once per statement, matching the reviewed Products optimization.
Successful import status is not proof that a different selling account contains
those observations: legacy ad files remain in their legacy accounts.

## Inventory

`inventory_ageing_by_account` and `inventory_pipeline_by_account` are invoker
views. SKU, ASN, receiving and order joins include the merchant and selling
account, and the browser applies the selected account filter. Identical source
references in another account cannot supply sales or receipts.

Shipment sales columns describe account sales after the receipt date, not item
allocation to a shipment. They must not be summed across overlapping shipments.
An absent sale observation does not establish that an item has never sold.

Health and ageing reads reject failed/partial loads and expose retry. Missing
costs are unknown, not zero valuation. Cost totals are unavailable when held
stock lacks cost; the interface shows record-level cost coverage. A known
zero quantity contributes zero without inventing a unit cost. The no-purchase
state requires complete current sales evidence and known costs; partial or
absent evidence is disclosed. Valid recommendations can still be shown for the
covered subset with an explicit coverage note.

Health resolves source identifiers in one relational join instead of invoking
the catalog resolver for every inventory record before applying the account
filter. Multiple aliases of one product do not multiply stock, and conflicting
product candidates remain unresolved. Cost precedence and reserved quantities
are unchanged. A read-only production comparison found identical results for
all 1,755 inventory records in the reviewed workspace before deployment.

## Amazon and financial review

Connection copy distinguishes unconfigured, ready-to-connect, connected and
unknown/error states. Synchronization is described as active only for a connected
account; an unconfigured application has no promised launch date.

An unusual financial relationship is a review signal, not proof of an error.
Order-detail profitability is withheld while its financial review flag is set,
even if product costs are later supplied. Recorded amounts are not rewritten.

The reviewed historical sample traces to an Amazon transaction import, but its
original archive and raw field details are absent. The current CSV parser maps
product-charge totals to credit, negative Amazon fees to debit, and the report
total to net_amount. This does not prove the original report's full composition.
Shipping, tax, promotions or other adjustments require the source report before
acceptance. The private sample evidence is kept outside this repository.

## Verification and remaining acceptance

Unit tests cover advertising pagination/cancellation, unknown cost and sales
evidence, scope routing and financial-review gating. Isolated SQL tests cover
identical SKU/ASN values across seller accounts, tenant isolation and ad access.
Browser journeys cover the scoped screens and unconfigured Amazon on desktop
and mobile with synthetic data. Production-role checks and a merchant-session
retest are separate acceptance steps, not implied by these tests.

No historical costs, quantities, prices, order values or source account IDs are
changed by this release. Product pair reconciliation and incomplete composite
records remain subject to their separate data-completion/review process.
