# Development Workflow

## Daily Commands

From `cloud/`:

```bash
bun install
bun run dev
bun run dev:skip-setup
bun run check
bun run typecheck
bun run format
bun run lint
```

## Build and Serve

```bash
bun run build
bun run serve
```

## Docker Dev

```bash
bun run docker:dev
```

This command uses root `compose.yml`.

## App Development Rules (High Level)

1. Keep business logic in app services, not inside route handlers.
2. Use stateless service methods with config objects.
3. Prefer service shape conventions:
   - `list(config)` -> paginated result
   - `get(config)` -> object or `null`
4. Keep API handlers thin: auth/validation -> service call -> `respond(...)`.
5. Use app-scoped Hono typed clients in frontend:
   - `import { apiClient } from "@valentinkolb/cloud-apps/apps/<app>/client"`
   - no global built-in API client
   - files upload raw fetch remains the exception for chunk transport.
6. Use client package subpaths by responsibility:
   - UI primitives from `@valentinkolb/cloud-lib/ui`
   - hydrated islands from `@valentinkolb/cloud-lib/islands`
   - browser runtime helpers from `@valentinkolb/cloud-lib/browser`
   - shared markdown/date/calendar/encoding helpers from `@valentinkolb/cloud-lib/shared`
7. Browser helper calls are namespace-based:
   - `api.create(...)`, `mutation.create(...)`, `timing.debounce(...)`, `clipboard.copy(...)`, `url.isImage(...)`
8. Register apps statically via app registry (no dynamic runtime loading).

## Settings and Config

- infra config via env in `cloud/packages/core/src/config/env.ts`
- runtime config via settings service + DB entries
- settings defaults and metadata in `cloud/packages/core/src/services/settings/defaults.ts`

## Docs and Skills

- update `cloud/docs` for human-facing, high-level changes
- update `cloud/skills` for implementation-level, agent-operational guidance
