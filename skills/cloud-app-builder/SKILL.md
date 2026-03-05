---
name: cloud-app-builder
description: Use when creating or refactoring cloud apps so they follow the shared app facade, route mounting, lifecycle hooks, and typed API conventions.
---
# Cloud App Builder

Use this skill for app-level implementation and refactors.

## Required App Contract

1. `index.ts` exports a default app facade.
2. `index.ts` exports named runtime `service`.
3. `index.ts` exports `type ApiType` if `api.ts` exists.
4. `client.ts` exists per API app and exports `apiClient`.
5. Service layer is stateless.
6. API layer is a thin wrapper around services.

## Quick Lookup (Do Not Guess)

- `AppFacade` type:
  - import: `@valentinkolb/cloud/contracts/app`
  - source: `cloud/packages/contracts/src/app.ts`
- API wrappers:
  - `respond` from `@valentinkolb/cloud-lib/server/api/respond`
  - `v` from `@valentinkolb/cloud-lib/server/middleware/validator`
- Shared UI:
  - `@valentinkolb/cloud-lib/ui`
  - `@valentinkolb/cloud-lib/islands` (currently `SearchBar`)
  - `@valentinkolb/cloud-lib/shared` for markdown/date/calendar/encoding/file-icon helpers
- App-scoped frontend API client:
  - import: `@valentinkolb/cloud-apps/apps/<app>/client`
  - default symbol: `apiClient`
  - do not use a global built-in apps client
- App search capability (optional):
  - optional `capabilities.search.tags` for app-owned tag filtering
  - `capabilities.search.run({ query, tags, limit, ctx })`
  - `ctx.get("user")` and `ctx.get("sessionToken")`
  - `priority` range is `0..9`
  - optional `metadata: Array<{ label, value }>`
  - optional `previewUrl` must be app-local (`/...`)
  - provider must honor `limit` exactly
- Shared logger (server-side app code):
  - import: `@valentinkolb/cloud-lib/server/services/logging`
  - usage: `const log = logger("app.module")`

## Build Sequence

1. Shape service facade (`service/index.ts`).
2. Add API wrapper (`api.ts`) around service calls.
3. Add page router (`pages.ts`, optional `adminPages.ts`).
4. Compose facade routes in `index.ts`.
5. Register app where runtime expects it.
6. Validate type/build and touched flows.

## For Filter-Heavy Apps

If the app has complex search/filter/pagination/detail behavior:

1. Define a URL state contract first.
2. Keep parsing/serialization in dedicated helpers.
3. Keep list/count query parity in services.
4. Add deep-link and back/forward smoke checks.
5. Use `../cloud-query-state-patterns/SKILL.md` alongside this skill.

## Flexibility Rule

- Keep the contract stable.
- Internal structure can vary by app complexity.
- Do not force extra abstraction when a small app only needs one file per layer.

## References

- App checklist and template: `references/new-app-checklist.md`
- Import/type map: `references/import-map.md`

## Reference Routing

- Read `references/new-app-checklist.md` first when creating a new app.
- Read `references/import-map.md` while coding imports/exports to keep package boundaries strict.
