# Sellpert information security policy

Owner: Sellpert security owner (currently Rakan Aljuhani, Rakan@sellpert.com).
Adopted: 2026-11-26. Review: every 6 months (next review due 2027-05-26), and after
any security incident or material change to the platform.

This policy records the organizational commitments Sellpert made when registering
as an Amazon Selling Partner API (SP-API) solution provider, and it applies equally to
data from every marketplace (Amazon, Noon, Trendyol, Salla). "Amazon Information" means
any data obtained through SP-API, Amazon report files uploaded by merchants, or a
merchant-authorized intermediary. Technical enforcement lives in the code and
migrations referenced below; where a control is organizational rather than enforced by
code, this document says so.

## 1. Scope of data

- Sellpert requests only non-PII SP-API roles: Product Listing, Pricing, Amazon
  Fulfillment, Inventory and Order Tracking, Finance and Accounting, Selling Partner
  Insights. Restricted (PII) roles are not requested.
- Buyer names, addresses, phone numbers and emails must not be requested, stored or
  logged. If a provider payload contains buyer PII, it must be dropped before storage.
- Amazon Information is used only to serve the merchant who authorized it. It is never
  sold, shared with other merchants, or used for Sellpert's own marketplace selling.

## 2. Access control (least privilege)

- Merchant data is isolated by database row-level security and tenant checks
  (`security.can_access_merchant`, `security.has_merchant_permission`); see
  [Data and security](DATA_AND_SECURITY.md). UI checks are not authorization.
- Staff access follows job duties: platform staff permissions (`permissions.ts`) and
  store employee permissions (`merchantPermissions.ts`) are separate domains.
- Account managers are assigned only to the merchants they serve.
- Access is removed within 24 hours when a staff member leaves or changes role, and
  staff access lists are reviewed every 6 months together with this policy.

## 3. Passwords and multi-factor authentication

- Platform passwords: 12–128 characters, with a letter, a number and a symbol, and
  not a common password. Enforced in [`passwordPolicy.ts`](../src/lib/passwordPolicy.ts).
- MFA: every Sellpert staff account and every account with administrative access must
  enroll an authenticator-app factor. Once enrolled, protected data requires an
  `aal2` session (`security.mfa_access_allowed`). Mandatory enrollment for staff is
  currently an organizational rule, not yet enforced by code.
- Rotation: staff passwords for the platform and for the systems that hold Amazon
  Information (Amazon Seller Central / Solution Provider Portal, Supabase, Vercel,
  GitHub, company email) must be changed at least every 365 days, and immediately if
  compromise is suspected. Automatic 365-day expiry is not yet enforced by code; the
  security owner verifies rotation at each 6-month review.
- MFA must also be enabled on Supabase, Vercel, GitHub, Amazon Seller Central and the
  company email accounts.

## 4. Credentials and secrets

- Secrets (SP-API client secret, LWA refresh tokens, Supabase service keys,
  marketplace API keys) are never committed to the repository, hard-coded, shared in
  chat or email, or exposed to the browser.
- Secrets are stored in Supabase/Vercel secret settings; merchant marketplace
  credentials and refresh tokens are encrypted server-side
  (`supabase/functions/_shared/credentialVault.ts`) and returned to clients only as
  status, never as secret material.
- The repository is private. Any secret that is accidentally exposed is rotated
  immediately and handled as a security incident.

## 5. Encryption

- In transit: all traffic uses HTTPS/TLS (browser ↔ Vercel, browser/Edge Functions ↔
  Supabase, Edge Functions ↔ marketplace APIs).
- At rest: data is stored in Supabase Postgres and Storage, which encrypt data at rest;
  merchant credentials are additionally encrypted at the application layer.

## 6. Network and endpoint security

- Production runs on managed infrastructure (Supabase on AWS, Vercel) that provides
  network firewalls, DDoS protection and isolation between customers. There is no
  self-managed server.
- Database access is only through the Supabase API with RLS; direct database
  connections are restricted to the security owner for maintenance.
- Staff devices used to access Sellpert systems must have the operating system's
  anti-malware protection enabled (e.g. Microsoft Defender, macOS XProtect), automatic
  updates on, disk encryption on, and a screen lock.

## 7. Logging and monitoring

- Security-relevant actions are recorded in audit tables; client incidents are
  collected without raw payloads, query strings or credentials
  (see [Incident response](INCIDENT-RESPONSE.md)).
- Logs must not contain secrets, tokens or buyer PII.

## 8. Data retention and deletion

- Amazon Information is kept only while the merchant is a Sellpert client and the
  authorization is active.
- When a merchant revokes the app or ends the service, their Amazon Information and
  stored refresh tokens are deleted within 30 days, unless the merchant requests an
  export first or law requires longer retention.

## 9. Incidents

Security incidents follow [Incident response](INCIDENT-RESPONSE.md). Any incident
involving Amazon Information is reported to security@amazon.com within 24 hours of
detection.

## 10. Review log

| Date | Reviewer | Notes |
| --- | --- | --- |
| 2026-11-26 | Rakan Aljuhani | Policy adopted for SP-API registration. |
