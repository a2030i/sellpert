# APIs and external integrations

This is the API surface found in the repository. Production enablement and working
credentials/scopes for every provider, including Trendyol, Salla and Omniful, are
`NEEDS_CONFIRMATION`. Handler/config/migration files do not prove deployment or
activation. Read [Data and security](DATA_AND_SECURITY.md)
before changing any tenant-facing handler.

## Browser and server API split

Browser code uses Supabase Auth, PostgREST tables/views/RPCs, Storage, and
`/functions/v1/<function-name>`. Edge handlers are under
[`supabase/functions/`](../supabase/functions/); shared provider normalization,
auth, retry, encryption and validation live under `_shared/`.

Most user operations send a session bearer token (many also send the browser
anon key). The anon key is not authority for a privileged operation.
`supabase/config.toml` explicitly disables gateway JWT verification for:
`trendyol-webhook`, `salla-webhook`, `salla-oauth-callback`, `queue-worker`,
and `pricing-request`. Their handler-specific trust checks are essential;
never enable/disable gateway checks as a generic fix.

| Edge Function(s) | Contract / purpose |
| --- | --- |
| `manage-platform-credentials` | Trendyol credential list/save/delete, queue sync, sync status; returns safe status rather than secret material |
| `test-platform-connection`, `sync-trendyol` | Connection validation and normalized marketplace synchronization |
| `trendyol-actions` | Fixed action registry for products, pricing/stock, packages, invoices, claims, questions and provider reference operations |
| `trendyol-webhook` | Validated provider callbacks, event dedupe and order/queue updates |
| `salla-oauth-callback`, `salla-webhook`, `salla-sync` | Existing Salla onboarding/token, signed event and synchronization paths |
| `queue-worker` | Internal job selection/completion, dispatch to Salla/Trendyol and legacy credential sealing |
| `manage-omniful-amazon` | Despite its historical name, Amazon/Noon/Trendyol shadow observations, account modes, channel discovery/assignment and portal configuration |
| `admin-integration-settings` | Guarded server-side integration setting writes and safe configuration status |
| `create-merchant`, `create-employee` | Identity provisioning; employee handler also manages invitation/access-link operations |
| `impersonate-merchant`, `admin-reset-merchant-password` | Privileged, actor-checked account access/reset operations |
| `mfa-recovery`, `account-lifecycle` | Recovery-code management, bounded export and account-closure request/cancellation |
| `manual-entry` | Authorized merchant selection and performance entry |
| `activity-feed` | Filtered activity from audit data; do not grant direct audit table access |
| `pricing-request` | Public GET form schema and multipart POST submissions, attachments and follow-up initialization |

This table is an index, not a replacement for request validation and response
shape in each handler. In particular, `trendyol-actions` defines accepted methods,
paths, risk levels and payload rules in its own `ACTIONS` registry; do not permit
caller-provided URLs or forward arbitrary provider operations.

## Provider behavior and constraints

### Trendyol

Direct integration uses server-held seller credentials, provider-specific
normalizers, package/item identity and financial rules. Product V2 listing,
review and delivery state are separate from local product existence.

The action handler enforces its confirmation/idempotency/audit paths for writes.
Preserve reconciliation of uncertain outcomes rather than blindly repeating
mutations. Shared sync range validation requires the upper bound to be at least
two minutes in the past. Read [sync.ts](../supabase/functions/_shared/sync.ts),
the action handler and associated tests before changing retries or date windows.

Webhook authentication uses configured secret material and bounded request
bodies. The webhook handler and `_shared/webhookSecurity.ts` define accepted
forms and timing-safe comparisons. Do not remove them because gateway JWT
verification is disabled.

### Salla

Server implementation remains even though the launch product/direct-connection
types are narrower. `getSettings.ts` reads selected DB settings before environment
fallbacks. The OAuth callback exchanges the authorization code, retrieves store
identity from the provider and checks any supplied store ID against it; existing
email alone does not authorize takeover of an existing Sellpert identity.
Do not claim a separate OAuth-state validation solely from a config comment.

Salla webhooks validate HMAC signatures and synchronize via the queue.
`_shared/sallaTokenVault.ts` uses guarded token RPCs and has compatibility handling
for older schema representations. Preserve deployment compatibility; do not treat
the fallback as permission for new plaintext token storage.

### Omniful

`manage-omniful-amazon` supports central-account and merchant-account modes,
encrypted account credentials, channel discovery and scoped channel assignments.
Central tokens require a safe store/seller scope; provider identity that needs
review must not be treated as a verified tenant mapping.

Synchronization compares provider orders against canonical orders and writes
`omniful_order_observations` with shadow/match state. It does not write canonical
`orders` or rebuild financial sales. Adding provider names/capabilities does not
authorize promoting this feed. Actual merchant enablement is `NEEDS_CONFIRMATION`.

### File-only and retired paths

Amazon/Noon report imports remain in `platformParsers.ts`; other named parser
formats are not evidence of direct provider APIs. The migration
`20260810180331_remove_retired_integrations_and_billing.sql` contains SQL to remove
retired provider/billing paths while keeping imported data. Whether that migration
has run in Production is `NEEDS_CONFIRMATION`. Do not resurrect removed
direct integrations or paid-subscription behavior from baseline tables or old docs.

## Credentials and internal scheduling

- `credentialVault.ts` encrypts credential payloads with AES-GCM. It accepts a
  configured encryption key or derives a fallback from the service-role key.
  Changing either key can affect existing ciphertext: rotation requires a
  reviewed migration/re-encryption plan.
- New platform credential writes use encrypted `extra.secret_blob`; compatibility
  reads and queue sealing of legacy columns exist. Browsers receive safe metadata.
- `QUEUE_WORKER_SECRET` is read from `app_settings`, not from a frontend variable.
  The worker accepts dedicated internal authorization or service-role bearer;
  public anon credentials must never become worker authorization.
- Queue dispatch currently maps Salla and Trendyol, not Omniful. SQL cron/
  `pg_net` authorization and timeouts are versioned in migrations.
- See [environment inventory](DEVELOPMENT.md#environment-inventory) for names only.
  Provider credentials also live in protected DB records; an env-name inventory
  is not a complete list of merchant credential fields.

## Public service requests

[pricing-request](../supabase/functions/pricing-request/index.ts) accepts only
published forms. POST validates question types/options/required fields, a honeypot,
minimum completion time and a source-hash rate limit. Attachments are PDF/JPEG/PNG,
up to 5 MiB each and 15 MiB total, stored privately. Failed submission persistence
has cleanup logic; do not describe Storage plus SQL writes as one DB transaction.

[ServiceRequestsView](../src/pages/admin/ServiceRequestsView.tsx) manages the
forms, stages and follow-up through administrator RLS. Preserve the separate
public Edge entrypoint; do not grant anonymous table or bucket access.
[e2e/service-request-flow.spec.ts](../e2e/service-request-flow.spec.ts) mocks
the function response and does not prove live rate limiting or storage isolation.
