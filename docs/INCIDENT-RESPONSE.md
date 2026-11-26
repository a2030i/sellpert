# Sellpert incident response

## Detection sources

- `Production smoke monitor` checks the public application, security headers, Supabase reachability, and anonymous authorization boundaries every 15 minutes.
- Browser render, unhandled promise, network, and Supabase server failures are deduplicated in `security.client_incidents`.
- Each browser incident includes the immutable Vercel Git release, sanitized page path, component, action, status code, and occurrence count. Raw messages, query strings, request bodies, and stack traces are not collected.
- Queue, import, synchronization, webhook, and stale-connection indicators are available in the administration database-health view.

## Severity and response target

| Severity | Example | Initial response target |
| --- | --- | --- |
| Fatal | Application cannot render or a core journey is unavailable | 15 minutes |
| Error | Repeated API/server failure or failed synchronization | 60 minutes |
| Warning | Degraded freshness or isolated recoverable issue | One business day |

The accountable role is the platform operator on duty. The operator must record an incident owner before changing status from open.

## Triage sequence

1. Confirm scope using release, page, merchant code, occurrence count, and production smoke status.
2. Check Supabase Auth, Postgres, Edge Function, and Storage logs without copying customer payloads into tickets.
3. Contain the failure: pause the affected integration or release, not the whole platform, unless tenant isolation or data integrity is at risk.
4. Reproduce against an isolated environment and add a regression test before deploying a fix.
5. Verify CI, production smoke, queue/cron health, and a representative merchant journey.
6. Mark the incident resolved and record the root cause and prevention action outside customer-visible notes.

## Escalation conditions

Immediately escalate any suspected cross-tenant access, credential exposure, unauthorized marketplace write, unrecoverable data loss, or prolonged authentication outage. Preserve audit evidence and do not delete affected records during investigation.

## Roles

| Role | Responsibility |
| --- | --- |
| Security owner (currently Rakan Aljuhani, Rakan@sellpert.com) | Owns this plan, decides on external notifications, approves closure of security incidents |
| Platform operator on duty | Detects, triages and contains; records the incident owner and timeline |
| Account manager of the affected merchant | Informs the merchant once the security owner approves the message |

## Security incidents and external notification

A security incident is any suspected or confirmed unauthorized access to, disclosure,
loss or alteration of merchant data or credentials, including Amazon Information as
defined in the [Security policy](SECURITY-POLICY.md).

1. Record the detection time; every deadline below is measured from it.
2. Contain: revoke or rotate the affected credentials and refresh tokens, disable the
   affected integration or account, and preserve audit evidence.
3. Amazon: if Amazon Information may be involved, email security@amazon.com within
   24 hours of detection, even if the investigation is not finished. Include what is
   known, the affected merchants and data, containment steps and a contact person.
   Send updates as facts are confirmed.
4. Other marketplaces and merchants: notify affected merchants and any marketplace
   whose terms require it, as soon as scope is known.
5. After resolution, record root cause, impact, notifications sent (with times) and
   prevention actions.

## Plan review

This plan is reviewed every 6 months together with the [Security policy](SECURITY-POLICY.md)
(next review due 2027-05-26), and after every security incident. Each review confirms
role assignments and contact details, staff access lists, MFA enrollment, and
password rotation, and is recorded in the review log of the security policy.
