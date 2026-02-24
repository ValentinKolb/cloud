---
name: cloud-api-patterns
description: Use when implementing Hono/Hono-OpenAPI routes so handlers remain thin wrappers around services, follow middleware conventions, and keep response behavior consistent.
---
# Cloud API Patterns

Use this skill for all `api.ts` handler work.

## Handler Contract

1. Apply middleware before route handlers.
2. Validate at the route edge (`v(...)`).
3. Delegate domain logic to services.
4. Map service outcome via `respond(c, result)`.
5. Use raw responses only for transport-specific endpoints.

## Quick Lookup (Do Not Guess)

- Validator `v`:
  - import: `@valentinkolb/cloud-lib/server/middleware/validator`
  - source: `cloud/packages/server/src/core/middleware/validator.ts`
- Response mapper `respond`:
  - import: `@valentinkolb/cloud-lib/server/api/respond`
  - source: `cloud/packages/server/src/core/api/respond.ts`
- Auth middleware:
  - import: `@valentinkolb/cloud-lib/server/middleware/auth`
- OpenAPI helpers:
  - import: `@valentinkolb/cloud-lib/server/middleware/openapi`
- Rate limit middleware:
  - import: `@valentinkolb/cloud-lib/server/middleware/rate-limit`
- Shared logger:
  - import: `@valentinkolb/cloud-lib/server/services/logging`
  - usage: `const log = logger("app.module");`

## Practical Patterns

- Use helper functions like `requireXAccess(...)` to keep handlers short.
- Keep mutation message wrappers (`respondMessage`) near handler blocks.
- Split big APIs into route modules if one file gets hard to scan.
- Keep one permission matrix per resource (`read`/`write`/`admin`) and reflect it in route groups.
- Keep list/search query params stable and explicitly validated.

## Allowed Exceptions

- Stream/binary endpoints (files content/thumbnail).
- Text exports (e.g. iCal response).

## References

- Wrapper flow and exceptions: `references/hono-openapi-pattern.md`
- Canonical imports and snippets: `references/import-map.md`
- Route guard matrix examples: `references/guard-matrix.md`

## Reference Routing

- Read `references/import-map.md` for canonical imports and minimal route skeleton.
- Read `references/guard-matrix.md` when adding ACL/admin or multi-level permission routes.
- Read `references/hono-openapi-pattern.md` for wrapper flow and transport exceptions.
