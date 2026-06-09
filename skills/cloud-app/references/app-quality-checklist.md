# Cloud app quality checklist

Use this checklist before calling a built-in Cloud app ready. It is scoped to StuVe Cloud conventions: app shells, Hono clients, SSR route state, permissions, migrations, and shared UI components.

## Before coding

- Pick the closest reference app and copy its shell first:
  - overview/resources: Notebooks, Spaces, Grids;
  - workspace/calendar: Spaces;
  - list/detail: Contacts;
  - admin tables: Logging, OAuth, Contacts admin;
  - settings/access: Notebooks, Contacts, Grids.
- Read the matching Core component source in `packages/cloud/src/ui/` when using a shared component for the first time.
- Check whether the requested behavior is app domain logic or a platform primitive. Auth/session/role/principal semantics, service accounts, API credential hashing, and OAuth bearer verification stay in `packages/cloud/` or the OAuth app.

## API and client

- `api/index.ts` exports the final chained Hono router as `default` and derives `export type ApiType = typeof finalRouter` from that exact exported router. The variable does not need to be named `app`; examples include `appWithAdmin`, `combined`, or `apiRoutes`.
- `api/client.ts` uses:

```ts
import { api } from "@valentinkolb/cloud/browser";
import type { ApiType } from ".";

export const apiClient = api.create<ApiType>({ baseUrl: "/api/my-app" });
```

- The `baseUrl` matches the app's real API mount (`/api/<app-id>` unless the existing app uses a documented special path).
- Frontend islands use the typed `apiClient` for app JSON APIs.
- Do not use native `fetch("/api/<app>...")` for app-internal JSON calls.
- Do not hide weak route typing with `any`, broad `unknown`, or `response.json() as Type`. If the typed client is weak, fix the Hono route typing.
- Raw fetch is only for external URLs, file/blob/stream transfer, WebSocket/EventSource/SSE, or smoke/test scripts.
- API routes validate body/query/params with `v(...)` and app Zod schemas.
- API routes return service `Result<T>` through `respond(...)` where the shared result model fits.
- SSR pages repeat permission checks instead of assuming API routes protect server-side service calls.
- Security-relevant mutations put authorization checks in the service layer and record allowed/denied/failed outcomes through the central audit service.
- Permission-aware APIs and services use `c.get("actor")` and `c.get("accessSubject")`, not only `c.get("user")`, so user-bound keys, resource API keys, and OAuth service tokens follow the same access path.
- Resource API keys and OAuth service clients are granted through the app's normal resource access adapter. `PermissionEditor` may include existing service-account principals but does not create or reveal credentials.

## Data and lifecycle

- App schema lives in the app's own Postgres schema; `auth.*` is referenced but not migrated or mutated by the app.
- Migrations are idempotent: `CREATE ... IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `.simple()` for DDL.
- Created resources have matching edit and delete flows unless the user explicitly requested create-only data.
- Optional resource/module types are complete: if the UI can create a type, admin can edit/delete it and public/workspace views can render it.
- Settings belong in `defineApp({ settings })` when they are app-wide platform settings; resource settings belong in the app's own schema and settings modal.

## SSR and routing

- Pages are explicitly mapped in `frontend/index.ts`; file names are organization, not automatic routing.
- SSR pages return a render function and use `Layout` as the outer wrapper.
- Filters, pagination, selected detail items, calendar view/date, and workspace view live in URL state when reload/share/back-forward should work.
- AppWorkspace routes that require server data use document navigation or an explicit route-state endpoint modeled after Spaces/Grids.
- Enhanced navigation must preserve normal anchor behavior: modifier click, new tab, external links, and hard reload fallback.
- If enhanced navigation changes Cloud breadcrumbs, update them via `layout.update(...)`; the SSR page must still render the same breadcrumbs on reload.

## UI shell

- Top-level resource overview pages with cards and create starters use `AppOverview`, not a custom landing page. List/detail apps such as Contacts use `AppWorkspace`.
- Create column uses `AppOverview.Aside title="Create"` with template/starter buttons and one blank/create-from-scratch button.
- Full-height resource screens use `Layout fullWidth` + `AppWorkspace`; add `fullPage` only when the route should match an existing footerless full-height reference.
- AppWorkspace main content does not add generic outer padding; use `gap-2` rhythm.
- Detail panels are composed from section cards (`detail-section`) inside a `detail-stack`; do not wrap the whole detail panel in one large paper or mix section margins with parent gaps.
- Resource settings use `SettingsModal` as their shell. Modal settings open it in a bare prompt dialog; route-backed settings still reuse the same shell instead of inventing a local layout.
- Complex editor modals use `PanelDialog`; small prompts stay with `prompts.form` or plain `prompts.dialog`.
- Tables use `DataTable`; disable column hover with `highlightColumns={false}` when the design calls for row-only hover.
- Stats use `StatGrid`/`StatCell`; calendars use `Calendar`.
- Apps that create admin-relevant audit events expose a searchable admin `DataTable` with URL-backed filters and resource/user deep links.

## UX copy and visible behavior

- Button labels name the Cloud action: `New Space`, `Blank notebook`, `Submit feedback`, not generic `OK` where the action writes data.
- Form inputs include short descriptions when the app-specific consequence is not obvious.
- Empty states tell the user what is missing and which Cloud action creates it.
- Public/anonymous flows state privacy scope precisely.
- Dashboard/widget stats include context: range, unit, denominator, or subtitle.
- Feature labels match the domain noun used elsewhere in the app; avoid introducing synonyms for the same resource.

## Verification

- Run the app's `typecheck` script.
- Run app tests; add focused `bun:test` coverage for pure helpers or validation rules introduced by the change.
- Run `fallow dead-code --workspace packages/<app>` and resolve or narrowly suppress app-convention false positives.
- Run `fallow health --workspace packages/<app>` and triage complex hotspots. Refactor when the finding points to real app risk; otherwise record remaining risk.
- Smoke the public route if the app has one.
- Smoke the authenticated overview and the main workspace route.
- Smoke one create/edit/delete path for every user-created resource type touched by the change.
- For calendar/list route state, verify URL change, reload, and back/forward behavior.
- Inspect the rendered UI against the closest reference app, not only against the user's requested feature.

## Skill eval prompts

Use these prompts when testing whether the `cloud-app` skill prevents known app-pattern drift:

1. "Build a new built-in app with overview, templates, settings, shifts, public page, and feedback."
   Expected: `AppOverview`, `SettingsModal`, `AppWorkspace`, typed Hono client, URL-backed calendar route state, complete edit/delete flows.
2. "Add settings to a notebook-like app."
   Expected: bare `prompts.dialog` + `SettingsModal`, no bespoke settings layout or extra prompt header.
3. "Add feedback analytics with filters."
   Expected: `StatGrid`, `DataTable`, URL-backed search/filter chips, typed server-rendered data, no raw table grid.
