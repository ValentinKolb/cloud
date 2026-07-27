# App readiness checklist

Run this before calling a Cloud app — built-in or standalone — ready. It is scoped to Cloud conventions: shells, typed clients, SSR route state, permissions, migrations, and shared UI.

## What counts as authoritative

When you need to know how something should look or behave, use this order. It matters, because apps drift.

1. **The shared primitive's source** (`packages/cloud/src/ui/`, or `node_modules/@valentinkolb/cloud/src/ui/` standalone) — authoritative for what props exist and what the component already owns.
2. **`design.md`** — authoritative for visual and interaction rules.
3. **An existing app** — an *example*, not a specification.

An app that disagrees with 1 or 2 is a bug in that app, not a pattern to copy. Where two apps disagree with each other, neither is authority: derive the answer from the primitive and the design rules. Do not assume the largest or newest app is the most correct one.

## Before coding

- Identify which shared primitive covers the surface — `AppOverview`, `AppWorkspace`, `Panes`, `SettingsModal`, `PanelDialog`, `DataTable`, `StatGrid`, `Calendar`, `FileDropzone` — and compose that, rather than new layout code. `frontend.md` maps surfaces to primitives.
- Read the primitive's source the first time you use it. Props change; prose about props goes stale.
- Decide whether the requested behaviour is app domain logic or a platform primitive. Auth, session, role and principal semantics, service-account identity, credential hashing, and OAuth bearer verification are never app code.

## API and client

- `api/index.ts` exports the **final chained** Hono router as `default`, and `export type ApiType = typeof <that exact router>`. Exporting an earlier base router silently drops endpoints from the generated client. The variable need not be called `app`.
- `api/client.ts` builds the typed client with `api.create<ApiType>({ baseUrl: "/api/<app-id>" })`, and `baseUrl` matches the real mount.
- Islands use the typed client for app JSON APIs. Raw `fetch()` is reserved for external URLs, file/blob/stream transfer, WebSocket/EventSource/SSE, and smoke scripts.
- No `any`, no broad `unknown`, no `response.json() as Type` to paper over weak route types. If the client returns `unknown` or an unusable union, fix the route typing instead.
- Routes validate body/query/params with `v(...)` and app Zod schemas.
- Routes return service `Result<T>` through `respond(...)` where the shared result model fits.
- SSR pages repeat permission checks. They call services directly, so route middleware does not protect them.
- Security-relevant mutations decide authorization in the **service layer** and record allowed/denied/failed outcomes through the audit service.
- Nothing reads `c.get("user")` — `check:boundaries` fails on it. Authorization uses `c.get("accessSubject")`; where a feature needs the user for roles or display, it comes from `expectUserBackedActor(c)`.
- Authorization passes `AccessSubject` into the shared access helpers. It never trusts `User.memberofGroupIds`, request-supplied group ids, or an app-local membership snapshot. Nested memberships must behave exactly like direct ones.
- Resource-bound service accounts are checked against their exact `appId`/`resourceType`/`resourceId`; credential scopes cap the resolved permission rather than granting it. Collection and search endpoints fail closed or query only the bound resource.
- Personal surfaces — profile, roles, ownership, personal catalogs, Global Search — require a real or delegated user. No synthetic user is invented for a resource-bound account.
- A Global Search provider applies the user's permissions inside its own query, respects `limit`, and honours any `tags` it declared. The dispatcher authenticates but does not filter rows.
- Anonymous-facing pages live under their own registered prefix, never under `/public/<app>` — that path is framework-owned static assets and is unreachable as a page. They still validate the token or grant server-side.
- Resource API keys and OAuth service clients are granted through the app's normal resource access adapter. `PermissionEditor` may show existing service-account principals but never creates or reveals credentials.

## Data and lifecycle

