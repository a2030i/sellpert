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
