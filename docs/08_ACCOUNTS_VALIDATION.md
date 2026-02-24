# Accounts Validation Matrix

This validation is mapped to skills and was executed after the Accounts cleanup.

## Scope

- App: `cloud/packages/apps/src/accounts`
- Excluded by request: `contacts`

## Skill Mapping

| Skill | Status | Notes |
| --- | --- | --- |
| `cloud-service-conventions` | pass | Stateless services, config-object params, paginated list/get patterns are consistent. |
| `cloud-api-patterns` | pass | API handlers are thin wrappers; deny endpoint now has route-level admin middleware. |
| `cloud-frontend-consistency` | pass | Users/Groups list state is URL-driven (`search`, `page`, `show_all`). Shared SearchBar/Pagination pattern is used. |
| `cloud-coding-guidelines` | pass | Import surface cleaned to public package paths; `reload()` replaced with deterministic navigation helpers. |

## File-Level Review

### Services

| File | Status | Notes |
| --- | --- | --- |
| `cloud/packages/apps/src/accounts/service/index.ts` | pass | Facade shape is consistent. |
| `cloud/packages/apps/src/accounts/service/users.ts` | pass | Functional, stateless; concise behavioral docstrings added. |
| `cloud/packages/apps/src/accounts/service/groups.ts` | pass | Nested domain structure kept; concise behavioral docstrings added. |
| `cloud/packages/apps/src/accounts/service/account-requests.ts` | pass | Access rules preserved; concise behavioral docstrings added. |
| `cloud/packages/apps/src/accounts/service/shared.ts` | pass | Shared pagination/error adapters are stable and minimal. |

### API

| File | Status | Notes |
| --- | --- | --- |
| `cloud/packages/apps/src/accounts/api.ts` | pass | App-level route composition is consistent. |
| `cloud/packages/apps/src/accounts/api/users.ts` | pass | Middleware order and response wrapping are consistent. |
| `cloud/packages/apps/src/accounts/api/groups.ts` | pass | Middleware order and response wrapping are consistent. |
| `cloud/packages/apps/src/accounts/api/account-requests.ts` | pass | Deny endpoint now enforces admin via route middleware. |

### Frontend

| File Group | Status | Notes |
| --- | --- | --- |
| `frontend/users/*` | pass | URL-state parsing/serialization + deterministic mutation navigation. |
| `frontend/groups/*` | pass | URL-state parsing/serialization + deterministic mutation navigation. |
| `frontend/lib/url-state.ts` | pass | Canonical query contract and builders. |
| `frontend/lib/navigation.ts` | pass | Canonical refresh/navigation helpers replace raw reloads. |

## Validation Commands

- `bun run typecheck` (workspace root) -> pass
- `bun run --filter @valentinkolb/cloud-apps typecheck` -> pass
- `bun run check:skills` -> pass
- `bun run check:boundaries` -> pass
- `bun run check:cycles` -> pass
- `bun run check:service-api-contracts` -> pass
- `bun run check:biome` -> pass
