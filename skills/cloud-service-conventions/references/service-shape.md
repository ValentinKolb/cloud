# Service Shape

## Preferred Facade Pattern

```ts
export const exampleService = {
  resource: {
    list: async (config: { pagination?: PageParams; filter?: { q?: string } }) => {},
    get: async (config: { id: string }) => null,
    create: async (config: { data: CreateInput }) => ok(),
    update: async (config: { id: string; data: UpdateInput }) => ok(),
    remove: async (config: { id: string }) => ok(),
  },
};
```

## Method Semantics

- `list`: returns `Paginated<T>`.
- `get`: returns `T | null`.
- mutations: return `Result<T>` or `Result<void>`.

## Error Handling Pattern

```ts
if (!found) return fail(err.notFound("Item"));
if (!allowed) return fail(err.forbidden("Access denied"));
return ok(data);
```

## Logging Pattern

```ts
import { logger } from "@valentinkolb/cloud-lib/server/services/logging";

const log = logger("app.example.service.resource");
log.info("Resource updated", { resourceId: config.id });
```

Use structured metadata and stable source names. Avoid direct `console.*` in app service modules.

## Filter-Heavy Query Rules

1. Build one shared condition fragment and reuse it for `COUNT(*)` and list queries.
2. Keep filter joins aligned in both queries.
3. Keep access predicates identical in both queries.
4. Keep sort logic explicit and deterministic.
5. Cast union branches explicitly when mixed types are possible.

## Relation Hydration Guidance

- Prefer one relation-loading strategy per service module:
  - SQL aggregation (single round-trip), or
  - post-query hydration loops (clearer for small pages).
- Do not mix both styles in one method unless necessary.
- If you hydrate in loops, cap page size and keep query count bounded.

## Pattern Sources

- Files service: `cloud/packages/apps/src/files/service/index.ts`
- Notebooks service: `cloud/packages/apps/src/notebooks/service/index.ts`
- Spaces service: `cloud/packages/apps/src/spaces/service/index.ts`
- Filter-heavy list/count parity source:
  `cloud/packages/apps/src/spaces/service/items.ts`

Use these as guidance patterns, not exact templates.