- App schema lives in the app's own Postgres schema. `auth.*` is referenced by foreign key, never migrated or mutated by an app.
- Migrations are idempotent: `CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `.simple()` for DDL.
- Never add and drop temporary columns. Postgres counts dropped columns against the 1600-column limit; repeated cycles across deployments exhaust it.
- Every created resource has matching edit and delete flows, unless create-only was explicitly requested.
- Optional resource types are complete: if the UI can create a type, it can also be edited, deleted, and rendered.
- App-wide settings go in `defineApp({ settings })`. Per-resource settings live in the app's own schema.
- Scheduled work carries `@k2b/sync` schedule metadata (`appId`, `family`, `label`, `source`) plus `trace.fromSyncSchedule`. Run-now controls belong to Gateway Ops observability, not app-local admin endpoints.

## SSR and routing

- Pages are explicitly mapped in `frontend/index.ts`. File layout is organisation, not routing.
- SSR pages return a render function and use `Layout` as the outer wrapper.
- Filters, pagination, selected detail, calendar view/date, and workspace view live in URL state whenever reload, share, and back/forward should work.
- **No filtering, sorting, pagination, grouping, or aggregation happens in the browser.** Every result set comes from a server query driven by URL state; counts come from `COUNT(*)`, not `items().length`. The only local filtering allowed is over a bounded, fully-loaded set such as a picker's options.
- Every screen is correct on a cold load with JavaScript disabled or not yet run. Enhanced navigation is layered on top, never the only correct path.
- Enhanced navigation preserves normal anchor behaviour: modifier-click, new tab, external links, and hard-reload fallback.
- If enhanced navigation changes breadcrumbs, update them via `layout.update(...)` — and the SSR page must still render the same breadcrumbs on reload.

## UI shell

- Standard inset workspace content puts `p-[var(--ui-space-shell)]` directly on `AppWorkspace.Main` — not `p-3`/`p-4`, not a padding-only wrapper. Edge-to-edge tables, editors, canvases, and pane layouts are deliberate exceptions.
- Contextual right-side detail is an `AppWorkspace.Detail` sibling after Main, never a second column inside Main.
- Detail panels compose `detail-section` cards inside a `detail-stack`. The stack owns spacing between cards; sections own only surface and inner padding.
- Multiple details and bottom drawers use stable, purpose-based ids — never the selected entity's id.
- Resource settings use `SettingsModal` as the shell, whether opened as a modal or rendered in a route-backed page.
- Complex editor modals use `PanelDialog`; small prompts stay with `prompts.form` or `prompts.dialog`.
- Tables use `DataTable`; stats use `StatGrid`/`StatCell`; calendars use `Calendar`.
- No `<hr>`, `divide-y`, or full-width `border-t`/`border-b` to group ordinary content. See the hard rule in `design.md`.

## UX copy

- Button labels name the action: `New Space`, `Blank notebook`, `Submit feedback` — not a generic `OK` on a control that writes data.
- Inputs carry short descriptions when the consequence is not obvious from the label.
- Empty states say what is missing and which action creates it.
- Public and anonymous flows state the privacy scope precisely.
- Stats include context: range, unit, denominator, or subtitle. A bare `4` is not a stat.
- Feature labels reuse the domain noun already used elsewhere in the app. Do not introduce synonyms for one resource.

## Verification

Run the app's own checks:

```bash
bun run typecheck
bun test
```

In the monorepo, target one package with `bun run --filter @valentinkolb/cloud-app-<app> typecheck`.

Then:

- Add focused `bun:test` coverage for pure helpers or validation rules the change introduced.
- Run `fallow dead-code --workspace packages/<app>` and resolve or narrowly suppress convention false positives.
- Run `fallow health --workspace packages/<app>` and triage complex hotspots. Refactor where the finding points at real risk; otherwise record the remaining risk.
- Smoke the public route, if the app has one.
- Smoke the authenticated overview and the main workspace route.
- Smoke one create/edit/delete path per user-created resource type the change touched.
- For calendar and list route state, verify URL change, reload, and back/forward.
- Review the rendered UI in light and dark mode.

## Before handing off

- Search changed markup and styles for `<hr>`, `divide-y`, `border-t`, `border-b`, and decorative inset rules. Remove every ordinary-content separator; document any remaining functional exception in the review notes.
- Do not touch files already modified by another active change.
- Recheck `git status` before every slice and before staging.
- Stage exact owned paths.

## Maintaining this skill

Not app-author content — use these when testing whether the skill still prevents known pattern drift:

1. *"Build a new app with overview, templates, settings, shifts, public page, and feedback."*
   Expected: `AppOverview`, `SettingsModal`, `AppWorkspace`, typed Hono client, URL-backed calendar route state, complete edit/delete flows.
2. *"Add settings to a notebook-like app."*
   Expected: bare `prompts.dialog` + `SettingsModal`; no bespoke settings layout, no extra prompt header around the modal.
3. *"Add feedback analytics with filters."*
   Expected: `StatGrid`, `DataTable`, URL-backed search and filter chips, server-rendered typed data, no hand-written table grid.
