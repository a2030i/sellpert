# Codex guide for Sellpert

## Start here

Sellpert is an Arabic/RTL, multi-tenant merchant operations and sales analytics SPA.
It uses React/TypeScript/Vite in the browser and Supabase Auth, Postgres, Storage,
and Deno Edge Functions. npm is the package manager; use the committed lockfile.

Before changing anything:

1. Read this file, then only the reference sections relevant to the task. The table
   is a routing guide, not a requirement to read every document for every task.
2. Check `git status --short`; preserve unrelated user changes.
3. Trace the affected page/helper → query/RPC/Edge Function → latest migrations
   and associated tests. A page existing on disk does not prove it is reachable.
4. State uncertainty as `NEEDS_CONFIRMATION`, with the evidence needed to resolve it.
   Do not invent product rules, live configuration, credentials, or test results.

| Task | Read |
| --- | --- |
| Product, navigation, data flow, existing architectural decisions | [Architecture](docs/ARCHITECTURE.md) |
| SQL, RLS, identity, financial rules, imports, schema sources | [Data and security](docs/DATA_AND_SECURITY.md) |
| APIs, providers, webhooks, credential boundaries | [Integrations](docs/INTEGRATIONS.md) |
| Local setup, environment names, checks, unresolved facts | [Development](docs/DEVELOPMENT.md) |
| Explicitly authorized releases | [Production releases](docs/PRODUCTION_RELEASES.md) |
| Incidents / recovery | [Incident response](docs/INCIDENT-RESPONSE.md), [Recovery](docs/DISASTER-RECOVERY.md) |

## Standing rules

- Preserve current behavior unless the task requires changing it. Keep changes scoped.
- Never display, edit, commit, or upload secrets. Do not print `.env*`, credential
  files, tokens, raw provider payloads, or customer records. Check presence by name
  only. Stop and report missing required configuration; do not invent substitutes.
- Do not deploy, trigger release workflows, or change Production without the
  user's explicit request. A push to `main`/`master` can trigger production.
- Do not apply any migration (including locally), repair migration history, or run
  commands that apply migrations implicitly without an explicit user request for
  that action and target. This includes `supabase start` on a fresh local stack.
  Writing/reviewing migration files does not authorize applying them.
- Destructive migrations and production-data changes additionally require explicit
  approval for the concrete change. Never bypass parity guards or bulk-repair history.
- No force push, destructive reset, or discarding unrelated changes.
- UI permission checks are not authorization. Preserve database tenant/RLS/MFA,
  grants, private RPC boundaries, and Edge Function actor checks.
- Keep marketplace writes behind their existing validation, confirmation,
  idempotency and audit paths. Do not run live provider writes as a test.
- Preserve financial source precedence, incomplete-cost states, order-level
  commissions, import atomicity, private archives, and source lineage.
- Do not enable hidden merchant routes, restore retired billing/integrations,
  or promote Omniful shadow observations into canonical orders incidentally.
- Treat `supabase/migrations/` as ordered schema history; inspect later
  replacements, grants and dynamic SQL. Do not use `supabase-schema.sql` to initialize
  the app, and do not hand-edit generated `src/lib/database.types.ts`.
- Keep documentation aligned with changed behavior; dated reports are historical
  evidence, not implementation instructions. Repository integration code does not
  prove production enablement; migration files do not prove production application;
  local settings do not prove production configuration. Mark live claims without
  verified evidence `NEEDS_CONFIRMATION`.

## UI/UX standard

For interface tasks, work first as a Senior Product Designer + Design Systems
Engineer for an Arabic SaaS/operations product, then as an implementer.

- Define the user task and primary decision before JSX/CSS. Establish information
  hierarchy and layout before implementation.
- Inspect and reuse existing components, tokens and interaction patterns before
  introducing new ones.
- Create calm, professional interfaces; avoid generic AI-dashboard styling.
  No rainbow dashboards: use neutral surfaces and reserve color for status and
  meaning. Do not rely on color alone.
- Do not turn every KPI or fact into a card. Avoid gradients, heavy shadows and
  decoration unless they serve a clear functional purpose.
- Keep typography, spacing, alignment and information density consistent.
- Make tables easy to scan and compare: prioritize columns and consistently align
  numbers and actions.
- Give forms clear grouping and hierarchy, understandable validation and errors
  associated with the relevant field.
- Keep primary actions few and clear. Visually separate dangerous actions so they
  do not compete with the primary action.
- Use progressive disclosure for secondary detail. Do not repeat information
  across cards, charts and tables without a task-specific reason.
- Design desktop and mobile deliberately; mobile is not a scaled-down desktop.
- Design Loading, Empty, Error, Disabled, Partial Data and Permission Denied states.
- Handle RTL and Arabic deliberately in alignment, tables, numbers, long text and
  mixed Arabic/English content.
- Before a major redesign, present an analysis of the current screen and identify
  what will remain, be merged or be removed.
- After implementation, perform a separate Visual/UX Review of the rendered UI:
  hierarchy, spacing, alignment, typography, density, contrast, responsiveness,
  accessibility and consistency. Build/test success does not establish design quality.
- For large UI tasks, when agents are available, use an independent Product Designer
  before implementation and an independent UI/UX reviewer afterward.

## Checks and handoff

Use Node 22.12+ within the Node 22 line used by CI (manifest says `>=22`;
locked Vite requires a higher minimum). From the repository root:

```sh
npm ci
npm run build
npm run lint
npm test
git diff --check
```

Choose additional browser, SQL and Deno checks using
[the test matrix](docs/DEVELOPMENT.md#test-matrix). For documentation-only changes,
check references, factual claims, whitespace and the diff; runtime tests are not
required unless the documentation change affects a tested contract.
After development, review `git diff` and `git status --short` for unrelated changes.
Report what changed, checks actually run, failures/skips and remaining uncertainty.
Never equate a mocked browser test or TypeScript build with live integration validation.
