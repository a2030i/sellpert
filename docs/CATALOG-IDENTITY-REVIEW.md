# Catalog scope and duplicate prevention

Products and the catalog respect the selected selling accounts. A canonical
product appears once when several selected accounts map to it. Products with no
mapping remain visible only in the legacy/unassigned scope, preserving manual
product creation and the tenant-wide mapping picker. The picker remains global
within the authorized merchant so a source can be linked to an existing variant.
Products uses the named tenant FK to fetch account memberships with its safe
columns, then filters the complete paginated snapshot before computing counts.
The catalog RPC applies the equivalent filter before its statistics/pagination.
Physical availability is calculated only for the selected page, after its counts
and limit. A variant without any reviewed pool remains unknown without scanning
its inventory observations. Bundle availability retains its component rules.
The explicit unassigned flag also preserves manual products before a merchant
connects any selling account. The original RPC signature remains for old clients;
the new browser falls back only for a missing signature during staggered rollout,
never for authorization or query failures.

The server product-ingestion RPC retains the existing merchant advisory lock and
exact account/SKU idempotency. Existing reviewed mappings remain authoritative.
When a new source identifier collides with a canonical barcode, an ambiguous SKU,
or an existing provider-product ID in the same account, it records a `review`
mapping with no canonical product rather than creating a duplicate. Distinct
nonempty barcodes or explicit variant attributes can distinguish an SKU collision;
a shared barcode still requires review even when the attributes disagree. Names
alone never distinguish variants. Unambiguous new products remain importable.

The source SKU, barcode, provider product ID, platform-specific identifiers and
color/size remain on the account observation; updates retain nonempty identifiers
and use the existing mapping audit. Repeating an unresolved observation does not
create another review or canonical row. A reviewed mapping is reused on resync.
No existing products, mappings, listings, prices, costs or source facts are merged
by this migration. Financial calculations and reviewed stock-pool rules are unchanged.

## Historical reconciliation preview

`scripts/catalog/reconciliation-preview.sql` is a read-only query for a selected
owner, not a migration. Use safe literal binding in the private runner. Its current
candidate rule is deliberately limited to historical Trendyol API V2 and connected
Trendyol rows sharing a barcode; it is not a universal automatic merge policy.
Never commit its live result or merchant identifiers to the repository.

The private preview contains each proposed historical canonical ID and retained
source-product ID; all source mappings/listings/prices and their account IDs;
cost/price/variant comparisons; creation/update/upload lineage; and source order,
stock and historical recipe references. Order/stock matches in the preview are
candidate references by identifier, not proof of the legacy seller identity and
not a combined financial or physical-stock total.

Technical identity, cost, price, same-account price/listing and recipe conflicts
must be separated from successful identity matches. Unknown cost is never zero
profit. Identical stock observations from old/new sources must not be added.
Legacy seller ownership and physical pool identity still require confirmation.

## Approval and reversible execution boundary

This release only prevents future duplicate creation and corrects display scope.
The existing pairs are previewed, not applied. A future approved reconciliation
must retain both product records and all provider identifiers. It needs an atomic
journal with immutable before/after images, an operation ID, expected row versions,
and an active alias for each retired canonical source row. Only explicitly reviewed
mapping/listing/price references may move. No order, inventory, financial, recipe
snapshot or upload record may be deleted, copied, reassigned or repriced.

Rollback must compare current rows with the operation's after-image hashes before
restoring its before-images/alias states; intervening edits cause a review stop.
The private preview includes mapping inverse operations and before-image hashes,
but it is not an executable authorization or a deployed reconciliation engine.
Rolling back this prevention release is a separate forward function replacement;
keep added source-identity columns and audit history intact.

## Verification

`catalog_duplicate_guard.test.sql` tests repeat ingestion, ambiguous/conflicting
observations, preserved identifiers, selected scopes, a reviewed mapping/inverse,
and unchanged orders, fees, stock facts, costs and prices on an isolated database.
Existing account/catalog tests cover distinct variants, repeated provider order
IDs, tenant/MFA boundaries, physical stock pools and immutable recipe costs.
Frontend tests cover pagination and scope changes on desktop/mobile.
Production resynchronization acceptance needs a before/after count around a normal
read-only provider synchronization; never run provider writes as a test.
