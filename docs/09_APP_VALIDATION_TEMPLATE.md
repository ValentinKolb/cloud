# App Validation Template

Use this template for strict skill-parity validation of each app.

## 1. Scope

- App path:
- Exclusions:

## 2. Skill Mapping

| Skill | Status (`pass/partial/fail`) | Notes |
| --- | --- | --- |
| `cloud-service-conventions` |  |  |
| `cloud-api-patterns` |  |  |
| `cloud-frontend-consistency` |  |  |
| `cloud-coding-guidelines` |  |  |

## 3. File-Level Matrix

### Services

| File | Status | Notes |
| --- | --- | --- |
|  |  |  |

### API

| File | Status | Notes |
| --- | --- | --- |
|  |  |  |

### Frontend

| File/Group | Status | Notes |
| --- | --- | --- |
|  |  |  |

## 4. Required Checks

Run from `cloud`:

- `bun run typecheck`
- `bun run check:skills`
- `bun run check:boundaries`
- `bun run check:cycles`
- `bun run check:service-api-contracts`
- `bun run check:biome`

Optional when build pipeline is healthy:

- `bun run build`

## 5. Decision Log

- API namespace changes:
- URL-state contract changes:
- Import boundary changes:
- Business-logic changes approved:

## 6. Findings

List findings in severity order:

1. `[severity] title` -> file + rationale

## 7. Completion

- Status:
- Follow-ups:
